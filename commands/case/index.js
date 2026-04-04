/**
 * CASE COMMAND GROUP — v2
 * Handles: /case open | add-evidence | assign | close | list
 * New: DM alert on assignment, paginated list, rate limiting
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const inv = require('../../modules/investigation');
const { requireClearance } = require('../../modules/permissions');
const { applyRateLimit } = require('../../modules/rateLimit');
const { alertCaseAssigned } = require('../../modules/alerts');
const { paginate, chunkArray } = require('../../modules/pagination');
const config = require('../../config.json');

const STATUS_COLORS = {
  'OPEN': '#00ff88', 'UNDER REVIEW': '#ffaa00', 'CLOSED': '#888888'
};
const STATUS_ICONS = {
  'OPEN': '🟢', 'UNDER REVIEW': '🟡', 'CLOSED': '⬛'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Manage investigation cases in the Sentinel system')

    .addSubcommand(sub => sub
      .setName('open')
      .setDescription('Open a new investigation case')
      .addStringOption(opt => opt.setName('title').setDescription('Case title').setRequired(true).setMaxLength(100))
    )
    .addSubcommand(sub => sub
      .setName('add-evidence')
      .setDescription('Submit evidence to an open case')
      .addStringOption(opt => opt.setName('caseid').setDescription('Case ID (e.g. CASE-0001)').setRequired(true))
      .addStringOption(opt => opt.setName('text').setDescription('Evidence description').setRequired(true).setMaxLength(800))
    )
    .addSubcommand(sub => sub
      .setName('assign')
      .setDescription('Assign an agent to a case')
      .addStringOption(opt => opt.setName('caseid').setDescription('Case ID').setRequired(true))
      .addUserOption(opt => opt.setName('user').setDescription('Agent to assign').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('close')
      .setDescription('Close an investigation case')
      .addStringOption(opt => opt.setName('caseid').setDescription('Case ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all cases, optionally filtered by status')
      .addStringOption(opt => opt.setName('status').setDescription('Filter by status').setRequired(false)
        .addChoices(
          { name: 'All', value: 'ALL' },
          { name: 'Open', value: 'OPEN' },
          { name: 'Under Review', value: 'UNDER REVIEW' },
          { name: 'Closed', value: 'CLOSED' }
        )
      )
    ),

  async execute(interaction) {
    if (!await applyRateLimit(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── /case open ────────────────────────────────────────────────────────
    if (sub === 'open') {
      if (!await requireClearance(interaction, 'case.open')) return;
      const title = interaction.options.getString('title');
      const newCase = inv.openCase(title, interaction.user.id);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(STATUS_COLORS['OPEN'])
          .setTitle(`${config.botName} // CASE OPENED`)
          .setDescription(
            `\`\`\`\n[ NEW INVESTIGATION INITIATED ]\n` +
            `> Case ID : ${newCase.caseId}\n` +
            `> Title   : ${newCase.title}\n` +
            `> Status  : ${STATUS_ICONS['OPEN']} ${newCase.status}\n` +
            `> Agent   : ${interaction.user.username}\n` +
            `> Opened  : ${new Date(newCase.createdAt).toUTCString()}\n\`\`\``
          )
          .setFooter({ text: `File evidence with /case add-evidence ${newCase.caseId}` })
          .setTimestamp()
        ]
      });
    }

    // ── /case add-evidence ────────────────────────────────────────────────
    if (sub === 'add-evidence') {
      if (!await requireClearance(interaction, 'case.add-evidence')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const text = interaction.options.getString('text');
      const result = inv.addEvidence(caseId, text, interaction.user.id);

      if (!result) return interaction.reply({ embeds: [errorEmbed('CASE NOT FOUND', `No case with ID \`${caseId}\` exists.`)], ephemeral: true });
      if (result.error === 'CASE_CLOSED') return interaction.reply({ embeds: [errorEmbed('CASE CLOSED', `Cannot add evidence to a closed case.`)], ephemeral: true });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(STATUS_COLORS['UNDER REVIEW'])
          .setTitle(`${config.botName} // EVIDENCE FILED`)
          .setDescription(
            `\`\`\`\n[ EVIDENCE SUBMITTED ]\n` +
            `> Case ID   : ${result.caseId}\n` +
            `> Status    : ${STATUS_ICONS['UNDER REVIEW']} ${result.status}\n` +
            `> Filed By  : ${interaction.user.username}\n` +
            `> Evidence  :\n  "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"\n` +
            `> Total EVD : ${result.evidence.length}\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /case assign ──────────────────────────────────────────────────────
    if (sub === 'assign') {
      if (!await requireClearance(interaction, 'case.assign')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const agent = interaction.options.getUser('user');
      const result = inv.assignAgent(caseId, agent.id);

      if (!result) return interaction.reply({ embeds: [errorEmbed('CASE NOT FOUND', `No case with ID \`${caseId}\` exists.`)], ephemeral: true });
      if (result.error === 'CASE_CLOSED') return interaction.reply({ embeds: [errorEmbed('CASE CLOSED', `Cannot assign agents to a closed case.`)], ephemeral: true });

      // DM the assigned agent
      alertCaseAssigned(interaction.client, agent.id, result, interaction.user.username);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // AGENT ASSIGNED`)
          .setDescription(
            `\`\`\`\n[ CASE ASSIGNMENT UPDATED ]\n` +
            `> Case ID : ${result.caseId}\n` +
            `> Title   : ${result.title}\n` +
            `> Agent   : ${agent.username}\n` +
            `> Total   : ${result.assignedAgents.length} agent(s) assigned\n` +
            `> Note    : Agent has been notified via DM\n\`\`\``
          )
          .setFooter({ text: `Assigned by ${interaction.user.username} | Sentinel Network` })
          .setTimestamp()
        ]
      });
    }

    // ── /case close ───────────────────────────────────────────────────────
    if (sub === 'close') {
      if (!await requireClearance(interaction, 'case.close')) return;
      const caseId = interaction.options.getString('caseid').toUpperCase();
      const result = inv.closeCase(caseId, interaction.user.id);

      if (!result) return interaction.reply({ embeds: [errorEmbed('CASE NOT FOUND', `No case with ID \`${caseId}\` exists.`)], ephemeral: true });
      if (result.error === 'ALREADY_CLOSED') return interaction.reply({ embeds: [errorEmbed('ALREADY CLOSED', `Case \`${caseId}\` is already closed.`)], ephemeral: true });

      const duration = Math.floor((new Date(result.closedAt) - new Date(result.createdAt)) / (1000 * 60));

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(STATUS_COLORS['CLOSED'])
          .setTitle(`${config.botName} // CASE CLOSED`)
          .setDescription(
            `\`\`\`\n[ INVESTIGATION CLOSED ]\n` +
            `> Case ID   : ${result.caseId}\n` +
            `> Title     : ${result.title}\n` +
            `> Status    : ⬛ CLOSED\n` +
            `> Closed By : ${interaction.user.username}\n` +
            `> Duration  : ${duration} minute(s)\n` +
            `> Evidence  : ${result.evidence.length} item(s) on file\n` +
            `> Agents    : ${result.assignedAgents.length} assigned\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /case list ────────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!await requireClearance(interaction, 'case.open')) return;
      const statusFilter = interaction.options.getString('status') || 'ALL';
      const allCases = Object.values(inv.getAllCases());

      const filtered = statusFilter === 'ALL'
        ? allCases
        : allCases.filter(c => c.status === statusFilter);

      if (filtered.length === 0) {
        return interaction.reply({
          embeds: [errorEmbed('NO CASES', `No cases found${statusFilter !== 'ALL' ? ` with status \`${statusFilter}\`` : ''}.`)],
          ephemeral: true
        });
      }

      // Sort: open first, then under review, then closed
      const statusOrder = { 'OPEN': 0, 'UNDER REVIEW': 1, 'CLOSED': 2 };
      filtered.sort((a, b) => (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0));

      const chunks = chunkArray(filtered, 6);
      const pages = chunks.map((chunk, i) => {
        const lines = chunk.map(c =>
          `  ${STATUS_ICONS[c.status]} ${c.caseId}  ${c.title.substring(0, 28).padEnd(28)} EVD:${c.evidence.length}`
        ).join('\n');

        return new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // CASE REGISTRY`)
          .setDescription(
            `\`\`\`\n[ ${statusFilter} CASES — ${filtered.length} TOTAL ]\n\n` +
            `  ST CASE-ID   TITLE                        EVD\n` +
            `  ${'─'.repeat(48)}\n${lines}\n\`\`\``
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
