const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const perms = require('../../modules/permissions');
const rl = require('../../modules/rateLimit');
const config = require('../../modules/config');
const { buildIncidentPayload, getIncidentApiConfig, createSignedRequestPayload } = require('../../modules/incidentClient');

function err(title, desc) {
  return new EmbedBuilder()
    .setColor(config.dangerColor || '#d11a2a')
    .setTitle(`${config.botName || 'SNS Watchtower'} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${desc}\n\`\`\``)
    .setTimestamp();
}

function okResult(title, description) {
  return new EmbedBuilder()
    .setColor(config.accentColor || '#4dabf7')
    .setTitle(`${config.botName || 'SNS Watchtower'} // ${title}`)
    .setDescription(description)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('incident')
    .setDescription('Create, update, and review SNS incidents')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Open a new incident in Core')
        .addStringOption((opt) => opt.setName('title').setDescription('Incident title').setRequired(true).setMaxLength(120))
        .addStringOption((opt) => opt.setName('severity').setDescription('Severity').setRequired(false)
          .addChoices(
            { name: 'Low', value: 'low' },
            { name: 'Medium', value: 'medium' },
            { name: 'High', value: 'high' },
            { name: 'Critical', value: 'critical' }
          ))
        .addStringOption((opt) => opt.setName('reason').setDescription('Why this incident exists').setRequired(true).setMaxLength(1000))
        .addStringOption((opt) => opt.setName('status').setDescription('Initial lifecycle status').setRequired(false)
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Assigned', value: 'assigned' },
            { name: 'Investigating', value: 'investigating' },
            { name: 'Monitoring', value: 'monitoring' }
          ))
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show incident status for a known incident')
        .addStringOption((opt) => opt.setName('incidentid').setDescription('Incident ID from Core').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('assign')
        .setDescription('Assign an incident owner')
        .addStringOption((opt) => opt.setName('incidentid').setDescription('Incident ID from Core').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('Owner to assign').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('resolve')
        .setDescription('Resolve an open or assigned incident')
        .addStringOption((opt) => opt.setName('incidentid').setDescription('Incident ID from Core').setRequired(true))
        .addStringOption((opt) => opt.setName('resolution').setDescription('Resolution summary').setRequired(true).setMaxLength(1000))
    ),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    if (!await perms.requireAccess(interaction, 'case.open')) return;

    const subcommand = interaction.options.getSubcommand();
    const apiConfig = getIncidentApiConfig();

    if (!apiConfig.configured) {
      return interaction.reply({ embeds: [err('CORE UNAVAILABLE', 'SNS Core API credentials are not configured for this bot yet.')], ephemeral: true });
    }

    try {
      if (subcommand === 'create') {
        const title = interaction.options.getString('title');
        const severity = interaction.options.getString('severity') || 'medium';
        const reason = interaction.options.getString('reason');
        const status = interaction.options.getString('status') || 'open';

        const payload = buildIncidentPayload({
          title,
          severity,
          reason,
          owner: interaction.user.id,
          guildId: interaction.guildId,
          status,
        });

        const signedRequest = createSignedRequestPayload(payload, apiConfig.secret);
        const response = await fetch(`${apiConfig.url}/api/incidents`, {
          method: 'POST',
          headers: signedRequest.headers,
          body: signedRequest.body,
          signal: AbortSignal.timeout(15000),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Core returned ${response.status}`);
        }

        const incident = data.incident || data;
        return interaction.reply({
          embeds: [okResult('INCIDENT OPENED', `\`\`\`\n[ CORE INCIDENT ]\n> ID       : ${incident.id || incident.incidentId}\n> Title    : ${title}\n> Severity : ${severity}\n> Status   : ${incident.status || status}\n> Owner    : ${interaction.user.username}\n\`\`\``)]
        });
      }

      if (subcommand === 'status') {
        const incidentId = interaction.options.getString('incidentid');
        const response = await fetch(`${apiConfig.url}/api/incidents?status=all&incidentId=${encodeURIComponent(incidentId)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-sns-bot-id': apiConfig.botId,
            'x-sns-bot-token': apiConfig.botToken,
            'x-sns-signature': createSignedRequestPayload({ incidentId }, apiConfig.secret).headers['x-sns-signature'],
          },
          signal: AbortSignal.timeout(15000),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Core returned ${response.status}`);
        const incident = Array.isArray(data.incidents) ? data.incidents.find((item) => item.id === incidentId || item.incidentId === incidentId) : null;

        if (!incident) {
          return interaction.reply({ embeds: [err('NOT FOUND', `No incident with ID \`${incidentId}\` was found in Core.`)], ephemeral: true });
        }

        return interaction.reply({
          embeds: [okResult('INCIDENT STATUS', `\`\`\`\n[ ${incident.id || incident.incidentId} ]\n> Title    : ${incident.title}\n> Status   : ${incident.status}\n> Severity : ${incident.severity}\n> Owner    : ${incident.owner || 'unassigned'}\n\`\`\``)]
        });
      }

      if (subcommand === 'assign') {
        const incidentId = interaction.options.getString('incidentid');
        const user = interaction.options.getUser('user');
        const response = await fetch(`${apiConfig.url}/api/incidents`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-sns-bot-id': apiConfig.botId,
            'x-sns-bot-token': apiConfig.botToken,
            'x-sns-signature': createSignedRequestPayload({ incidentId, owner: user.id, note: `Assigned by ${interaction.user.tag}` }, apiConfig.secret).headers['x-sns-signature'],
          },
          body: JSON.stringify({ incidentId, owner: user.id, note: `Assigned by ${interaction.user.tag}` }),
          signal: AbortSignal.timeout(15000),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Core returned ${response.status}`);
        return interaction.reply({ embeds: [okResult('INCIDENT ASSIGNED', `\`\`\`\n[ OWNER UPDATED ]\n> ID       : ${incidentId}\n> Owner    : ${user.username}\n> Status   : ${data.incident?.status || 'assigned'}\n\`\`\``)] });
      }

      if (subcommand === 'resolve') {
        const incidentId = interaction.options.getString('incidentid');
        const resolution = interaction.options.getString('resolution');
        const response = await fetch(`${apiConfig.url}/api/incidents`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-sns-bot-id': apiConfig.botId,
            'x-sns-bot-token': apiConfig.botToken,
            'x-sns-signature': createSignedRequestPayload({ incidentId, status: 'resolved', resolution, note: `Resolved by ${interaction.user.tag}` }, apiConfig.secret).headers['x-sns-signature'],
          },
          body: JSON.stringify({ incidentId, status: 'resolved', resolution, note: `Resolved by ${interaction.user.tag}` }),
          signal: AbortSignal.timeout(15000),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Core returned ${response.status}`);
        return interaction.reply({ embeds: [okResult('INCIDENT RESOLVED', `\`\`\`\n[ RESOLUTION RECORDED ]\n> ID       : ${incidentId}\n> Result   : ${resolution}\n> Status   : ${data.incident?.status || 'resolved'}\n\`\`\``)] });
      }

      return interaction.reply({ embeds: [err('UNSUPPORTED', 'This incident subcommand is not available yet.')], ephemeral: true });
    } catch (error) {
      return interaction.reply({ embeds: [err('CORE REQUEST FAILED', error.message || 'Failed to sync with Core.')], ephemeral: true });
    }
  },
};
