/**
 * PERMISSIONS MODULE v3.1
 *
 * Clearance levels (stored in profile.clearance):
 *   1   = Recruit
 *   1.5 = Trainee Agent
 *   2   = Agent
 *   2.5 = Investigator
 *   3   = Senior Investigator
 *   3.5 = Supervisor
 *   4   = Operations Lead
 *   4.5 = Deputy Director
 *   5   = Director
 *   6   = System Owner (config.systemOwnerId only)
 *
 * Scope rules:
 *   - "global" commands (blacklist, escalate, audit) can ONLY be run from
 *     the SN main server (snServerId) by staff with sufficient clearance.
 *   - All other commands can be run from any server, but clearance
 *     still applies based on the user's SN profile.
 *   - Server-local staff can use basic commands regardless of SN clearance,
 *     but cannot perform cross-server or SN-only actions.
 *
 * Per-server Discord role check:
 *   If a user has a Discord role named in config.trustedServerStaffRole
 *   on a non-SN server, they get a temporary bump to clearance level 2
 *   for LOCAL commands only.
 */

const { EmbedBuilder } = require('discord.js');
const { getProfile }   = require('./database');
const logger           = require('./logger');
const config           = require('./config');

// ── Clearance levels ─────────────────────────────────────────────────────────

const CLEARANCE = {
  RECRUIT: 1,
  TRAINEE_AGENT: 1.5,
  AGENT: 2,
  INVESTIGATOR: 2.5,
  SENIOR_INVESTIGATOR: 3,
  SUPERVISOR: 3.5,
  OPERATIONS_LEAD: 4,
  DEPUTY_DIRECTOR: 4.5,
  DIRECTOR: 5,
  SYSTEM_OWNER: 6
};

// ── Command clearance map ─────────────────────────────────────────────────────

const COMMAND_CLEARANCE = {
  'profile.create':      1,
  'profile.view':        1,
  'profile.add-note':    2,
  'profile.remove-note': 2,
  'profile.flag':        3,
  'profile.severity':    1,
  'profile.escalate':    5,
  'profile.search':      1,

  'case.open':           2,
  'case.view':           1,
  'case.list':           1,
  'case.add-evidence':   2,
  'case.assign':         2.5,
  'case.close':          4,
  'case.reopen':         4,

  'watch.add':           3,
  'watch.remove':        3,
  'watch.log':           2,
  'watch.list':          2,
  'watch.notify':        3,
  'watch.disable-notify':3,

  'admin.promote':       3.5,
  'admin.demote':        3.5,
  'admin.audit':         4,
  'admin.blacklist':     5,
  'admin.unblacklist':   5,
  'admin.setup':         3.5,
  'blacklist.check':     1,
  'blacklist.list':      5,

  'hq.lockdown.force':   4,
  'hq.lockdown.clear':   4,
  'hq.lockdown.status':  4,
  'hq.tls.set':          4,
  'hq.tls.view':         4,
  'hq.tls.list':         4,
  'lockdown.enable':     2,
  'lockdown.disable':    2,
  'lockdown.status':     1,
  'tls.set':             2,
  'tls.view':            1,

  'report.generate':     2,
  'report.summary':      3,
  'help':                1
};

