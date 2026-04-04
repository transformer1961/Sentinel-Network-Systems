/**
 * RATE LIMIT MODULE
 * Prevents command spam by tracking per-user cooldowns.
 */

// Map of userId -> Map of commandName -> last used timestamp
const cooldowns = new Map();

// Cooldown durations in milliseconds per command group
const COOLDOWNS = {
  profile: 3000,   // 3 seconds
  case:    5000,   // 5 seconds
  watch:   5000,
  admin:   8000,
  report:  10000,
  help:    3000,
  default: 3000
};

/**
 * Check if a user is rate limited for a command.
 * @param {string} userId
 * @param {string} commandName
 * @returns {{ limited: boolean, remainingMs: number }}
 */
function checkRateLimit(userId, commandName) {
  if (!cooldowns.has(userId)) cooldowns.set(userId, new Map());

  const userCooldowns = cooldowns.get(userId);
  const cooldownMs = COOLDOWNS[commandName] || COOLDOWNS.default;
  const lastUsed = userCooldowns.get(commandName) || 0;
  const now = Date.now();
  const elapsed = now - lastUsed;

  if (elapsed < cooldownMs) {
    return { limited: true, remainingMs: cooldownMs - elapsed };
  }

  // Update last used time
  userCooldowns.set(commandName, now);
  return { limited: false, remainingMs: 0 };
}

/**
 * Middleware for interactions — replies with rate limit message if needed.
 * @returns {boolean} true if OK to proceed
 */
async function applyRateLimit(interaction) {
  const { limited, remainingMs } = checkRateLimit(
    interaction.user.id,
    interaction.commandName
  );

  if (limited) {
    const { EmbedBuilder } = require('discord.js');
    const config = require('../config.json');

    const embed = new EmbedBuilder()
      .setColor(config.warningColor)
      .setTitle(`${config.botName} // RATE LIMITED`)
      .setDescription(
        `\`\`\`\n` +
        `[ REQUEST THROTTLED ]\n` +
        `> Please wait ${(remainingMs / 1000).toFixed(1)}s before using this command again.\n` +
        `\`\`\``
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return false;
  }

  return true;
}

module.exports = { checkRateLimit, applyRateLimit };
