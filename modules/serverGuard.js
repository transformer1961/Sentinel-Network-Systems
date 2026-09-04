/**
 * SERVER GUARD MODULE
 *
 * Enforces restrictions on blacklisted servers and provides the
 * owner override bypass. This is the single chokepoint that all
 * sensitive commands pass through.
 *
 * HOW IT WORKS:
 * 1. interactionCreate checks every slash command via serverGuard.check()
 * 2. If the server is blacklisted, restricted commands are blocked
 * 3. An alert is sent to HQ every time a blacklisted server attempts
 *    a restricted command (rate-limited to once per 5 min per server)
 * 4. The server's staff receive a notification embed explaining restrictions
 * 5. Owner ID bypasses everything — no server requirement, no role requirement
 *
 * RESTRICTED COMMANDS (blocked in blacklisted servers):
 *   admin.promote, admin.audit, admin.blacklist, admin.unblacklist
 *   watch.add, watch.remove, watch.notify
 *   case.assign, case.close
 *   profile.flag, profile.escalate
 */

const { EmbedBuilder } = require('discord.js');
const sbl    = require('./serverBlacklist');
const security = require('./serverSecurity');
const logger = require('./logger');
const config = require('./config');

// Commands that are BLOCKED in blacklisted or medium lockdown servers
const RESTRICTED_IN_BLACKLISTED = new Set([
  'admin.promote',
  'admin.audit',
  'admin.blacklist',
  'admin.unblacklist',
  'watch.add',
  'watch.remove',
  'watch.notify',
  'case.assign',
  'case.close',
  'profile.flag',
  'profile.escalate'
]);

// Alert rate limit: serverId → last restricted alert timestamp
// Prevents HQ from being spammed when a blacklisted server attempts a blocked command
const alertCooldown = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Usage alert rate limit: serverId → last allowed command usage alert timestamp
const usageAlertCooldown = new Map();
const USAGE_ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Notification rate limit: serverId → last notified timestamp
const notifyCooldown = new Map();
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

const ESSENTIAL_COMMANDS_HARD_LOCKDOWN = new Set([
  'help',
  'servers.check',
  'servers.info',
  'servers.list',
  'lockdown.status',
  'tls.view',
  'hq.lockdown.status',
  'hq.tls.view'
]);

async function isHighStaffInSN(interaction) {
  if (!config.snServerId) return false;
  try {
    const snGuild = await interaction.client.guilds.fetch(config.snServerId);
    if (!snGuild) return false;
    const member = await snGuild.members.fetch(interaction.user.id);
    if (!member) return false;
    const roleName = config.highStaffRole || '──── High Staff ────';
    return member.roles.cache.some(r => r.name === roleName);
  } catch (err) {
    logger.debug('serverGuard', 'High staff check failed', err);
    return false;
  }
}

