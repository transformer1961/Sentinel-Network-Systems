/**
 * PROFILE COMMAND GROUP — v2
 * Handles: /profile create | view | add-note | flag | search
 * New: rate limiting, critical flag alerts, paginated notes/flags
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../modules/database');
const { requireClearance, getClearanceName } = require('../../modules/permissions');
const { applyRateLimit } = require('../../modules/rateLimit');
const { alertCriticalFlag } = require('../../modules/alerts');
const { paginate, chunkArray } = require('../../modules/pagination');
const config = require('../../config.json');

const RISK_COLORS = {
  NONE: '#00ff88', LOW: '#aaffaa', MEDIUM: '#ffaa00', HIGH: '#ff5500', CRITICAL: '#ff0022'
};
const RISK_ICONS = {
  NONE: '⬜', LOW: '🟩', MEDIUM: '🟨', HIGH: '🟧', CRITICAL: '🟥'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Manage subject profiles in the Sentinel database')

    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Initialize a new subject profile')
      .addUserOption(opt => opt.setName('user').setDescription('Discord user to profile').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('Pull a subject profile from the database')
      .addUserOption(opt => opt.setName('user').setDescription('Discord user to look up').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('add-note')
      .setDescription('Append an agent note to a subject profile')
      .addUserOption(opt => opt.setName('user').setDescription('Target subject').setRequired(true))
      .addStringOption(opt => opt.setName('text').setDescription('Note content').setRequired(true).setMaxLength(500))
    )
    .addSubcommand(sub => sub
      .setName('flag')
      .setDescription('Apply a threat flag to a subject profile')
      .addUserOption(opt => opt.setName('user').setDescription('Target subject').setRequired(true))
      .addStringOption(opt => opt.setName('level').setDescription('Flag severity').setRequired(true)
        .addChoices(
          { name: 'LOW', value: 'LOW' },
          { name: 'MEDIUM', value: 'MEDIUM' },
          { name: 'HIGH', value: 'HIGH' },
          { name: 'CRITICAL', value: 'CRITICAL' }
        )
      )
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for flagging').setRequired(false).setMaxLength(300))
    )
    .addSubcommand(sub => sub
      .setName('search')
      .setDescription('Search profiles by risk level or watchlist status')
      .addStringOption(opt => opt.setName('risk').setDescription('Risk level filter').setRequired(true)
        .addChoices(
          { name: 'ALL FLAGGED', value: 'FLAGGED' },
          { name: 'CRITICAL', value: 'CRITICAL' },
          { name: 'HIGH', value: 'HIGH' },
          { name: 'MEDIUM', value: 'MEDIUM' },
          { name: 'LOW', value: 'LOW' },
          { name: 'WATCHLISTED', value: 'WATCHLISTED' }
        )
      )
    ),

  async execute(interaction) {
    if (!await applyRateLimit(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── /profile create ───────────────────────────────────────────────────
    if (sub === 'create') {
      if (!await requireClearance(interaction, 'profile.create')) return;
      const target = interaction.options.getUser('user');
      const existing = db.getProfile(target.id);

      if (existing) {
        return interaction.reply({
          embeds: [errorEmbed('PROFILE EXISTS', `\`${target.username}\` already has a profile. Use \`/profile view\` to access it.`)],
          ephemeral: true
        });
      }

      const profile = db.createProfile(target);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // PROFILE INITIALIZED`)
          .setThumbnail(target.displayAvatarURL())
          .setDescription(
            `\`\`\`\n[ NEW SUBJECT REGISTERED ]\n` +
            `> ID       : ${profile.userId}\n` +
            `> Username : ${profile.username}\n` +
            `> Risk     : ${profile.riskLevel}\n` +
            `> Clearance: LEVEL ${profile.clearance}\n` +
            `> Created  : ${new Date(profile.createdAt).toUTCString()}\n\`\`\``
          )
          .setFooter({ text: `Initiated by ${interaction.user.username} | Sentinel Network` })
          .setTimestamp()
        ]
      });
    }

    // ── /profile view ─────────────────────────────────────────────────────
    if (sub === 'view') {
      if (!await requireClearance(interaction, 'profile.view')) return;
      const target = interaction.options.getUser('user');
      const profile = db.getProfile(target.id);

      if (!profile) {
        return interaction.reply({
          embeds: [errorEmbed('NO RECORD FOUND', `\`${target.username}\` has no profile. Use \`/profile create\` first.`)],
          ephemeral: true
        });
      }

      const pages = [];

      // Page 1: Overview
      pages.push(new EmbedBuilder()
        .setColor(RISK_COLORS[profile.riskLevel] || config.embedColor)
        .setTitle(`${config.botName} // SUBJECT DOSSIER`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ OVERVIEW ]\n` +
          `> ID          : ${profile.userId}\n` +
          `> Username    : ${profile.username}\n` +
          `> Risk Level  : ${RISK_ICONS[profile.riskLevel]} ${profile.riskLevel}\n` +
          `> Clearance   : ${getClearanceName(profile.clearance)}\n` +
          `> Watchlisted : ${profile.watchlisted ? 'YES ⚠️' : 'NO'}\n` +
          `> Flags       : ${profile.flags.length}\n` +
          `> Notes       : ${profile.notes.length}\n` +
          `> Created     : ${new Date(profile.createdAt).toUTCString()}\n` +
          `> Updated     : ${new Date(profile.updatedAt).toUTCString()}\n\`\`\``
        )
        .setFooter({ text: `Queried by ${interaction.user.username} | Use arrows for notes & flags` })
        .setTimestamp()
      );

      // Page 2+: Notes
      const noteChunks = chunkArray(profile.notes, 8);
      if (noteChunks.length === 0) noteChunks.push([]);
      noteChunks.forEach((chunk, i) => {
        const lines = chunk.length > 0
          ? chunk.map((n, idx) => `  [${idx + 1}] ${new Date(n.addedAt).toISOString().split('T')[0]} — ${n.text.substring(0, 70)}${n.text.length > 70 ? '...' : ''}`).join('\n')
          : '  No notes on file.';

        pages.push(new EmbedBuilder()
          .setColor(RISK_COLORS[profile.riskLevel] || config.embedColor)
          .setTitle(`${config.botName} // SUBJECT DOSSIER`)
          .setDescription(`\`\`\`\n[ NOTES (${i + 1}/${noteChunks.length}) ]\n> Subject: ${profile.username}\n\n${lines}\n\`\`\``)
          .setFooter({ text: `${profile.notes.length} total note(s) | Sentinel Network` })
          .setTimestamp()
        );
      });

      // Page 3+: Flags
      const flagChunks = chunkArray(profile.flags, 6);
      if (flagChunks.length === 0) flagChunks.push([]);
      flagChunks.forEach((chunk, i) => {
        const lines = chunk.length > 0
          ? chunk.map((f, idx) => `  [${idx + 1}] ${RISK_ICONS[f.level]} ${f.level} — ${f.reason || 'No reason'}\n       ${new Date(f.addedAt).toISOString().split('T')[0]}`).join('\n')
          : '  No flags on file.';

        pages.push(new EmbedBuilder()
          .setColor(RISK_COLORS[profile.riskLevel] || config.embedColor)
          .setTitle(`${config.botName} // SUBJECT DOSSIER`)
          .setDescription(`\`\`\`\n[ FLAGS (${i + 1}/${flagChunks.length}) ]\n> Subject: ${profile.username}\n\n${lines}\n\`\`\``)
          .setFooter({ text: `${profile.flags.length} total flag(s) | Sentinel Network` })
          .setTimestamp()
        );
      });

      return paginate(interaction, pages);
    }

    // ── /profile add-note ─────────────────────────────────────────────────
    if (sub === 'add-note') {
      if (!await requireClearance(interaction, 'profile.add-note')) return;
      const target = interaction.options.getUser('user');
      const text = interaction.options.getString('text');
      const profile = db.addNoteToProfile(target.id, text);

      if (!profile) {
        return interaction.reply({
          embeds: [errorEmbed('NO RECORD FOUND', `\`${target.username}\` has no profile.`)],
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // NOTE APPENDED`)
          .setDescription(
            `\`\`\`\n[ INTELLIGENCE LOG UPDATED ]\n` +
            `> Subject : ${target.username}\n` +
            `> Agent   : ${interaction.user.username}\n` +
            `> Note    : ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}\n` +
            `> Total   : ${profile.notes.length} note(s) on file\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /profile flag ─────────────────────────────────────────────────────
    if (sub === 'flag') {
      if (!await requireClearance(interaction, 'profile.flag')) return;
      const target = interaction.options.getUser('user');
      const level = interaction.options.getString('level');
      const reason = interaction.options.getString('reason') || 'No reason specified';
      const profile = db.addFlagToProfile(target.id, level, reason);

      if (!profile) {
        return interaction.reply({
          embeds: [errorEmbed('NO RECORD FOUND', `\`${target.username}\` has no profile.`)],
          ephemeral: true
        });
      }

      if (level === 'CRITICAL') {
        alertCriticalFlag(interaction.client, target.username, target.id, interaction.user.username);
      }

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(RISK_COLORS[level])
          .setTitle(`${config.botName} // FLAG ISSUED`)
          .setDescription(
            `\`\`\`\n[ THREAT FLAG APPLIED ]\n` +
            `> Subject    : ${target.username}\n` +
            `> Flag Level : ${RISK_ICONS[level]} ${level}\n` +
            `> Reason     : ${reason}\n` +
            `> Risk Level : ${profile.riskLevel} (auto-updated)\n` +
            `> Issued By  : ${interaction.user.username}\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /profile search ───────────────────────────────────────────────────
    if (sub === 'search') {
      if (!await requireClearance(interaction, 'profile.view')) return;
      const filter = interaction.options.getString('risk');
      const allProfiles = Object.values(db.getAllProfiles());

      let filtered;
      if (filter === 'FLAGGED') filtered = allProfiles.filter(p => p.riskLevel !== 'NONE');
      else if (filter === 'WATCHLISTED') filtered = allProfiles.filter(p => p.watchlisted);
      else filtered = allProfiles.filter(p => p.riskLevel === filter);

      if (filtered.length === 0) {
        return interaction.reply({
          embeds: [errorEmbed('NO RESULTS', `No profiles found matching: \`${filter}\``)],
          ephemeral: true
        });
      }

      const chunks = chunkArray(filtered, 8);
      const pages = chunks.map((chunk, i) => {
        const lines = chunk.map(p =>
          `  ${RISK_ICONS[p.riskLevel] || '⬜'} ${p.username.padEnd(20)} | ${p.riskLevel.padEnd(8)} | ${p.watchlisted ? '👁 WATCHED' : '        '}`
        ).join('\n');

        return new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // PROFILE SEARCH`)
          .setDescription(
            `\`\`\`\n[ FILTER: ${filter} — ${filtered.length} RESULT(S) ]\n\n` +
            `  USERNAME             | RISK     | STATUS\n` +
            `  ${'─'.repeat(44)}\n${lines}\n\`\`\``
          )
          .setFooter({ text: `Page ${i + 1}/${chunks.length} | Sentinel Network` })
          .setTimestamp();
      });

      return paginate(interaction, pages);
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
