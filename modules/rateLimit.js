/**
 * RATE LIMIT MODULE
 * Per-user, per-command cooldowns.
 */

const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const cooldowns = new Map();
const LIMITS = { profile: 3000, case: 5000, watch: 5000, admin: 8000, report: 10000, help: 3000 };

function check(userId, cmd) {
  if (!cooldowns.has(userId)) cooldowns.set(userId, new Map());
  const ms   = LIMITS[cmd] || 3000;
  const last = cooldowns.get(userId).get(cmd) || 0;
  const diff = Date.now() - last;
  if (diff < ms) return { limited: true, remainingMs: ms - diff };
  cooldowns.get(userId).set(cmd, Date.now());
  return { limited: false };
}

async function apply(interaction) {
  const { limited, remainingMs } = check(interaction.user.id, interaction.commandName);
  if (limited) {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle(`${config.botName} // RATE LIMITED`)
        .setDescription(`\`\`\`\n[ THROTTLED ]\n> Wait ${(remainingMs / 1000).toFixed(1)}s before using this command again.\n\`\`\``)
        .setTimestamp()
      ],
      ephemeral: true
    });
    return false;
  }
  return true;
}

module.exports = { apply, applyRateLimit: apply };
