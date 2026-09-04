const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../modules/database');
const serverBlacklist = require('../../modules/serverBlacklist');
const permissions = require('../../modules/permissions');
const rateLimit = require('../../modules/rateLimit');
const config = require('../../modules/config');

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(description)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Check shared Sentinel user and server blacklist status')
    .addSubcommand(sub => sub
      .setName('user')
      .setDescription('Check whether a Discord user is blacklisted')
      .addUserOption(option => option
        .setName('target')
        .setDescription('User to check')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('server')
      .setDescription('Check whether a Discord server is blacklisted')
      .addStringOption(option => option
        .setName('serverid')
        .setDescription('Discord server ID to check')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List active shared blacklist entries (Director+)')),

  async execute(interaction) {
    if (!await rateLimit.apply(interaction)) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'user') {
      if (!await permissions.requireAccess(interaction, 'blacklist.check')) return;

      const target = interaction.options.getUser('target');
      const entry = db.getBlacklist()[target.id];

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(entry ? config.criticalColor : config.accentColor)
          .setTitle(`${config.botName} // USER BLACKLIST CHECK`)
          .setDescription(
            `**User:** ${target} (${target.id})\n` +
            (entry
              ? `**Status:** ⛔ Blacklisted\n**Reason:** ${entry.reason}\n**Added:** <t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:R>`
              : '**Status:** ✅ Clear')
          )
          .setTimestamp()],
        ephemeral: true
      });
    }

    if (subcommand === 'server') {
      if (!await permissions.requireAccess(interaction, 'blacklist.check')) return;

      const serverId = interaction.options.getString('serverid').trim();
      if (!/^\d{17,20}$/.test(serverId)) {
        return interaction.reply({
          embeds: [errorEmbed('INVALID SERVER ID', 'Discord server IDs must contain 17-20 digits.')],
          ephemeral: true
        });
      }

      const entry = serverBlacklist.getBlacklistedServer(serverId);
      const active = entry && entry.status !== 'LIFTED';

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(active ? config.criticalColor : config.accentColor)
          .setTitle(`${config.botName} // SERVER BLACKLIST CHECK`)
          .setDescription(
            `**Server ID:** ${serverId}\n` +
            (active
              ? `**Status:** ${entry.status === 'APPEALING' ? '🟡 Appealing' : '⛔ Active'}\n**Reason:** ${entry.reason}\n**Added:** <t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:R>`
              : '**Status:** ✅ Clear')
          )
          .setTimestamp()],
        ephemeral: true
      });
    }

    if (!await permissions.requireAccess(interaction, 'blacklist.list')) return;

    const users = Object.values(db.getBlacklist());
    const servers = serverBlacklist.getActiveBlacklist();
    const lines = [
      `Users: ${users.length}`,
      ...users.slice(0, 10).map(entry => `⛔ User ${entry.userId} - ${entry.reason}`),
      `Servers: ${servers.length}`,
      ...servers.slice(0, 10).map(entry => `⛔ Server ${entry.serverId} - ${entry.reason}`)
    ];

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // ACTIVE BLACKLIST SUMMARY`)
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: 'Use /blacklist user or /blacklist server for a detailed check.' })
        .setTimestamp()],
      ephemeral: true
    });
  }
};