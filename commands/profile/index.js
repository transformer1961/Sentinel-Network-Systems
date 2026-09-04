/**
 * PROFILE COMMAND GROUP v3
 * /profile create | view | add-note | remove-note | flag | severity | escalate | search
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db     = require('../../modules/database');
const perms  = require('../../modules/permissions');
const rl     = require('../../modules/rateLimit');
const alerts = require('../../modules/alerts');
const { paginate, chunk } = require('../../modules/pagination');
const config = require('../../modules/config');

const SEV_COLORS = alerts.SEVERITY_COLORS;
const SEV_ICONS  = alerts.SEVERITY_ICONS;

function sevName(n) { return config.severityNames[String(n)] || 'Unknown'; }
function err(title, desc) {
  return new EmbedBuilder().setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${desc}\n\`\`\``)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Manage subject profiles')

    .addSubcommand(s => s.setName('create').setDescription('Create a new subject profile')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

    .addSubcommand(s => s.setName('view').setDescription('View a subject dossier')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

    .addSubcommand(s => s.setName('add-note').setDescription('Add a note to a profile')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(o => o.setName('text').setDescription('Note content').setRequired(true).setMaxLength(500)))

    .addSubcommand(s => s.setName('remove-note').setDescription('Remove a note from a profile')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(o => o.setName('noteid').setDescription('Note ID (from /profile view)').setRequired(true)))

    .addSubcommand(s => s.setName('flag').setDescription('Flag a user with a severity level')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('level').setDescription('Severity 1-5').setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption(o => o.setName('reason').setDescription('Reason for flag').setRequired(true).setMaxLength(300)))

    .addSubcommand(s => s.setName('severity').setDescription('Check current severity/risk of a subject')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

    .addSubcommand(s => s.setName('escalate').setDescription('Escalate severity level (Director+ only)')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('level').setDescription('New severity (must be higher than current)').setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption(o => o.setName('reason').setDescription('Escalation reason').setRequired(true).setMaxLength(400)))

    .addSubcommand(s => s.setName('search').setDescription('Search profiles by risk level or status')
      .addStringOption(o => o.setName('filter').setDescription('Filter').setRequired(true)
        .addChoices(
          { name: 'All Flagged',   value: 'FLAGGED'      },
          { name: 'Risk Level 1 — Low',     value: '1' },
          { name: 'Risk Level 2 — Medium',  value: '2' },
          { name: 'Risk Level 3 — High',    value: '3' },
          { name: 'Risk Level 4 — Critical',value: '4' },
          { name: 'Risk Level 5 — Extreme', value: '5' },
          { name: 'Watchlisted',   value: 'WATCHLISTED'  },
          { name: 'Blacklisted',   value: 'BLACKLISTED'  }
        )
      )),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── create ────────────────────────────────────────────────────────────
    if (sub === 'create') {
      if (!await perms.requireAccess(interaction, 'profile.create')) return;
      const target = interaction.options.getUser('user');

      if (db.getProfile(target.id)) {
        return interaction.reply({ embeds: [err('PROFILE EXISTS', `\`${target.username}\` already has a profile.`)], ephemeral: true });
      }

      const p = db.createProfile(target, interaction.guildId);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // PROFILE CREATED`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ NEW SUBJECT REGISTERED ]\n` +
          `> ID       : ${p.userId}\n` +
          `> Username : ${p.username}\n` +
          `> Risk     : NONE\n` +
          `> Server   : ${interaction.guild?.name || 'Unknown'}\n` +
          `> Created  : ${new Date(p.createdAt).toUTCString()}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── view ──────────────────────────────────────────────────────────────
    if (sub === 'view') {
      if (!await perms.requireAccess(interaction, 'profile.view')) return;
      const target = interaction.options.getUser('user');
      const p = db.getProfile(target.id);
      if (!p) return interaction.reply({ embeds: [err('NO RECORD', `No profile for \`${target.username}\`.`)], ephemeral: true });

      const userClearance = perms.getUserClearance(interaction.user.id);
      const isGlobal = userClearance >= 4 || interaction.guildId === config.snServerId;

      const pages = [];

      // Page 1: Overview
      pages.push(new EmbedBuilder()
        .setColor(SEV_COLORS[p.riskLevel] || '#888')
        .setTitle(`${config.botName} // SUBJECT DOSSIER`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ OVERVIEW ]\n` +
          `> Username    : ${p.username}\n` +
          `> ID          : ${p.userId}\n` +
          `> Risk Level  : ${SEV_ICONS[p.riskLevel]} ${sevName(p.riskLevel)} (${p.riskLevel})\n` +
          `> Clearance   : ${perms.getRoleName(p.clearance)}\n` +
          `> Watchlisted : ${p.watchlisted ? '⚠️ YES' : 'NO'}\n` +
          `> Blacklisted : ${p.blacklisted ? '⛔ YES' : 'NO'}\n` +
          `> Flags       : ${p.flags.length}\n` +
          `> Notes       : ${p.notes.length}\n` +
          `> Known Srvrs : ${isGlobal ? p.servers.length : '—'}\n` +
          `> Created     : ${new Date(p.createdAt).toISOString().split('T')[0]}\n\`\`\``
        )
        .setFooter({ text: `Page 1 | Queried by ${interaction.user.username}` })
        .setTimestamp()
      );

      // Page 2: Notes
      const noteChunks = chunk(p.notes, 6);
      if (!noteChunks.length) noteChunks.push([]);
      noteChunks.forEach((ch, i) => {
        const lines = ch.length
          ? ch.map(n => `  [${n.id}]\n  "${n.text.substring(0, 60)}${n.text.length > 60 ? '...' : ''}"`).join('\n')
          : '  No notes.';
        pages.push(new EmbedBuilder()
          .setColor(SEV_COLORS[p.riskLevel] || '#888')
          .setTitle(`${config.botName} // NOTES (${i + 1}/${noteChunks.length})`)
          .setDescription(`\`\`\`\n[ SUBJECT: ${p.username} ]\n\n${lines}\n\`\`\``)
          .setFooter({ text: `${p.notes.length} total note(s)` }).setTimestamp()
        );
      });

      // Page 3: Flags
      const flagChunks = chunk(p.flags, 5);
      if (!flagChunks.length) flagChunks.push([]);
      flagChunks.forEach((ch, i) => {
        const lines = ch.length
          ? ch.map((f, idx) => `  [${idx + 1}] ${SEV_ICONS[f.level]} L${f.level} — ${f.reason}\n       ${new Date(f.addedAt).toISOString().split('T')[0]}`).join('\n')
          : '  No flags.';
        pages.push(new EmbedBuilder()
          .setColor(SEV_COLORS[p.riskLevel] || '#888')
          .setTitle(`${config.botName} // FLAGS (${i + 1}/${flagChunks.length})`)
          .setDescription(`\`\`\`\n[ SUBJECT: ${p.username} ]\n\n${lines}\n\`\`\``)
          .setFooter({ text: `${p.flags.length} total flag(s)` }).setTimestamp()
        );
      });

      return paginate(interaction, pages);
    }

    // ── add-note ──────────────────────────────────────────────────────────
    if (sub === 'add-note') {
      if (!await perms.requireAccess(interaction, 'profile.add-note')) return;
      const target = interaction.options.getUser('user');
      const text   = interaction.options.getString('text');
      const p = db.addNote(target.id, text, interaction.user.username, interaction.guildId);
      if (!p) return interaction.reply({ embeds: [err('NO RECORD', `No profile for \`${target.username}\`.`)], ephemeral: true });

      db.appendLog(target.id, 'NOTE_ADDED', `Note by ${interaction.user.username}: ${text.substring(0, 60)}`, interaction.guildId);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // NOTE APPENDED`)
        .setDescription(
          `\`\`\`\n[ INTELLIGENCE LOG UPDATED ]\n` +
          `> Subject : ${target.username}\n` +
          `> Agent   : ${interaction.user.username}\n` +
          `> Note    : ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}\n` +
          `> Total   : ${p.notes.length} note(s)\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── remove-note ───────────────────────────────────────────────────────
    if (sub === 'remove-note') {
      if (!await perms.requireAccess(interaction, 'profile.remove-note')) return;
      const target = interaction.options.getUser('user');
      const noteId = interaction.options.getString('noteid');
      const result = db.removeNote(target.id, noteId);

      if (!result) return interaction.reply({ embeds: [err('NO RECORD', `No profile for \`${target.username}\`.`)], ephemeral: true });
      if (result.error === 'NOTE_NOT_FOUND') return interaction.reply({ embeds: [err('NOT FOUND', `Note ID \`${noteId}\` not found on this profile.`)], ephemeral: true });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // NOTE REMOVED`)
        .setDescription(`\`\`\`\n[ NOTE DELETED ]\n> Subject : ${target.username}\n> Note ID : ${noteId}\n> By      : ${interaction.user.username}\n\`\`\``)
        .setTimestamp()
      ]});
    }

    // ── flag ──────────────────────────────────────────────────────────────
    if (sub === 'flag') {
      if (!await perms.requireAccess(interaction, 'profile.flag')) return;
      const target = interaction.options.getUser('user');
      const level  = interaction.options.getInteger('level');
      const reason = interaction.options.getString('reason');

      if (!db.getProfile(target.id)) db.createProfile(target, interaction.guildId);
      const p = db.addFlag(target.id, level, reason, interaction.user.username, interaction.guildId);

      db.appendLog(target.id, 'FLAG_ADDED', `L${level} flag by ${interaction.user.username}: ${reason}`, interaction.guildId);

      if (level >= 4) {
        alerts.alertEscalation(interaction.client, target.username, target.id, level, reason, interaction.user.username);
      }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(SEV_COLORS[level])
        .setTitle(`${config.botName} // FLAG ISSUED`)
        .setDescription(
          `\`\`\`\n[ THREAT FLAG APPLIED ]\n` +
          `> Subject    : ${target.username}\n` +
          `> Severity   : ${SEV_ICONS[level]} ${sevName(level)} (Level ${level})\n` +
          `> Reason     : ${reason}\n` +
          `> Risk Now   : ${p.riskLevel}\n` +
          `> Issued By  : ${interaction.user.username}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── severity ──────────────────────────────────────────────────────────
    if (sub === 'severity') {
      if (!await perms.requireAccess(interaction, 'profile.severity')) return;
      const target = interaction.options.getUser('user');
      const p = db.getProfile(target.id);
      if (!p) return interaction.reply({ embeds: [err('NO RECORD', `No profile for \`${target.username}\`.`)], ephemeral: true });

      const topFlags = p.flags.slice(-3).map(f =>
        `  ${SEV_ICONS[f.level]} L${f.level} — ${f.reason.substring(0, 50)}`
      ).join('\n') || '  No flags on record.';

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(SEV_COLORS[p.riskLevel] || '#888')
        .setTitle(`${config.botName} // SEVERITY ASSESSMENT`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ RISK PROFILE ]\n` +
          `> Subject    : ${p.username}\n` +
          `> Risk Level : ${SEV_ICONS[p.riskLevel]} ${sevName(p.riskLevel)} (${p.riskLevel}/5)\n` +
          `> Blacklisted: ${p.blacklisted ? '⛔ YES' : 'NO'}\n` +
          `> Watchlisted: ${p.watchlisted ? '⚠️ YES' : 'NO'}\n` +
          `> Total Flags: ${p.flags.length}\n\n` +
          `  RECENT FLAGS:\n${topFlags}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── escalate ──────────────────────────────────────────────────────────
    if (sub === 'escalate') {
      if (!await perms.requireAccess(interaction, 'profile.escalate')) return;
      const target = interaction.options.getUser('user');
      const level  = interaction.options.getInteger('level');
      const reason = interaction.options.getString('reason');

      let p = db.getProfile(target.id);
      if (!p) p = db.createProfile(target, interaction.guildId);

      if (level <= (p.riskLevel || 0)) {
        return interaction.reply({ embeds: [err('INVALID ESCALATION', `New severity (${level}) must be higher than current (${p.riskLevel}).`)], ephemeral: true });
      }

      db.addFlag(target.id, level, `[ESCALATION] ${reason}`, interaction.user.username, interaction.guildId);
      db.updateProfile(target.id, { riskLevel: level });
      db.appendLog(target.id, 'ESCALATION', `L${level} escalation by ${interaction.user.username}: ${reason}`, interaction.guildId);

      await alerts.alertEscalation(interaction.client, target.username, target.id, level, reason, interaction.user.username);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(SEV_COLORS[level])
        .setTitle(`${config.botName} // 🚨 SEVERITY ESCALATED`)
        .setDescription(
          `\`\`\`\n[ ESCALATION AUTHORIZED ]\n` +
          `> Subject    : ${target.username}\n` +
          `> New Level  : ${SEV_ICONS[level]} ${sevName(level)} (${level}/5)\n` +
          `> Reason     : ${reason}\n` +
          `> Director   : ${interaction.user.username}\n` +
          `> Alert Sent : YES — SN Staff notified\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── search ────────────────────────────────────────────────────────────
    if (sub === 'search') {
      if (!await perms.requireAccess(interaction, 'profile.search')) return;
      const filter = interaction.options.getString('filter');
      const all    = Object.values(db.getAllProfiles());

      let filtered;
      if      (filter === 'FLAGGED')     filtered = all.filter(p => p.riskLevel > 0);
      else if (filter === 'WATCHLISTED') filtered = all.filter(p => p.watchlisted);
      else if (filter === 'BLACKLISTED') filtered = all.filter(p => p.blacklisted);
      else                               filtered = all.filter(p => p.riskLevel === parseInt(filter));

      if (!filtered.length) return interaction.reply({ embeds: [err('NO RESULTS', `No profiles match filter: \`${filter}\``)], ephemeral: true });

      const chunks = chunk(filtered, 8);
      const pages  = chunks.map((ch, i) => {
        const lines = ch.map(p =>
          `  ${SEV_ICONS[p.riskLevel] || '⬜'} ${p.username.padEnd(22)} L${p.riskLevel} ${p.blacklisted ? '⛔' : '  '} ${p.watchlisted ? '👁' : ''}`
        ).join('\n');

        return new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // PROFILE SEARCH`)
          .setDescription(
            `\`\`\`\n[ FILTER: ${filter} — ${filtered.length} RESULT(S) ]\n\n` +
            `  ICON USERNAME                RISK ⛔ 👁\n` +
            `  ${'─'.repeat(44)}\n${lines}\n\`\`\``
          )
          .setFooter({ text: `Page ${i + 1}/${chunks.length}` }).setTimestamp();
      });

      return paginate(interaction, pages);
    }
  }
};
