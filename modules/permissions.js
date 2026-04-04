/**
 * PERMISSIONS MODULE
 * Clearance-level based access control for Sentinel Network.
 * All command handlers should call checkClearance() before executing.
 */

const { EmbedBuilder } = require('discord.js');
const { getProfile } = require('./database');
const config = require('../config.json');

// Map clearance numbers to readable rank names
const CLEARANCE_NAMES = {
  1:   'Basic',
  1.5: 'Trainee Agent',
  2:   'Agent',
  2.5: 'Special Agent',
  3:   'Senior Agent',
  3.5: 'Assistant Supervisor',
  4:   'Supervisor',
  4.5: 'Deputy Director',
  5:   'Director',
  6:   'System Owner'
};

// Command minimum clearance requirements
const COMMAND_CLEARANCE = {
  // Profile commands
  'profile.create':   1,
  'profile.view':     1,
  'profile.add-note': 2,
  'profile.flag':     3,

  // Case commands
  'case.open':         2,
  'case.add-evidence': 2,
  'case.assign':       3,
  'case.close':        3,

  // Watch commands
  'watch.add':    3,
  'watch.remove': 3,
  'watch.log':    2,

  // Admin commands
  'admin.promote': 4,
  'admin.audit':   3
};

/**
 * Get a user's clearance level from their profile.
 * Defaults to 1 (Basic) if they have no profile.
 */
function getUserClearance(userId) {
  const profile = getProfile(userId);
  if (!profile) return 1;
  return profile.clearance || 1;
}

/**
 * Get the clearance name string for a given numeric level.
 */
function getClearanceName(level) {
  // Find the closest matching level
  const levels = Object.keys(CLEARANCE_NAMES).map(Number).sort((a, b) => a - b);
  for (const l of levels) {
    if (level <= l) return `LEVEL ${l} — ${CLEARANCE_NAMES[l]}`;
  }
  return `LEVEL ${level} — Unknown`;
}

/**
 * Check if a user has sufficient clearance to run a command.
 * @param {string} userId - Discord user ID
 * @param {string} commandKey - e.g. 'profile.flag'
 * @returns {{ allowed: boolean, userLevel: number, required: number }}
 */
function checkClearance(userId, commandKey) {
  const userLevel = getUserClearance(userId);
  const required = COMMAND_CLEARANCE[commandKey] || 1;
  return {
    allowed: userLevel >= required,
    userLevel,
    required
  };
}

/**
 * Build a standardized "Access Denied" embed to send back.
 */
function buildDeniedEmbed(userLevel, required) {
  return new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ACCESS DENIED`)
    .setDescription(
      `\`\`\`\n` +
      `[ AUTHORIZATION FAILURE ]\n` +
      `> Clearance required : ${getClearanceName(required)}\n` +
      `> Your clearance     : ${getClearanceName(userLevel)}\n` +
      `> Status             : INSUFFICIENT PRIVILEGES\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Unauthorized access has been logged.' })
    .setTimestamp();
}

/**
 * Middleware helper — call this at the top of every command execute().
 * Returns false and replies with denied embed if unauthorized.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} commandKey
 * @returns {Promise<boolean>} true if allowed
 */
async function requireClearance(interaction, commandKey) {
  const { allowed, userLevel, required } = checkClearance(interaction.user.id, commandKey);
  if (!allowed) {
    const embed = buildDeniedEmbed(userLevel, required);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return false;
  }
  return true;
}

/**
 * Set a user's clearance level in their profile.
 */
function setClearance(userId, level) {
  const { updateProfile } = require('./database');
  return updateProfile(userId, { clearance: level });
}

module.exports = {
  CLEARANCE_NAMES,
  COMMAND_CLEARANCE,
  getUserClearance,
  getClearanceName,
  checkClearance,
  buildDeniedEmbed,
  requireClearance,
  setClearance
};
