/**
 * CASE COMMAND GROUP v3
 * /case open | view | list | add-evidence | assign | close
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db     = require('../../modules/database');
const perms  = require('../../modules/permissions');
const rl     = require('../../modules/rateLimit');
const alerts = require('../../modules/alerts');
const { paginate, chunk } = require('../../modules/pagination');
const config = require('../../modules/config');

const ST_COLOR = { 'OPEN': '#00ff88', 'UNDER REVIEW': '#ffaa00', 'CLOSED': '#888888' };
const ST_ICON  = { 'OPEN': '🟢', 'UNDER REVIEW': '🟡', 'CLOSED': '⬛' };

function err(title, desc) {
  return new EmbedBuilder().setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${desc}\n\`\`\``)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Manage investigation cases')

    .addSubcommand(s => s.setName('open').setDescription('Open a new investigation case')
      .addStringOption(o => o.setName('title').setDescription('Case title').setRequired(true).setMaxLength(100)))

    .addSubcommand(s => s.setName('view').setDescription('View a specific case in detail')
      .addStringOption(o => o.setName('caseid').setDescription('Case ID (e.g. CASE-0001)').setRequired(true)))

    .addSubcommand(s => s.setName('list').setDescription('List cases with optional status filter')
      .addStringOption(o => o.setName('status').setDescription('Filter by status').setRequired(false)
        .addChoices(
          { name: 'All',          value: 'ALL'          },
          { name: 'Open',         value: 'OPEN'         },
          { name: 'Under Review', value: 'UNDER REVIEW' },
          { name: 'Closed',       value: 'CLOSED'       }
        )))

    .addSubcommand(s => s.setName('add-evidence').setDescription('Submit evidence to an open case')
      .addStringOption(o => o.setName('caseid').setDescription('Case ID').setRequired(true))
      .addStringOption(o => o.setName('text').setDescription('Evidence description or URL').setRequired(true).setMaxLength(800)))

    .addSubcommand(s => s.setName('assign').setDescription('Assign an agent to a case')
      .addStringOption(o => o.setName('caseid').setDescription('Case ID').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Agent to assign').setRequired(true)))

    .addSubcommand(s => s.setName('close').setDescription('Close an investigation case (Operations Lead+)')
      .addStringOption(o => o.setName('caseid').setDescription('Case ID').setRequired(true)))

    .addSubcommand(s => s.setName('reopen').setDescription('Reopen a closed case (Operations Lead+)')
      .addStringOption(o => o.setName('caseid').setDescription('Case ID').setRequired(true))),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── open ──────────────────────────────────────────────────────────────
    if (sub === 'open') {
      if (!await perms.requireAccess(interaction, 'case.open')) return;
      const title = interaction.options.getString('title');
      const c     = db.createCase(title, interaction.user.id, interaction.guildId);

      db.appendLog(interaction.user.id, 'CASE_OPENED', `Opened ${c.caseId}: ${title}`, interaction.guildId);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(ST_COLOR['OPEN'])
        .setTitle(`${config.botName} // CASE OPENED`)
        .setDescription(
          `\`\`\`\n[ NEW INVESTIGATION ]\n` +
          `> Case ID  : ${c.caseId}\n` +
          `> Title    : ${c.title}\n` +
          `> Status   : 🟢 OPEN\n` +
          `> Agent    : ${interaction.user.username}\n` +
          `> Server   : ${interaction.guild?.name}\n` +
          `> Opened   : ${new Date(c.createdAt).toUTCString()}\n\`\`\``
        )
        .setFooter({ text: `Submit evidence: /case add-evidence ${c.caseId}` })
        .setTimestamp()
      ]});
    }

    // ── view ──────────────────────────────────────────────────────────────
    if (sub === 'view') {
      if (!await perms.requireAccess(interaction, 'case.view')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const c = db.getCase(caseId);
      if (!c) return interaction.reply({ embeds: [err('NOT FOUND', `No case with ID \`${caseId}\`.`)], ephemeral: true });

      const pages = [];

      // Page 1: Case overview
      pages.push(new EmbedBuilder()
        .setColor(ST_COLOR[c.status] || '#888')
        .setTitle(`${config.botName} // CASE FILE`)
        .setDescription(
          `\`\`\`\n[ ${c.caseId} — OVERVIEW ]\n` +
          `> Title    : ${c.title}\n` +
          `> Status   : ${ST_ICON[c.status]} ${c.status}\n` +
          `> Agents   : ${c.assignedAgents.length}\n` +
          `> Evidence : ${c.evidence.length} item(s)\n` +
          `> Opened   : ${new Date(c.createdAt).toUTCString()}\n` +
          `> Updated  : ${new Date(c.updatedAt).toUTCString()}\n` +
          (c.closedAt ? `> Closed   : ${new Date(c.closedAt).toUTCString()}\n` : '') +
          `\`\`\``
        )
        .setFooter({ text: `Page 1 | Sentinel Network` }).setTimestamp()
      );

      // Page 2: Evidence
      const evdChunks = chunk(c.evidence, 5);
      if (!evdChunks.length) evdChunks.push([]);
      evdChunks.forEach((ch, i) => {
        const lines = ch.length
          ? ch.map((e, idx) => `  [${idx + 1}] ${e.text.substring(0, 80)}${e.text.length > 80 ? '...' : ''}\n       By: ${e.submittedBy} | ${new Date(e.submittedAt).toISOString().split('T')[0]}`).join('\n')
          : '  No evidence filed.';

        pages.push(new EmbedBuilder()
          .setColor(ST_COLOR[c.status] || '#888')
          .setTitle(`${config.botName} // EVIDENCE (${i + 1}/${evdChunks.length})`)
          .setDescription(`\`\`\`\n[ ${c.caseId} ]\n\n${lines}\n\`\`\``)
          .setFooter({ text: `${c.evidence.length} total` }).setTimestamp()
        );
      });

      return paginate(interaction, pages);
    }

    // ── list ──────────────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!await perms.requireAccess(interaction, 'case.list')) return;
      const statusFilter = interaction.options.getString('status') || 'ALL';
      const all = Object.values(db.getAllCases());
      const filtered = statusFilter === 'ALL' ? all : all.filter(c => c.status === statusFilter);

      if (!filtered.length) return interaction.reply({ embeds: [err('NO CASES', `No cases found.`)], ephemeral: true });

      const stOrder = { 'OPEN': 0, 'UNDER REVIEW': 1, 'CLOSED': 2 };
      filtered.sort((a, b) => (stOrder[a.status] || 0) - (stOrder[b.status] || 0));

      const chunks = chunk(filtered, 6);
      const pages  = chunks.map((ch, i) => {
        const lines = ch.map(c => `  ${ST_ICON[c.status]} ${c.caseId}  ${c.title.substring(0, 28).padEnd(28)} EVD:${c.evidence.length}`).join('\n');
        return new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // CASE REGISTRY`)
          .setDescription(
            `\`\`\`\n[ ${statusFilter} — ${filtered.length} CASE(S) ]\n\n` +
            `  ST CASE-ID   TITLE                        EVD\n` +
            `  ${'─'.repeat(46)}\n${lines}\n\`\`\``
          )
          .setFooter({ text: `Page ${i + 1}/${chunks.length}` }).setTimestamp();
      });

      return paginate(interaction, pages);
    }

    // ── add-evidence ──────────────────────────────────────────────────────
    if (sub === 'add-evidence') {
      if (!await perms.requireAccess(interaction, 'case.add-evidence')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const text   = interaction.options.getString('text');
      const result = db.addEvidence(caseId, text, interaction.user.username);

      if (!result) return interaction.reply({ embeds: [err('NOT FOUND', `No case \`${caseId}\`.`)], ephemeral: true });
      if (result.error === 'CASE_CLOSED') return interaction.reply({ embeds: [err('CASE CLOSED', 'Cannot add evidence to a closed case.')], ephemeral: true });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(ST_COLOR['UNDER REVIEW'])
        .setTitle(`${config.botName} // EVIDENCE FILED`)
        .setDescription(
          `\`\`\`\n[ EVIDENCE SUBMITTED ]\n` +
          `> Case ID   : ${result.caseId}\n` +
          `> Status    : 🟡 ${result.status}\n` +
          `> Filed By  : ${interaction.user.username}\n` +
          `> Evidence  :\n  "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"\n` +
          `> Total EVD : ${result.evidence.length}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── assign ────────────────────────────────────────────────────────────
    if (sub === 'assign') {
      if (!await perms.requireAccess(interaction, 'case.assign')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const agent  = interaction.options.getUser('user');
      const result = db.assignAgent(caseId, agent.id);

      if (!result) return interaction.reply({ embeds: [err('NOT FOUND', `No case \`${caseId}\`.`)], ephemeral: true });
      if (result.error === 'CASE_CLOSED') return interaction.reply({ embeds: [err('CASE CLOSED', 'Cannot assign to a closed case.')], ephemeral: true });

      alerts.alertCaseAssigned(interaction.client, agent.id, result, interaction.user.username);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // AGENT ASSIGNED`)
        .setDescription(
          `\`\`\`\n[ ASSIGNMENT UPDATED ]\n` +
          `> Case ID : ${result.caseId}\n` +
          `> Agent   : ${agent.username}\n` +
          `> Total   : ${result.assignedAgents.length} agent(s)\n` +
          `> Note    : Agent notified via DM\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── close ─────────────────────────────────────────────────────────────
    if (sub === 'close') {
      if (!await perms.requireAccess(interaction, 'case.close')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const result = db.closeCase(caseId, interaction.user.username);

      if (!result) return interaction.reply({ embeds: [err('NOT FOUND', `No case \`${caseId}\`.`)], ephemeral: true });
      if (result.error === 'ALREADY_CLOSED') return interaction.reply({ embeds: [err('ALREADY CLOSED', `Case \`${caseId}\` is already closed.`)], ephemeral: true });

      const mins = Math.floor((new Date(result.closedAt) - new Date(result.createdAt)) / 60000);
      db.appendLog(interaction.user.id, 'CASE_CLOSED', `Closed ${caseId}`, interaction.guildId);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(ST_COLOR['CLOSED'])
        .setTitle(`${config.botName} // CASE CLOSED`)
        .setDescription(
          `\`\`\`\n[ INVESTIGATION ARCHIVED ]\n` +
          `> Case ID   : ${result.caseId}\n` +
          `> Title     : ${result.title}\n` +
          `> Status    : ⬛ CLOSED\n` +
          `> Closed By : ${interaction.user.username}\n` +
          `> Duration  : ${mins} minute(s)\n` +
          `> Evidence  : ${result.evidence.length} item(s)\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── reopen ───────────────────────────────────────────────────────────
    if (sub === 'reopen') {
      if (!await perms.requireAccess(interaction, 'case.reopen')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const result = db.reopenCase(caseId, interaction.user.username);

      if (!result) return interaction.reply({ embeds: [err('NOT FOUND', `No case \`${caseId}\`.`)], ephemeral: true });
      if (result.error === 'NOT_CLOSED') return interaction.reply({ embeds: [err('NOT CLOSED', `Case \`${caseId}\` is not closed and cannot be reopened.`)], ephemeral: true });

      db.appendLog(interaction.user.id, 'CASE_REOPENED', `Reopened ${caseId}`, interaction.guildId);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(ST_COLOR['OPEN'])
        .setTitle(`${config.botName} // CASE REOPENED`)
        .setDescription(
          `\`\`\`\n[ INVESTIGATION RESUMED ]\n` +
          `> Case ID   : ${result.caseId}\n` +
          `> Title     : ${result.title}\n` +
          `> Status    : 🟢 OPEN\n` +
          `> Reopened By: ${interaction.user.username}\n` +
          `> Time      : ${new Date().toUTCString()}\n\`\`\``
        ).setTimestamp()
      ]});
    }
  }
};
