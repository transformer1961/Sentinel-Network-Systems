/**
 * ALERTS MODULE v3.1
 *
 * Handles all outbound notifications:
 * - Cross-server join alerts for flagged/blacklisted users
 * - HQ server push: new reports, cases, watchlist events
 * - System Owner DM for critical events
 * - Case assignment DMs
 * - Escalation alerts
 * - Audit logging
 */

const { EmbedBuilder } = require('discord.js');
const config = require('./config');
const db     = require('./database');
const logger = require('./logger');

// ─── Severity helpers ─────────────────────────────────────────────────────────
const SEV_COLORS = { 0:'#555555',1:'#44bb44',2:'#bbbb00',3:'#bb6600',4:'#bb2200',5:'#880000' };
const SEV_ICONS  = { 0:'⬜',1:'🟩',2:'🟨',3:'🟧',4:'🟥',5:'💀' };

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function sendToChannel(client, channelId, embed) {
  if (!channelId) return false;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch?.isTextBased()) {
      await ch.send({ embeds: [embed] });
      return true;
    }
  } catch (err) {
    logger.warn('alerts', `Failed to send to channel ${channelId}`, err);
  }
  return false;
}

async function dmUser(client, userId, embed) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false; // DMs closed or user not found
  }
}

/**
 * DM the System Owner for critical events.
 */
async function dmOwner(client, embed) {
  if (!config.systemOwnerId) return;
  await dmUser(client, config.systemOwnerId, embed);
}

// ─── Core Alert: Flagged/Blacklisted User Joined ──────────────────────────────

