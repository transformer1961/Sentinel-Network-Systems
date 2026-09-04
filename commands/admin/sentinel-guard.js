/**
 * SENTINEL GUARD COMMAND
 * 
 * Manage server security, threat levels, and protection policies
 * Integrates with control panel for centralized management
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const sentinelGuard = require('../../modules/sentinelGuard');
const db = require('../../modules/database');
const permissions = require('../../modules/permissions');
const logger = require('../../modules/logger');
const config = require('../../modules/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sentinel-guard')
    .setDescription('🛡️ Manage Sentinel Guard - server protection system')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('View current threat level and security status')
    )
    .addSubcommand(sub =>
      sub.setName('report')
        .setDescription('Generate detailed security report')
    )
    .addSubcommand(sub =>
      sub.setName('protect')
        .setDescription('Enable/disable automatic protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enable or disable protection')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('threat')
        .setDescription('Set threat level manually')
        .addStringOption(opt =>
          opt.setName('level')
            .setDescription('Threat level')
            .setChoices(
              { name: 'Low', value: 'low' },
              { name: 'Medium', value: 'medium' },
              { name: 'High', value: 'high' },
              { name: 'Critical', value: 'critical' }
            )
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Reason for threat level change')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('lockdown')
        .setDescription('Activate emergency lockdown')
        .addIntegerOption(opt =>
          opt.setName('duration')
            .setDescription('Duration in minutes (default: 60)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(1440)
        )
    )
    .addSubcommand(sub =>
      sub.setName('policy')
        .setDescription('Manage security policies')
        .addStringOption(opt =>
          opt.setName('policy')
            .setDescription('Policy to configure')
            .setChoices(
              { name: 'Raid Threshold', value: 'raidThreshold' },
              { name: 'Suspicious Join Threshold', value: 'suspiciousJoinThreshold' },
              { name: 'Max Failed Logins', value: 'maxFailedLogins' },
              { name: 'Require Verification', value: 'requireVerification' }
            )
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('value')
            .setDescription('Policy value')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('monitor')
        .setDescription('Monitor suspicious users')
        .addIntegerOption(opt =>
          opt.setName('limit')
            .setDescription('Number of users to show (default: 5)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
    .addSubcommand(sub =>
      sub.setName('control-panel')
        .setDescription('Get link to web control panel')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const serverId = interaction.guildId;

    // Initialize guard for this server
    sentinelGuard.initializeServer(serverId);

    // Permission check - require admin or owner
    const hasPermission = await permissions.hasPermission(
      interaction.user.id,
      'manage_server'
    ) || interaction.user.id === config.systemOwnerId;

    if (!hasPermission) {
      return interaction.reply({
        content: '❌ You need administrator permissions to use Sentinel Guard.',
        ephemeral: true
      });
    }

    try {
      switch (subcommand) {
        case 'status':
          await handleStatus(interaction);
          break;
        case 'report':
          await handleReport(interaction);
          break;
        case 'protect':
          await handleProtect(interaction);
          break;
        case 'threat':
          await handleThreat(interaction);
          break;
        case 'lockdown':
          await handleLockdown(interaction);
          break;
        case 'policy':
          await handlePolicy(interaction);
          break;
        case 'monitor':
          await handleMonitor(interaction);
          break;
        case 'control-panel':
          await handleControlPanel(interaction);
          break;
      }
    } catch (error) {
      logger.critical('guard', `Error in sentinel-guard command: ${error.message}`);
      await interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true
      });
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// COMMAND HANDLERS
// ─────────────────────────────────────────────────────────────────────

async function handleStatus(interaction) {
  const serverId = interaction.guildId;
  const report = sentinelGuard.getSecurityReport(serverId);

  const threatColors = {
    low: 0x00ff00,
    medium: 0xffaa00,
    high: 0xff6600,
    critical: 0xff0000
  };

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Sentinel Guard - Security Status')
    .setColor(threatColors[report.threatLevel])
    .addFields(
      { name: 'Threat Level', value: `**${report.threatLevel.toUpperCase()}**`, inline: true },
      { name: 'Protection', value: report.protectionEnabled ? '✓ Enabled' : '✗ Disabled', inline: true },
      { name: 'Lockdown', value: report.lockdownActive ? '🔐 Active' : '🔓 Inactive', inline: true },
      { name: 'Total Threats', value: `${report.stats.totalThreats}`, inline: true },
      { name: 'Recent Threats (1h)', value: `${report.stats.recentThreats}`, inline: true },
      { name: 'Flagged Users', value: `${report.stats.flaggedUsers}`, inline: true },
      { name: 'Raid Detected', value: report.stats.raidDetected ? '⚠️ Yes' : '✓ No', inline: true },
      { name: 'Join Count (current window)', value: `${report.stats.raidJoinCount}`, inline: true },
      { name: 'Last Update', value: `<t:${Math.floor(new Date(report.lastUpdate).getTime() / 1000)}:R>`, inline: false }
    )
    .setFooter({ text: 'Sentinel Network Guard System' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleReport(interaction) {
  const serverId = interaction.guildId;
  const report = sentinelGuard.generateDetailedReport(serverId);

  const threatColors = {
    low: 0x00ff00,
    medium: 0xffaa00,
    high: 0xff6600,
    critical: 0xff0000
  };

  const embed = new EmbedBuilder()
    .setTitle('📊 Sentinel Guard - Detailed Security Report')
    .setColor(threatColors[report.summary.threatLevel])
    .addFields(
      { name: 'Threat Level', value: `**${report.summary.threatLevel.toUpperCase()}**`, inline: true },
      { name: 'Total Threats Recorded', value: `${report.summary.stats.totalThreats}`, inline: true },
      { name: 'Recent Threats (1h)', value: `${report.summary.stats.recentThreats}`, inline: true },
      {
        name: 'Active Policies',
        value: `\`\`\`
Raid Threshold: ${report.summary.policies.raidThreshold} joins/min
Suspicious Joins: ${report.summary.policies.suspiciousJoinThreshold}/5min
Max Failed Logins: ${report.summary.policies.maxFailedLogins}
Verification Required: ${report.summary.policies.requireVerification ? 'Yes' : 'No'}
\`\`\``,
        inline: false
      }
    );

  if (report.details.suspiciousUsers.length > 0) {
    embed.addFields({
      name: `🚨 Top Suspicious Users (${report.details.suspiciousUsers.length})`,
      value: report.details.suspiciousUsers
        .slice(0, 5)
        .map(u => `<@${u.userId}> - Score: ${u.score}`)
        .join('\n'),
      inline: false
    });
  }

  if (report.details.threats.length > 0) {
    embed.addFields({
      name: `📋 Recent Threats (Last ${Math.min(report.details.threats.length, 5)})`,
      value: report.details.threats
        .slice(-5)
        .map(t => `• ${t.type}: ${t.reason || 'N/A'} (<t:${Math.floor(new Date(t.timestamp).getTime() / 1000)}:R>)`)
        .join('\n'),
      inline: false
    });
  }

  embed.setFooter({ text: 'Control Panel: Use /sentinel-guard control-panel' });
  await interaction.reply({ embeds: [embed] });
}

async function handleProtect(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  const serverId = interaction.guildId;

  sentinelGuard.toggleProtection(serverId, enabled);

  await interaction.reply({
    content: `✓ Sentinel Guard protection **${enabled ? 'enabled' : 'disabled'}** for this server.`,
    ephemeral: true
  });

  logger.info('guard', `🛡️ Protection toggled to ${enabled} for server ${serverId}`);
}

async function handleThreat(interaction) {
  const level = interaction.options.getString('level');
  const reason = interaction.options.getString('reason') || 'Manual adjustment';
  const serverId = interaction.guildId;

  const result = sentinelGuard.setThreatLevel(serverId, level, reason);

  const embed = new EmbedBuilder()
    .setTitle('🚨 Threat Level Updated')
    .setColor(0xff6600)
    .addFields(
      { name: 'Previous Level', value: result.oldLevel.toUpperCase(), inline: true },
      { name: 'New Level', value: result.newLevel.toUpperCase(), inline: true },
      { name: 'Escalated', value: result.escalated ? '⚠️ Yes' : '✓ No', inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  logger.critical('guard', `⚠️ Threat level manually set to ${level}: ${reason}`);
}

async function handleLockdown(interaction) {
  const duration = (interaction.options.getInteger('duration') || 60) * 60 * 1000; // Convert to ms
  const serverId = interaction.guildId;

  const lockdown = sentinelGuard.activateLockdown(serverId, duration);

  const embed = new EmbedBuilder()
    .setTitle('🔐 EMERGENCY LOCKDOWN ACTIVATED')
    .setColor(0xff0000)
    .addFields(
      { name: 'Status', value: '🔐 Active', inline: true },
      { name: 'Duration', value: `${duration / 1000 / 60} minutes`, inline: true },
      { name: 'Ends At', value: `<t:${Math.floor(lockdown.endsAt.getTime() / 1000)}:F>`, inline: false },
      { name: 'Actions', value: '• All non-staff restricted\n• All public commands disabled\n• Logging increased\n• HQ notified' }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  logger.critical('guard', `🔐 LOCKDOWN ACTIVATED for server ${serverId}`);
}

async function handlePolicy(interaction) {
  const policyName = interaction.options.getString('policy');
  const value = interaction.options.getString('value');
  const serverId = interaction.guildId;

  // Parse value based on policy type
  let parsedValue = value;
  if (policyName.includes('Threshold') || policyName.includes('Failed')) {
    parsedValue = parseInt(value);
    if (isNaN(parsedValue)) {
      return interaction.reply({
        content: '❌ Invalid value. Please enter a number.',
        ephemeral: true
      });
    }
  } else if (policyName === 'requireVerification') {
    parsedValue = value.toLowerCase() === 'true';
  }

  const success = sentinelGuard.updatePolicy(serverId, policyName, parsedValue);

  if (success) {
    await interaction.reply({
      content: `✓ Policy **${policyName}** updated to: \`${parsedValue}\``,
      ephemeral: true
    });
  } else {
    await interaction.reply({
      content: '❌ Failed to update policy. Unknown policy name.',
      ephemeral: true
    });
  }
}

async function handleMonitor(interaction) {
  const limit = interaction.options.getInteger('limit') || 5;
  const report = sentinelGuard.generateDetailedReport(interaction.guildId);

  if (report.details.suspiciousUsers.length === 0) {
    return interaction.reply({
      content: '✓ No suspicious users detected.',
      ephemeral: true
    });
  }

  const suspicious = report.details.suspiciousUsers.slice(0, limit);

  const embed = new EmbedBuilder()
    .setTitle(`👁️ Suspicious Users Monitor (Top ${limit})`)
    .setColor(0xffaa00)
    .setDescription(
      suspicious
        .map((u, i) => `${i + 1}. <@${u.userId}>\n   Threat Score: \`${u.score}\`\n   Actions: \`${u.actions.length}\``)
        .join('\n\n')
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleControlPanel(interaction) {
  const dashboardUrl = `http://${process.env.DASHBOARD_HOST || 'localhost'}:${process.env.PORT || config.dashboardPort || 3000}/control-panel`;

  const embed = new EmbedBuilder()
    .setTitle('🌐 Sentinel Guard - Control Panel')
    .setColor(0x0a0f1e)
    .setDescription('Access the centralized control panel to manage Sentinel Guard across all servers.')
    .addFields(
      { name: '🔗 Control Panel URL', value: `[Open Control Panel](${dashboardUrl})`, inline: false },
      { name: 'Features', value: '• Monitor all servers\n• Manage threat levels\n• Configure policies\n• View threat history\n• Website integration\n• Real-time alerts', inline: false },
      { name: '🔐 Authentication', value: 'Use your dashboard password to login', inline: false }
    )
    .setFooter({ text: 'Sentinel Network Control Panel' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
