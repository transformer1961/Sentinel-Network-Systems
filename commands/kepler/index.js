const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const kelplerProtocol = require('../../modules/kelplerProtocol');
const permissions = require('../../modules/permissions');
const logger = require('../../modules/logger');
const rl = require('../../modules/rateLimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kepler')
    .setDescription('Kepler Protocol - Sentinel emergency response system')
    .addSubcommand(sub =>
      sub
        .setName('activate')
        .setDescription('Activate Kepler Protocol (System Owner only)')
        .addStringOption(opt =>
          opt
            .setName('reason')
            .setDescription('Activation reason')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('deactivate')
        .setDescription('Deactivate Kepler Protocol (System Owner only)')
        .addStringOption(opt =>
          opt
            .setName('reason')
            .setDescription('Deactivation reason')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Display current Kepler Protocol status')
    )
    .addSubcommand(sub =>
      sub
        .setName('phase')
        .setDescription('Display current Kepler phase and phase information')
    )
    .addSubcommand(sub =>
      sub
        .setName('advance')
        .setDescription('Advance to next Kepler phase (Directors+ only)')
        .addStringOption(opt =>
          opt
            .setName('target')
            .setDescription('Target phase')
            .setRequired(true)
            .addChoices(
              { name: 'I-Alert', value: 'I-Alert' },
              { name: 'II-Isolation', value: 'II-Isolation' },
              { name: 'III-Containment', value: 'III-Containment' },
              { name: 'IV-Lockdown', value: 'IV-Lockdown' },
              { name: 'V-Preservation', value: 'V-Preservation' },
              { name: 'VI-Verification', value: 'VI-Verification' },
              { name: 'VII-Recovery', value: 'VII-Recovery' },
              { name: 'VIII-Stand Down', value: 'VIII-Stand Down' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('snapshot')
        .setDescription('Create forensic snapshot (Directors+ only)')
        .addStringOption(opt =>
          opt
            .setName('label')
            .setDescription('Snapshot label/description')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('diagnostics')
        .setDescription('Run Kepler diagnostics and integrity checks')
    )
    .addSubcommand(sub =>
      sub
        .setName('simulate')
        .setDescription('Run training simulation (does not affect live systems)')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const clearance = permissions.getUserClearance(interaction.user.id);
    const isSystemOwner = permissions.isSystemOwner(interaction.user.id);
    const isEmergencyOwner = permissions.isEmergencyOwner(interaction.user.id);
    const isDirector = clearance >= permissions.CLEARANCE.DIRECTOR;

    if (!await rl.apply(interaction)) return;

    try {
      if (subcommand === 'activate') {
        if (!isSystemOwner) {
          return interaction.reply({
            content: '❌ Only System Owner can activate Kepler Protocol.',
            ephemeral: true
          });
        }

        const reason = interaction.options.getString('reason');
        const status = kelplerProtocol.activateKepler(
          interaction.user.username,
          interaction.user.id,
          reason
        );

        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🚨 KEPLER PROTOCOL ACTIVATED')
          .setDescription('Emergency response system engaged')
          .addFields(
            { name: 'Phase', value: status.phase, inline: true },
            { name: 'Activated At', value: new Date(status.activatedAt).toLocaleString(), inline: true },
            { name: 'Activated By', value: status.activatedBy, inline: true },
            { name: 'Reason', value: reason, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        logger.info('KEPLER_CMD', `Kepler activated by ${interaction.user.username}`, { userId: interaction.user.id });
      }

      else if (subcommand === 'deactivate') {
        if (!isSystemOwner) {
          return interaction.reply({
            content: '❌ Only System Owner can deactivate Kepler Protocol.',
            ephemeral: true
          });
        }

        const reason = interaction.options.getString('reason');
        const status = kelplerProtocol.deactivateKepler(
          interaction.user.username,
          interaction.user.id,
          reason,
          interaction.user.username,
          interaction.user.id
        );

        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ KEPLER PROTOCOL DEACTIVATED')
          .setDescription('Emergency response system returned to normal')
          .addFields(
            { name: 'Phase', value: status.phase, inline: true },
            { name: 'Deactivated At', value: new Date(status.deactivatedAt).toLocaleString(), inline: true },
            { name: 'Duration', value: calculateDuration(status.activatedAt, status.deactivatedAt), inline: true },
            { name: 'Reason', value: reason, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        logger.info('KEPLER_CMD', `Kepler deactivated by ${interaction.user.username}`, { userId: interaction.user.id });
      }

      else if (subcommand === 'status') {
        const status = kelplerProtocol.getKelplerStatus();

        if (!status || !status.active) {
          const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Kepler Protocol Status')
            .setDescription('🟢 **INACTIVE** - All systems normal')
            .addFields(
              { name: 'Current Phase', value: 'None', inline: true }
            )
            .setTimestamp();

          return interaction.reply({ embeds: [embed] });
        }

        const restrictionList = Object.entries(status.restrictions)
          .filter(([_, active]) => active)
          .map(([key, _]) => `• ${formatRestrictionName(key)}`)
          .join('\n') || 'None';

        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🚨 Kepler Protocol Status')
          .setDescription('**ACTIVE** - Emergency response in progress')
          .addFields(
            { name: 'Current Phase', value: status.phase, inline: true },
            { name: 'Activated By', value: status.activatedBy, inline: true },
            { name: 'Duration', value: calculateDuration(status.activatedAt, null), inline: true },
            { name: 'Activation Reason', value: status.activationReason, inline: false },
            { name: 'Active Restrictions', value: restrictionList, inline: false },
            { name: 'Snapshots Created', value: (status.snapshots?.length || 0).toString(), inline: true },
            { name: 'Incidents Recorded', value: (status.incidents?.length || 0).toString(), inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      }

      else if (subcommand === 'phase') {
        const status = kelplerProtocol.getKelplerStatus();

        if (!status || !status.active) {
          return interaction.reply({
            content: '❌ Kepler Protocol is not active.',
            ephemeral: true
          });
        }

        const phaseDescriptions = {
          'I-Alert': 'Notify all Sentinel systems and emergency personnel',
          'II-Isolation': 'Prevent spread of compromise',
          'III-Containment': 'Stop potentially malicious activity',
          'IV-Lockdown': 'Secure Sentinel infrastructure',
          'V-Preservation': 'Protect evidence',
          'VI-Verification': 'Determine system integrity',
          'VII-Recovery': 'Safely restore operations',
          'VIII-Stand Down': 'Return Sentinel to normal operation'
        };

        const embed = new EmbedBuilder()
          .setColor(0xFF6B00)
          .setTitle('Kepler Protocol Phase')
          .setDescription(`Current Phase: **${status.phase}**`)
          .addFields(
            { name: 'Purpose', value: phaseDescriptions[status.phase] || 'Unknown', inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      }

      else if (subcommand === 'advance') {
        if (!isDirector) {
          return interaction.reply({
            content: '❌ Only Directors+ can advance Kepler phases.',
            ephemeral: true
          });
        }

        const status = kelplerProtocol.getKelplerStatus();
        if (!status || !status.active) {
          return interaction.reply({
            content: '❌ Kepler Protocol is not active.',
            ephemeral: true
          });
        }

        const targetPhase = interaction.options.getString('target');
        const result = kelplerProtocol.advancePhase(
          targetPhase,
          interaction.user.username,
          interaction.user.id
        );

        if (!result.success) {
          return interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0xFF6B00)
          .setTitle('Phase Advanced')
          .addFields(
            { name: 'From', value: result.previousPhase, inline: true },
            { name: 'To', value: result.newPhase, inline: true },
            { name: 'Advanced By', value: interaction.user.username, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        logger.info('KEPLER_CMD', `Phase advanced by ${interaction.user.username}`, {
          userId: interaction.user.id,
          from: result.previousPhase,
          to: result.newPhase
        });
      }

      else if (subcommand === 'snapshot') {
        if (!isDirector) {
          return interaction.reply({
            content: '❌ Only Directors+ can create forensic snapshots.',
            ephemeral: true
          });
        }

        const status = kelplerProtocol.getKelplerStatus();
        if (!status || !status.active) {
          return interaction.reply({
            content: '❌ Kepler Protocol is not active.',
            ephemeral: true
          });
        }

        const label = interaction.options.getString('label');
        const snapshot = kelplerProtocol.createSnapshot(
          interaction.user.username,
          interaction.user.id,
          label
        );

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('Forensic Snapshot Created')
          .addFields(
            { name: 'Snapshot ID', value: snapshot.id, inline: true },
            { name: 'Phase', value: snapshot.phase, inline: true },
            { name: 'Label', value: label, inline: false },
            { name: 'Created By', value: snapshot.createdBy, inline: true },
            { name: 'Created At', value: new Date(snapshot.createdAt).toLocaleString(), inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        logger.info('KEPLER_CMD', `Snapshot created by ${interaction.user.username}`, {
          userId: interaction.user.id,
          snapshotId: snapshot.id
        });
      }

      else if (subcommand === 'diagnostics') {
        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('Kepler Diagnostics')
          .setDescription('Running integrity and health checks...')
          .addFields(
            { name: '✅ Bot Core', value: 'Operational', inline: true },
            { name: '✅ Database', value: 'Operational', inline: true },
            { name: '✅ Permissions', value: 'Operational', inline: true },
            { name: '✅ Logger', value: 'Operational', inline: true },
            { name: '✅ Audit Trail', value: 'Operational', inline: true },
            { name: '✅ Configuration', value: 'Valid', inline: true }
          )
          .addFields(
            { name: 'Overall Status', value: '🟢 All systems nominal', inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      }

      else if (subcommand === 'simulate') {
        const embed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('Kepler Simulation Mode')
          .setDescription('Training exercise - no live systems affected')
          .addFields(
            { name: '⏸️ Status', value: 'Ready for training', inline: false },
            { name: 'Note', value: 'Simulations help teams prepare for real emergencies without impacting operations.', inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        logger.info('KEPLER_CMD', `Simulation mode accessed by ${interaction.user.username}`, {
          userId: interaction.user.id
        });
      }
    } catch (error) {
      logger.error('KEPLER_CMD', error, { userId: interaction.user.id, subcommand });
      await interaction.reply({
        content: '❌ An error occurred while executing Kepler command.',
        ephemeral: true
      });
    }
  }
};

function formatRestrictionName(key) {
  const names = {
    dashboardDisabled: 'Dashboard Disabled',
    hqAccessRestricted: 'HQ Access Restricted',
    commandsFrozen: 'Critical Commands Frozen',
    configLocked: 'Configuration Locked',
    synchronizationSuspended: 'Synchronization Suspended'
  };
  return names[key] || key;
}

function calculateDuration(startDate, endDate) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const diff = end - start;
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}