async function checkAndAlertJoin(client, member) {
  const { user, guild } = member;
  const profile     = db.getProfile(user.id);
  const blacklisted = db.isBlacklisted(user.id);

  if (!profile && !blacklisted) return;

  const riskLevel = blacklisted ? 5 : (profile?.riskLevel || 0);
  if (riskLevel < 2 && !blacklisted) return;

  const sevName  = config.severityNames?.[String(riskLevel)] || 'Unknown';
  const topFlag  = profile?.flags?.slice(-1)[0];

  const embed = new EmbedBuilder()
    .setColor(blacklisted ? config.criticalColor : SEV_COLORS[riskLevel])
    .setTitle(`${config.botName} // ⚠️ ${blacklisted ? 'BLACKLISTED' : 'FLAGGED'} USER JOINED`)
    .setThumbnail(user.displayAvatarURL({ size: 64 }))
    .setDescription(
      `\`\`\`\n[ SUBJECT DETECTED IN SERVER ]\n` +
      `> User       : ${user.username}\n` +
      `> ID         : ${user.id}\n` +
      `> Risk Level : ${SEV_ICONS[riskLevel]} ${sevName} (${riskLevel}/5)\n` +
      `> Blacklisted: ${blacklisted ? 'YES ⛔' : 'NO'}\n` +
      `> Last Flag  : ${topFlag ? `L${topFlag.level} — ${topFlag.reason.substring(0, 50)}` : 'None on file'}\n` +
      `> Server     : ${guild.name}\n` +
      `> Known Srvrs: ${profile?.servers?.length || 1}\n` +
      `> Time       : ${new Date().toUTCString()}\n\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Automated cross-server alert' })
    .setTimestamp();

  // Alert SN HQ alert channel
  await sendToChannel(client, config.snAlertChannelId, embed);

  // Critical: also audit channel + DM owner
  if (riskLevel >= 4 || blacklisted) {
    await sendToChannel(client, config.snAuditChannelId, embed);
    await dmOwner(client, embed);
    logger.info('alerts', `Critical join alert — ${user.username} (L${riskLevel}) joined ${guild.name}`);
  }

  // Alert the joined server's configured channel
  const serverCfg = db.getServerConfig(guild.id);
  if (serverCfg?.alertChannelId) {
    await sendToChannel(client, serverCfg.alertChannelId, embed);
  }

  logger.event('alerts', `Join alert fired for ${user.username} in ${guild.name}`, { riskLevel, blacklisted });
}

// ─── Push new report/flag to HQ ───────────────────────────────────────────────

async function pushFlagToHQ(client, targetUsername, targetId, level, reason, issuedBy, serverId) {
  if (!config.snAlertChannelId) return;
  const sevName = config.severityNames?.[String(level)] || level;

  const embed = new EmbedBuilder()
    .setColor(SEV_COLORS[level] || '#555')
    .setTitle(`${config.botName} // FLAG REPORTED`)
    .setDescription(
      `\`\`\`\n[ NEW FLAG — PUSHED FROM SERVER ]\n` +
      `> Subject  : ${targetUsername}\n` +
      `> ID       : ${targetId}\n` +
      `> Level    : ${SEV_ICONS[level]} ${sevName} (${level}/5)\n` +
      `> Reason   : ${reason}\n` +
      `> By       : ${issuedBy}\n` +
      `> Server   : ${serverId}\n` +
      `> Time     : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, config.snAlertChannelId, embed);
  if (level >= 4) {
    await sendToChannel(client, config.snAuditChannelId, embed);
    await dmOwner(client, embed);
  }
}

// ─── Push new case to HQ ──────────────────────────────────────────────────────

async function pushCaseToHQ(client, caseData, openedBy) {
  if (!config.snAlertChannelId) return;

  const embed = new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(`${config.botName} // NEW CASE OPENED`)
    .setDescription(
      `\`\`\`\n[ INVESTIGATION INITIATED ]\n` +
      `> Case ID  : ${caseData.caseId}\n` +
      `> Title    : ${caseData.title}\n` +
      `> Agent    : ${openedBy}\n` +
      `> Server   : ${caseData.serverId || 'Unknown'}\n` +
      `> Time     : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, config.snAlertChannelId, embed);
}

// ─── Watchlist add — HQ push + optional owner DM ─────────────────────────────

async function pushWatchlistAdd(client, targetUsername, targetId, addedBy, riskLevel) {
  if (!config.snAlertChannelId) return;

  const isCritical = riskLevel >= 4;
  const embed = new EmbedBuilder()
    .setColor(isCritical ? config.criticalColor : config.warningColor)
    .setTitle(`${config.botName} // WATCHLIST UPDATE`)
    .setDescription(
      `\`\`\`\n[ SUBJECT ADDED TO WATCHLIST ]\n` +
      `> Subject  : ${targetUsername}\n` +
      `> ID       : ${targetId}\n` +
      `> Risk     : ${SEV_ICONS[riskLevel] || '⬜'} Level ${riskLevel}\n` +
      `> Added By : ${addedBy}\n` +
      `> Time     : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, config.snAlertChannelId, embed);

  // DM System Owner for critical additions
  if (isCritical) {
    await dmOwner(client, embed);
    logger.info('alerts', `Owner DM sent — critical watchlist add: ${targetUsername}`);
  }
}

// ─── Case assignment DM ───────────────────────────────────────────────────────

async function alertCaseAssigned(client, agentId, caseData, assignedBy) {
  const embed = new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // CASE ASSIGNMENT`)
    .setDescription(
      `\`\`\`\n[ YOU HAVE BEEN ASSIGNED TO A CASE ]\n` +
      `> Case ID    : ${caseData.caseId}\n` +
      `> Title      : ${caseData.title}\n` +
      `> Status     : ${caseData.status}\n` +
      `> Assigned By: ${assignedBy}\n` +
      `> Time       : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  const sent = await dmUser(client, agentId, embed);
  if (!sent) logger.warn('alerts', `Could not DM agent ${agentId} for case assignment`);
}

// ─── Escalation alert ─────────────────────────────────────────────────────────

async function alertEscalation(client, targetUsername, targetId, level, reason, issuedBy) {
  const sevName = config.severityNames?.[String(level)] || level;

  const embed = new EmbedBuilder()
    .setColor(level >= 4 ? config.criticalColor : config.warningColor)
    .setTitle(`${config.botName} // 🚨 SEVERITY ESCALATION — LEVEL ${level}`)
    .setDescription(
      `\`\`\`\n[ THREAT ESCALATION ISSUED ]\n` +
      `> Subject    : ${targetUsername}\n` +
      `> ID         : ${targetId}\n` +
      `> New Level  : ${SEV_ICONS[level]} ${sevName} (${level}/5)\n` +
      `> Reason     : ${reason}\n` +
      `> Issued By  : ${issuedBy}\n` +
      `> Time       : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, config.snAlertChannelId, embed);
  if (level >= 4) {
    await sendToChannel(client, config.snAuditChannelId, embed);
    await dmOwner(client, embed);
  }
}

// ─── Blacklist alert ──────────────────────────────────────────────────────────

async function alertBlacklist(client, targetUsername, targetId, reason, addedBy) {
  const embed = new EmbedBuilder()
    .setColor(config.criticalColor)
    .setTitle(`${config.botName} // ⛔ GLOBAL BLACKLIST`)
    .setDescription(
      `\`\`\`\n[ SUBJECT ADDED TO GLOBAL BLACKLIST ]\n` +
      `> Subject  : ${targetUsername}\n` +
      `> ID       : ${targetId}\n` +
      `> Reason   : ${reason}\n` +
      `> Added By : ${addedBy}\n` +
      `> Time     : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, config.snAlertChannelId, embed);
  await sendToChannel(client, config.snAuditChannelId, embed);
  await dmOwner(client, embed);
  logger.info('alerts', `Blacklist alert sent — ${targetUsername} by ${addedBy}`);
}

// ─── Audit log ────────────────────────────────────────────────────────────────

async function auditLog(client, interaction, subcommand) {
  if (!config.snAuditChannelId) return;

  const embed = new EmbedBuilder()
    .setColor('#1a1a2e')
    .setTitle(`${config.botName} // AUDIT LOG`)
    .setDescription(
      `\`\`\`\n` +
      `> Agent   : ${interaction.user.username} (${interaction.user.id})\n` +
      `> Command : /${interaction.commandName}${subcommand ? ' ' + subcommand : ''}\n` +
      `> Server  : ${interaction.guild?.name || 'DM'} (${interaction.guildId})\n` +
      `> Time    : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, config.snAuditChannelId, embed);
}

// ─── Watched user message alert ───────────────────────────────────────────────

async function alertWatchedMessage(client, userId, username, channelName, preview, serverId) {
  const serverCfg = db.getServerConfig(serverId);
  const alertCh   = serverCfg?.alertChannelId || config.snAlertChannelId;
  if (!alertCh) return;

  const embed = new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // SURVEILLANCE ALERT`)
    .setDescription(
      `\`\`\`\n[ WATCHED SUBJECT ACTIVITY ]\n` +
      `> Subject : ${username}\n` +
      `> ID      : ${userId}\n` +
      `> Channel : #${channelName}\n` +
      `> Preview : "${preview}"\n` +
      `> Time    : ${new Date().toUTCString()}\n\`\`\``
    )
    .setTimestamp();

  await sendToChannel(client, alertCh, embed);
}

module.exports = {
  SEV_COLORS,
  SEV_ICONS,
  sendToChannel,
  dmUser,
  dmOwner,
  checkAndAlertJoin,
  pushFlagToHQ,
  pushCaseToHQ,
  pushWatchlistAdd,
  alertCaseAssigned,
  alertEscalation,
  alertBlacklist,
  auditLog,
  alertWatchedMessage
};