// Commands that MUST be run from the SN main server
const GLOBAL_ONLY_COMMANDS = new Set([
  'profile.escalate',
  'admin.blacklist',
  'admin.unblacklist',
  'blacklist.list',
  'admin.audit',
  'hq.lockdown.force',
  'hq.lockdown.clear',
  'hq.lockdown.status',
  'hq.tls.set',
  'hq.tls.view',
  'hq.tls.list'
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRoleName(level) {
  const names = config.roleNames || {};
  // Find closest level
  const levels = Object.keys(names).map(Number).sort((a, b) => a - b);
  for (const l of levels) {
    if (level <= l) return `LVL ${l} — ${names[String(l)]}`;
  }
  return `LVL ${level}`;
}

/**
 * Get a user's effective clearance level.
 *
 * Priority:
 * 1. System Owner (config.systemOwnerId) → always 6
 * 2. SN profile clearance
 * 3. Discord role on current server (trusted staff bump → 2)
 * 4. Default: 1
 *
 * @param {string} userId
 * @param {import('discord.js').ChatInputCommandInteraction} [interaction] - pass to check Discord roles
 * @returns {number}
 */
function getUserClearance(userId, interaction) {
  // Always max for system owner
  if (userId === config.systemOwnerId) return 6;

  // SN profile clearance
  const profile = getProfile(userId);
  let clearance = profile?.clearance || 1;

  // Discord role bump for trusted server staff on non-SN servers
  if (interaction && interaction.guildId !== config.snServerId && interaction.member) {
    const roleName  = config.trustedServerStaffRole || 'SN-Trusted';
    const hasTrusted = interaction.member.roles?.cache?.some(r => r.name === roleName);
    if (hasTrusted && clearance < 2) {
      clearance = 2; // Bump to Agent for local commands
      logger.debug('permissions', `Trusted role bump for ${userId} in ${interaction.guildId}`);
    }
  }

  return clearance;
}

/**
 * Full access check for a command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} commandKey - e.g. 'profile.flag'
 * @returns {{ allowed: boolean, reason: string, userLevel: number, required: number }}
 */
function checkAccess(interaction, commandKey) {
  const userId   = interaction.user.id;
  const serverId = interaction.guildId;
  const required = COMMAND_CLEARANCE[commandKey] || 1;
  const isGlobal = GLOBAL_ONLY_COMMANDS.has(commandKey);

  // ── OWNER OVERRIDE — bypasses all server and clearance requirements ───────
  if (userId === config.systemOwnerId) {
    logger.debug('permissions', `Owner override for ${commandKey}`);
    return { allowed: true, reason: null, userLevel: 6, required };
  }

  // Must be run from SN server (non-owners)
  if (isGlobal && serverId !== config.snServerId) {
    logger.debug('permissions', `Blocked global command ${commandKey} outside SN server`, { userId, serverId });
    return {
      allowed: false,
      reason:  `This command can only be used in the Sentinel Network main server.`,
      userLevel: getUserClearance(userId, interaction),
      required
    };
  }

  const userLevel = getUserClearance(userId, interaction);

  if (userLevel < required) {
    logger.debug('permissions', `Access denied: ${commandKey}`, { userId, userLevel, required });
    return {
      allowed:   false,
      reason:    `Insufficient clearance. Required: ${getRoleName(required)}`,
      userLevel, required
    };
  }

  logger.debug('permissions', `Access granted: ${commandKey}`, { userId, userLevel });
  return { allowed: true, reason: null, userLevel, required };
}

/**
 * Build a standardized "Access Denied" embed.
 */
function buildDeniedEmbed(reason, userLevel, required) {
  return new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ACCESS DENIED`)
    .setDescription(
      `\`\`\`\n[ AUTHORIZATION FAILURE ]\n` +
      `> Required : ${getRoleName(required)}\n` +
      `> Yours    : ${getRoleName(userLevel)}\n` +
      `> Reason   : ${reason}\n` +
      `> Note     : Use /help to see your accessible commands.\n\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Unauthorized access logged.' })
    .setTimestamp();
}

/**
 * Middleware — call at the top of every command execute().
 * Returns true if allowed, false and replies if denied.
 */
async function requireAccess(interaction, commandKey) {
  const { allowed, reason, userLevel, required } = checkAccess(interaction, commandKey);

  if (!allowed) {
    await interaction.reply({
      embeds: [buildDeniedEmbed(reason, userLevel, required)],
      ephemeral: true
    });
    return false;
  }

  return true;
}

/**
 * Set a user's clearance level.
 */
function setClearance(userId, level) {
  const { updateProfile } = require('./database');
  const result = updateProfile(userId, { clearance: Number(level) });
  logger.event('permissions', `Clearance set to ${level} for ${userId}`);
  return result;
}

/**
 * Check if user is System Owner.
 *
 * @param {string} userId
 * @returns {boolean}
 */
function isSystemOwner(userId) {
  return userId === config.systemOwnerId;
}

/**
 * Check if user is Emergency Owner (delegated backup authority).
 * Stored in config.emergencyOwnerId if configured.
 *
 * @param {string} userId
 * @returns {boolean}
 */
function isEmergencyOwner(userId) {
  return config.emergencyOwnerId && userId === config.emergencyOwnerId;
}

module.exports = {
  CLEARANCE,
  COMMAND_CLEARANCE,
  GLOBAL_ONLY_COMMANDS,
  getRoleName,
  getUserClearance,
  checkAccess,
  buildDeniedEmbed,
  requireAccess,
  setClearance,
  isSystemOwner,
  isEmergencyOwner
};
