/**
 * ADMIN COMMAND GROUP — v2
 * Handles: /admin promote | audit
 * New: rate limiting, paginated audit
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../modules/database');
const inv = require('../../modules/investigation');
const surv = require('../../modules/surveillance');
const {
  requireClearance, setClearance, getClearanceName, getUserClearance
} = require('../../modules/permissions');
const { applyRateLimit } = require('../../modules/rateLimit');
const config = require('../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administrative controls for Sentinel Network')

    .addSubcommand(sub => sub
      .setName('promote')
      .setDescription("Set an agent's clearance level")
      .addUserOption(opt => opt.setName('user').setDescription('Agent to promote/demote').setRequired(true))
      .addNumberOption(opt => opt.setName('level').setDescription('New clearance level').setRequired(true)
        .addChoices(
          { name: 'Level 1 — Basic',                  value: 1   },
          { name: 'Level 1.5 — Trainee Agent',        value: 1.5 },
          { name: 'Level 2 — Agent',                  value: 2   },
          { name: 'Level 2.5 — Special Agent',        value: 2.5 },
          { name: 'Level 3 — Senior Agent',           value: 3   },
          { name: 'Level 3.5 — Assistant Supervisor', value: 3.5 },
          { name: 'Level 4 — Supervisor',             value: 4   },
          { name: 'Level 4.5 — Deputy Director',      value: 4.5 },
          { name: 'Level 5 — Director',               value: 5   },
          { name: 'Level 6 — System Owner',           value: 6   }
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('audit')
      .setDescription('Run a full system audit report')
    ),

  async execute(interaction) {
    if (!await applyRateLimit(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── /admin promote ────────────────────────────────────────────────────
    if (sub === 'promote') {
      if (!await requireClearance(interaction, 'admin.promote')) return;

      const target = interaction.options.getUser('user');
      const newLevel = interaction.options.getNumber('level');
      const issuerLevel = getUserClearance(interaction.user.id);

      if (newLevel >= issuerLevel && issuerLevel < 6) {
        return interaction.reply({
          embeds: [errorEmbed('PROMOTION DENIED',
            `You cannot promote to a level equal to or above your own.\nYour clearance: ${getClearanceName(issuerLevel)}`)],
          ephemeral: true
        });
      }

      let profile = db.getProfile(target.id);
      if (!profile) profile = db.createProfile(target);

      const oldLevel = profile.clearance;
      setClearance(target.id, newLevel);

      const action = newLevel > oldLevel ? 'PROMOTED' : newLevel < oldLevel ? 'DEMOTED' : 'UNCHANGED';
      const color = newLevel > oldLevel ? config.accentColor : newLevel < oldLevel ? config.dangerColor : '#888888';

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle(`${config.botName} // CLEARANCE ${action}`)
          .setThumbnail(target.displayAvatarURL())
          .setDescription(
            `\`\`\`\n[ CLEARANCE LEVEL UPDATED ]\n` +
            `> Agent    : ${target.username}\n` +
            `> Previous : ${getClearanceName(oldLevel)}\n` +
            `> New      : ${getClearanceName(newLevel)}\n` +
            `> Action   : ${action}\n` +
            `> Issued By: ${interaction.user.username}\n` +
            `> Time     : ${new Date().toUTCString()}\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /admin audit ──────────────────────────────────────────────────────
    if (sub === 'audit') {
      if (!await requireClearance(interaction, 'admin.audit')) return;

      const allProfiles = db.getAllProfiles();
      const allCases = inv.getAllCases();
      const watchlist = surv.getWatchlist();

      const profiles = Object.values(allProfiles);
      const cases = Object.values(allCases);

      const totalProfiles   = profiles.length;
      const flaggedProfiles = profiles.filter(p => p.riskLevel !== 'NONE').length;
      const criticalCount   = profiles.filter(p => p.riskLevel === 'CRITICAL').length;
      const openCases       = cases.filter(c => c.status === 'OPEN').length;
      const reviewCases     = cases.filter(c => c.status === 'UNDER REVIEW').length;
      const closedCases     = cases.filter(c => c.status === 'CLOSED').length;

      const riskOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };
      const topRisk = profiles
        .filter(p => p.riskLevel !== 'NONE')
        .sort((a, b) => (riskOrder[b.riskLevel] || 0) - (riskOrder[a.riskLevel] || 0))
        .slice(0, 5)
        .map(p => `  🟥 ${p.username.padEnd(20)} ${p.riskLevel}`)
        .join('\n') || '  None flagged.';

      const clearanceDist = {};
      for (const p of profiles) {
        const lvl = p.clearance || 1;
        clearanceDist[lvl] = (clearanceDist[lvl] || 0) + 1;
      }
      const distLines = Object.entries(clearanceDist)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([lvl, count]) => `  ${getClearanceName(Number(lvl))}: ${count}`)
        .join('\n') || '  No data.';

      const recentCases = cases
        .filter(c => c.status !== 'CLOSED')
        .slice(-4)
        .map(c => `  🟢 ${c.caseId} — ${c.title.substring(0, 30)}`)
        .join('\n') || '  No active cases.';

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // SYSTEM AUDIT REPORT`)
          .setDescription(
            `\`\`\`\n[ SENTINEL NETWORK — FULL STATUS ]\n` +
            `> Audit Time : ${new Date().toUTCString()}\n` +
            `> Auditor    : ${interaction.user.username}\n\`\`\``
          )
          .addFields(
            {
              name: '👤 SUBJECTS',
              value: `\`\`\`\nTotal Profiled : ${totalProfiles}\nFlagged        : ${flaggedProfiles}\nCritical Risk  : ${criticalCount}\nWatchlisted    : ${watchlist.length}\n\`\`\``,
              inline: true
            },
            {
              name: '📁 CASES',
              value: `\`\`\`\nTotal     : ${cases.length}\nOpen      : ${openCases}\nReview    : ${reviewCases}\nClosed    : ${closedCases}\n\`\`\``,
              inline: true
            },
            {
              name: '🚨 TOP RISK SUBJECTS',
              value: `\`\`\`\n${topRisk}\n\`\`\``,
              inline: false
            },
            {
              name: '📋 ACTIVE CASES',
              value: `\`\`\`\n${recentCases}\n\`\`\``,
              inline: false
            },
            {
              name: '🔐 CLEARANCE DISTRIBUTION',
              value: `\`\`\`\n${distLines}\n\`\`\``,
              inline: false
            }
          )
          .setFooter({ text: `Sentinel Network // Audit complete.` })
          .setTimestamp()
        ]
      });
    }
  }
};

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${description}\n\`\`\``)
    .setTimestamp();
}
