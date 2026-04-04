/**
 * HELP COMMAND
 * Shows all commands organized by clearance level required.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserClearance, getClearanceName } = require('../../modules/permissions');
const { applyRateLimit } = require('../../modules/rateLimit');
const config = require('../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display all Sentinel Network commands and clearance requirements'),

  async execute(interaction) {
    if (!await applyRateLimit(interaction)) return;

    const userLevel = getUserClearance(interaction.user.id);

    const ALL_COMMANDS = [
      // Profile
      { cmd: '/profile create [user]',       clr: 1,   desc: 'Create a subject profile' },
      { cmd: '/profile view [user]',         clr: 1,   desc: 'View a subject dossier' },
      { cmd: '/profile search [filter]',     clr: 1,   desc: 'Search profiles by risk' },
      { cmd: '/profile add-note [user]',     clr: 2,   desc: 'Append an intel note' },
      { cmd: '/profile flag [user] [level]', clr: 3,   desc: 'Apply threat flag' },
      // Case
      { cmd: '/case open [title]',           clr: 2,   desc: 'Open investigation case' },
      { cmd: '/case add-evidence [id]',      clr: 2,   desc: 'File evidence to case' },
      { cmd: '/case list',                   clr: 2,   desc: 'List all cases' },
      { cmd: '/case assign [id] [user]',     clr: 3,   desc: 'Assign agent to case' },
      { cmd: '/case close [id]',             clr: 3,   desc: 'Close investigation' },
      // Watch
      { cmd: '/watch log [user]',            clr: 2,   desc: 'View surveillance log' },
      { cmd: '/watch list',                  clr: 2,   desc: 'List watched subjects' },
      { cmd: '/watch add [user]',            clr: 3,   desc: 'Add to watchlist' },
      { cmd: '/watch remove [user]',         clr: 3,   desc: 'Remove from watchlist' },
      // Report
      { cmd: '/report generate [user]',      clr: 2,   desc: 'Full subject report' },
      { cmd: '/report summary',              clr: 3,   desc: 'Network threat summary' },
      // Admin
      { cmd: '/admin audit',                 clr: 3,   desc: 'System audit dashboard' },
      { cmd: '/admin promote [user]',        clr: 4,   desc: 'Set agent clearance' },
    ];

    // Group by clearance
    const groups = {};
    for (const c of ALL_COMMANDS) {
      if (!groups[c.clr]) groups[c.clr] = [];
      groups[c.clr].push(c);
    }

    const fields = [];
    for (const [level, cmds] of Object.entries(groups).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const lines = cmds.map(c => {
        const accessible = userLevel >= c.clr;
        return `  ${accessible ? '✅' : '🔒'} ${c.cmd.padEnd(32)} ${c.desc}`;
      }).join('\n');

      fields.push({
        name: `🔐 ${getClearanceName(Number(level))} Required`,
        value: `\`\`\`\n${lines}\n\`\`\``,
        inline: false
      });
    }

    const embed = new EmbedBuilder()
      .setColor(config.accentColor)
      .setTitle(`${config.botName} // COMMAND MANIFEST`)
      .setDescription(
        `\`\`\`\n[ SENTINEL NETWORK — HELP SYSTEM ]\n` +
        `> Your Clearance : ${getClearanceName(userLevel)}\n` +
        `> ✅ = Accessible  |  🔒 = Insufficient clearance\n\`\`\``
      )
      .addFields(...fields)
      .setFooter({ text: `Use /admin promote to elevate agent clearance | Sentinel Network` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