function buildTotalLockdownEmbed(securityState) {
  return new EmbedBuilder()
    .setColor(config.criticalColor)
    .setTitle(`${config.botName} // 🚨 TOTAL LOCKDOWN ACTIVE`)
    .setDescription(
      `\`\`\`\n` +
      `[ ACCESS DENIED — TOTAL LOCKDOWN ]\n\n` +
      `> Server   : ${securityState.serverId}\n` +
      `> Level    : TOTAL\n` +
      `> Reason   : ${securityState.effectiveLockdown.reason}\n` +
      `> Threat   : ${securityState.effectiveTLS}\n\n` +
      `Only High Staff role members and the System Owner may execute commands during TOTAL lockdown.\n` +
      `This server is under emergency Sentinel Network containment.\n\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Emergency lockdown enforcement' })
    .setTimestamp();
}

function buildHardLockdownEmbed(securityState) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // ⚠️ HARD LOCKDOWN ACTIVE`)
    .setDescription(
      `\`\`\`\n` +
      `[ COMMAND RESTRICTED — HARD LOCKDOWN ]\n\n` +
      `> Server   : ${securityState.serverId}\n` +
      `> Level    : HARD\n` +
      `> Reason   : ${securityState.effectiveLockdown.reason}\n` +
      `> Threat   : ${securityState.effectiveTLS}\n\n` +
      `Only essential diagnostics and review commands remain available.\n` +
      `Please contact Sentinel Network HQ for release.\n\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Hard lockdown restrictions' })
    .setTimestamp();
}

function buildSoftLockdownEmbed(securityState) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // ⚠️ SOFT LOCKDOWN ACTIVE`)
    .setDescription(
      `\`\`\`\n` +
      `[ NOTICE — SOFT LOCKDOWN ]\n\n` +
      `> Server   : ${securityState.serverId}\n` +
      `> Level    : SOFT\n` +
      `> Reason   : ${securityState.effectiveLockdown.reason}\n` +
      `> Threat   : ${securityState.effectiveTLS}\n\n` +
      `Sensitive actions are being monitored. Most commands remain available.\n\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Soft lockdown notification' })
    .setTimestamp();
}

function buildSecurityNoticeEmbed(securityState, commandKey) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // SECURITY NOTICE`)
    .setDescription(
      `\`\`\`\n` +
      `[ SECURITY POLICY ACTIVE ]\n\n` +
      `> Server   : ${securityState.serverId}\n` +
      `> Threat   : ${securityState.effectiveTLS}\n` +
      `> Lockdown : ${securityState.effectiveLockdown.level}\n` +
      `> Command  : /${commandKey.replace('.', ' ')}\n\n` +
      `This server is under Sentinel Network monitoring.\n` +
      `Restricted commands may be blocked if conditions worsen.\n\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Security status update' })
    .setTimestamp();
}

/**
 * Check if the current interaction is allowed to proceed.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} commandKey - e.g. 'profile.flag'
 * @returns {Promise<boolean>} true = proceed, false = blocked
 */
async function check(interaction, commandKey) {
  const userId   = interaction.user.id;
  const serverId = interaction.guildId;

  if (!serverId) return true; // DMs and non-guild interactions are not subject to server lockdowns

  // ── 1. Owner bypass — passes everything ──────────────────────────────────
  if (userId === config.systemOwnerId) {
    logger.debug('serverGuard', `Owner bypass for ${commandKey} in ${serverId}`);
    return true;
  }

  const securityState = security.getSecurityState(serverId);
  const lockdown = securityState.effectiveLockdown;
  const isBlacklisted = sbl.isServerBlacklisted(serverId);
  const blacklistEntry = isBlacklisted ? sbl.getBlacklistedServer(serverId) : null;
  const restrictionEntry = blacklistEntry || {
    serverId,
    serverName: interaction.guild?.name || 'Unknown',
    reason: lockdown.reason || 'Sentinel Network restriction active',
    status: lockdown.level === 'MEDIUM' ? 'ACTIVE' : lockdown.level === 'HARD' ? 'ACTIVE' : 'ACTIVE',
    addedAt: lockdown.triggeredAt || new Date().toISOString(),
    memberCount: interaction.guild?.memberCount || 0,
    ownerId: interaction.guild?.ownerId || 'Unknown'
  };

  // Refresh server metadata in the background
  if (interaction.guild) {
    sbl.refreshServerMeta(
      serverId,
      interaction.guild.name,
      interaction.guild.memberCount,
      interaction.guild.ownerId
    );
  }

  // ── TOTAL lockdown: only High Staff + owner ──────────────────────────────
  if (lockdown.active && lockdown.level === 'TOTAL') {
    const isHighStaff = await isHighStaffInSN(interaction);
    if (!isHighStaff) {
      logger.warn('serverGuard', `Blocked ${commandKey} during TOTAL lockdown in ${serverId}`);
      await interaction.reply({ embeds: [buildTotalLockdownEmbed(securityState)], ephemeral: true });
      return false;
    }
    return true;
  }

  // ── HARD lockdown: only essential diagnostics commands allowed ───────────
  if (lockdown.active && lockdown.level === 'HARD') {
    if (!ESSENTIAL_COMMANDS_HARD_LOCKDOWN.has(commandKey)) {
      logger.warn('serverGuard', `Blocked ${commandKey} during HARD lockdown in ${serverId}`);
      await interaction.reply({ embeds: [buildHardLockdownEmbed(securityState)], ephemeral: true });
      return false;
    }
    return true;
  }

  // ── MEDIUM lockdown or blacklisted status: restricted command enforcement ──
  const restrictedMode = isBlacklisted || (lockdown.active && lockdown.level === 'MEDIUM');
  if (restrictedMode && RESTRICTED_IN_BLACKLISTED.has(commandKey)) {
    logger.warn('serverGuard', `Blocked ${commandKey} in restricted server ${serverId}`);

    await interaction.reply({ embeds: [buildRestrictedEmbed(restrictionEntry, commandKey)], ephemeral: true });

    const lastAlert = alertCooldown.get(serverId) || 0;
    if (Date.now() - lastAlert >= ALERT_COOLDOWN_MS) {
      alertCooldown.set(serverId, Date.now());
      await sendHQAlert(interaction.client, interaction, restrictionEntry, commandKey);
    }

    const lastNotify = notifyCooldown.get(serverId) || 0;
    if (Date.now() - lastNotify >= NOTIFY_COOLDOWN_MS) {
      notifyCooldown.set(serverId, Date.now());
      await notifyServerStaff(interaction, restrictionEntry);
    }

    return false;
  }

  // ── SOFT lockdown: allow commands but send notice and monitor usage ───────
  if (lockdown.active && lockdown.level === 'SOFT') {
    logger.debug('serverGuard', `Soft lockdown active for ${commandKey} in ${serverId}`);

    const lastUsageAlert = usageAlertCooldown.get(serverId) || 0;
    if (Date.now() - lastUsageAlert >= USAGE_ALERT_COOLDOWN_MS) {
      usageAlertCooldown.set(serverId, Date.now());
      await sendHQUsageAlert(interaction.client, interaction, securityState, commandKey);
    }

    const lastNotify = notifyCooldown.get(serverId) || 0;
    if (Date.now() - lastNotify >= NOTIFY_COOLDOWN_MS) {
      notifyCooldown.set(serverId, Date.now());
      await notifyServerStaff(interaction, securityState);
    }

    return true;
  }

  // ── Blacklisted servers: allow non-restricted commands with monitoring alerts ─
  if (isBlacklisted && !RESTRICTED_IN_BLACKLISTED.has(commandKey)) {
    logger.debug('serverGuard', `Allowed unrestricted command ${commandKey} in blacklisted server ${serverId}`);

    const lastUsageAlert = usageAlertCooldown.get(serverId) || 0;
    if (Date.now() - lastUsageAlert >= USAGE_ALERT_COOLDOWN_MS) {
      usageAlertCooldown.set(serverId, Date.now());
      await sendHQUsageAlert(interaction.client, interaction, restrictionEntry, commandKey);
    }

    const lastNotify = notifyCooldown.get(serverId) || 0;
    if (Date.now() - lastNotify >= NOTIFY_COOLDOWN_MS) {
      notifyCooldown.set(serverId, Date.now());
      await notifyServerStaff(interaction, restrictionEntry);
    }

    return true;
  }

  return true;
}

// ─── Embeds ───────────────────────────────────────────────────────────────────

function buildRestrictedEmbed(entry, commandKey) {
  return new EmbedBuilder()
    .setColor(config.criticalColor)
    .setTitle(`${config.botName} // ⛔ SERVER RESTRICTED`)
    .setDescription(
      `\`\`\`\n` +
      `[ COMMAND BLOCKED — SERVER UNDER RESTRICTION ]\n\n` +
      `> Command  : /${commandKey.replace('.', ' ')}\n` +
      `> Status   : BLACKLISTED (${entry.status})\n` +
      `> Reason   : ${entry.reason}\n` +
      `> Since    : ${new Date(entry.addedAt).toUTCString()}\n\n` +
      `  This server has been flagged by Sentinel Network HQ.\n` +
      `  Sensitive commands are disabled until the restriction\n` +
      `  is reviewed and lifted by a Director or above.\n\n` +
      `  To appeal, contact Sentinel Network HQ.\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // This action has been logged.' })
    .setTimestamp();
}

function buildHQAlertEmbed(interaction, entry, commandKey) {
  return new EmbedBuilder()
    .setColor(config.criticalColor)
    .setTitle(`${config.botName} // 🚨 BLACKLISTED SERVER ACTIVITY`)
    .setDescription(
      `\`\`\`\n` +
      `[ RESTRICTED COMMAND ATTEMPTED ]\n\n` +
      `> Server   : ${entry.serverName}\n` +
      `> Server ID: ${entry.serverId}\n` +
      `> Owner ID : ${entry.ownerId}\n` +
      `> Members  : ${entry.memberCount}\n` +
      `> BL Status: ${entry.status}\n` +
      `> BL Reason: ${entry.reason}\n` +
      `> Blacklisted: ${new Date(entry.addedAt).toUTCString()}\n\n` +
      `> Command  : /${commandKey.replace('.', ' ')}\n` +
      `> By User  : ${interaction.user.username} (${interaction.user.id})\n` +
      `> Time     : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Automatic blacklisted-server monitor' })
    .setTimestamp();
}

function buildStaffNotificationEmbed(entry) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // SERVER RESTRICTION NOTICE`)
    .setDescription(
      `\`\`\`\n` +
      `[ NOTICE TO SERVER STAFF ]\n\n` +
      `  This server is currently under Sentinel Network\n` +
      `  restricted monitoring. The following applies:\n\n` +
      `  ✗ Sensitive commands have been disabled\n` +
      `  ✗ All command usage is being logged to HQ\n` +
      `  ✓ Basic informational commands still work\n\n` +
      `> Restriction Reason:\n` +
      `  ${entry.reason}\n\n` +
      `> Status   : ${entry.status}\n` +
      `> Since    : ${new Date(entry.addedAt).toUTCString()}\n\n` +
      `  If you believe this is in error, please contact\n` +
      `  Sentinel Network HQ to file an appeal.\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Automated restriction notice' })
    .setTimestamp();
}

// ─── Side effects ─────────────────────────────────────────────────────────────

async function sendHQAlert(client, interaction, entry, commandKey) {
  if (!config.snAuditChannelId) return;
  try {
    const ch = await client.channels.fetch(config.snAuditChannelId);
    if (ch?.isTextBased()) {
      await ch.send({ embeds: [buildHQAlertEmbed(interaction, entry, commandKey)] });
    }
  } catch (err) {
    logger.warn('serverGuard', 'Failed to send HQ alert', err);
  }
}

async function sendHQUsageAlert(client, interaction, entry, commandKey) {
  if (!config.snAuditChannelId) return;
  try {
    const ch = await client.channels.fetch(config.snAuditChannelId);
    if (ch?.isTextBased()) {
      await ch.send({ embeds: [buildHQUsageEmbed(interaction, entry, commandKey)] });
    }
  } catch (err) {
    logger.warn('serverGuard', 'Failed to send HQ usage alert', err);
  }
}

function buildHQUsageEmbed(interaction, entry, commandKey) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // ⚠️ BLACKLISTED SERVER USAGE`)
    .setDescription(
      `\`\`\`\n` +
      `[ BLACKLISTED SERVER USED BOT ]\n\n` +
      `> Server   : ${entry.serverName}\n` +
      `> Server ID: ${entry.serverId}\n` +
      `> Owner ID : ${entry.ownerId}\n` +
      `> Members  : ${entry.memberCount}\n` +
      `> Status   : ${entry.status}\n` +
      `> Reason   : ${entry.reason}\n` +
      `> Command  : /${commandKey.replace('.', ' ')}\n` +
      `> Time     : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Blacklist monitoring alert' })
    .setTimestamp();
}

async function notifyServerStaff(interaction, entry) {
  // Try to find a suitable notification channel in the server:
  // 1. Configured alert channel (from /admin setup)
  // 2. System channel
  // 3. First writable text channel
  try {
    const guild = interaction.guild;
    if (!guild) return;

    const { getServerConfig } = require('./database');
    const cfg = getServerConfig(guild.id);

    let channel = null;

    if (cfg?.alertChannelId) {
      try { channel = await guild.channels.fetch(cfg.alertChannelId); } catch { /* try next */ }
    }

    if (!channel && guild.systemChannelId) {
      try { channel = await guild.channels.fetch(guild.systemChannelId); } catch { /* try next */ }
    }

    if (!channel) {
      channel = guild.channels.cache
        .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'))
        .first();
    }

    if (channel?.isTextBased()) {
      await channel.send({ embeds: [buildStaffNotificationEmbed(entry)] });
      logger.info('serverGuard', `Staff notification sent to ${guild.name}`);
    }
  } catch (err) {
    logger.warn('serverGuard', 'Failed to notify server staff', err);
  }
}

// ─── High Staff role check ────────────────────────────────────────────────────

/**
 * Check if a user has the "──── High Staff ────" Discord role
 * on the SN server. Used by /servers commands.
 *
 * Owner ID always passes.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
function hasHighStaffRole(interaction) {
  if (interaction.user.id === config.systemOwnerId) return true;

  // Must be in SN server (or owner override already handled)
  if (interaction.guildId !== config.snServerId) {
    // Owner bypass only — non-SN users cannot manage server blacklist
    return interaction.user.id === config.systemOwnerId;
  }

  const HIGH_STAFF_ROLE = config.highStaffRole || '──── High Staff ────';
  return !!(interaction.member?.roles?.cache?.some(r => r.name === HIGH_STAFF_ROLE));
}

function buildNoHighStaffEmbed() {
  return new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ACCESS DENIED`)
    .setDescription(
      `\`\`\`\n[ HIGH STAFF REQUIRED ]\n` +
      `> This command requires the role: ──── High Staff ────\n` +
      `> Or must be run by the System Owner.\n` +
      `> This command is also restricted to the SN main server.\n\`\`\``
    )
    .setTimestamp();
}

module.exports = {
  RESTRICTED_IN_BLACKLISTED,
  check,
  hasHighStaffRole,
  buildNoHighStaffEmbed,
  buildRestrictedEmbed,
  buildHQAlertEmbed,
  buildStaffNotificationEmbed
};
