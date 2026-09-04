/**
 * SETUP COMMAND v3
 * /setup — Register this server with Sentinel Network
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db     = require('../../modules/database');
const config = require('../../modules/config');
const perms  = require('../../modules/permissions');
const rl     = require('../../modules/rateLimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Register this server with Sentinel Network HQ')
    .addChannelOption(o => o.setName('alert_channel').setDescription('Channel for cross-server alerts').setRequired(true))
    .addBooleanOption(o => o.setName('hq_sync').setDescription('Enable HQ sync for reports and watchlist').setRequired(true))
    .addChannelOption(o => o.setName('audit_channel').setDescription('Optional channel for audit logs')),

  async execute(interaction) {
    // ── PERMISSION & RATE LIMIT CHECK ──
    if (!await rl.apply(interaction)) return;
    if (!await perms.requireAccess(interaction, 'admin.setup')) return;

    // Check if already configured
    const serverConfig = db.loadData('serverConfig')[interaction.guildId];
    if (serverConfig) {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle(`${config.botName} // SERVER ALREADY REGISTERED`)
        .setDescription(`This server is already configured.\n\n**Alert Channel:** <#${serverConfig.alertChannelId}>\n**Audit Channel:** ${serverConfig.auditChannelId ? `<#${serverConfig.auditChannelId}>` : 'None'}\n**HQ Sync:** ${serverConfig.hqSync ? 'Enabled' : 'Disabled'}`)
        .setTimestamp()], flags: [MessageFlags.Ephemeral] });
    }

    const alertChannel = interaction.options.getChannel('alert_channel');
    const auditChannel = interaction.options.getChannel('audit_channel');
    const hqSync = interaction.options.getBoolean('hq_sync');

    // Validate channels are text channels
    if (alertChannel.type !== 0) { // TEXT
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.dangerColor)
        .setTitle(`${config.botName} // INVALID CHANNEL`)
        .setDescription('Alert channel must be a text channel.')
        .setTimestamp()], flags: [MessageFlags.Ephemeral] });
    }
    if (auditChannel && auditChannel.type !== 0) {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.dangerColor)
        .setTitle(`${config.botName} // INVALID CHANNEL`)
        .setDescription('Audit channel must be a text channel.')
        .setTimestamp()], flags: [MessageFlags.Ephemeral] });
    }

    // Save configuration
    const configData = {
      serverId: interaction.guildId,
      serverName: interaction.guild.name,
      alertChannelId: alertChannel.id,
      auditChannelId: auditChannel ? auditChannel.id : null,
      hqSync: hqSync,
      configuredBy: interaction.user.id,
      configuredAt: new Date().toISOString()
    };

    const allConfigs = db.loadData('serverConfig');
    allConfigs[interaction.guildId] = configData;
    db.saveData('serverConfig', allConfigs);

    // Send confirmation
    const embed = new EmbedBuilder()
      .setColor(config.accentColor)
      .setTitle(`${config.botName} // SERVER REGISTERED`)
      .setDescription(`✅ **Server registered with Sentinel Network HQ**\n\n**Alert Channel:** <#${alertChannel.id}>\n**Audit Channel:** ${auditChannel ? `<#${auditChannel.id}>` : 'None'}\n**HQ Sync:** ${hqSync ? 'Enabled' : 'Disabled'}\n\nReports and critical alerts will now be sent to the alert channel.`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Announce in alert channel
    try {
      const channel = await interaction.client.channels.fetch(alertChannel.id);
      await channel.send({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // ALERT CHANNEL CONFIGURED`)
        .setDescription(`This channel has been set as the alert channel for **${interaction.guild.name}**.\n\nCross-server alerts for flagged users, watchlist updates, and critical reports will be posted here.`)
        .setTimestamp()] });
    } catch (e) {
      console.error('[SETUP] Failed to send to alert channel:', e.message);
    }
  }
};