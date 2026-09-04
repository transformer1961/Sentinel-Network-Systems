/**
 * WATCH COMMAND GROUP v3
 * /watch add | remove | log | list | notify
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db     = require('../../modules/database');
const perms  = require('../../modules/permissions');
const rl     = require('../../modules/rateLimit');
const { paginate, chunk } = require('../../modules/pagination');
const config = require('../../modules/config');

function err(title, desc) {
  return new EmbedBuilder().setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${desc}\n\`\`\``)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watch')
    .setDescription('Surveillance watchlist management')

    .addSubcommand(s => s.setName('add').setDescription('Add a subject to the watchlist')
      .addUserOption(o => o.setName('user').setDescription('Target subject').setRequired(true)))

    .addSubcommand(s => s.setName('remove').setDescription('Remove a subject from the watchlist')
      .addUserOption(o => o.setName('user').setDescription('Target subject').setRequired(true)))

    .addSubcommand(s => s.setName('log').setDescription('View surveillance activity log')
      .addUserOption(o => o.setName('user').setDescription('Target subject').setRequired(true))
      .addIntegerOption(o => o.setName('limit').setDescription('Events to show (default 20)').setMinValue(1).setMaxValue(100).setRequired(false)))

    .addSubcommand(s => s.setName('list').setDescription('View all currently watched subjects'))

    .addSubcommand(s => s.setName('notify').setDescription('Enable join notifications for a subject in this server')
      .addUserOption(o => o.setName('user').setDescription('Target subject').setRequired(true)))

    .addSubcommand(s => s.setName('disable-notify').setDescription('Disable join notifications for a subject in this server')
      .addUserOption(o => o.setName('user').setDescription('Target subject').setRequired(true))),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── add ───────────────────────────────────────────────────────────────
    if (sub === 'add') {
      if (!await perms.requireAccess(interaction, 'watch.add')) return;
      const target = interaction.options.getUser('user');

      if (!db.getProfile(target.id)) db.createProfile(target, interaction.guildId);
      const result = db.addToWatchlist(target.id, interaction.user.username, interaction.guildId);

      if (result.alreadyWatched) return interaction.reply({ embeds: [err('ALREADY WATCHED', `\`${target.username}\` is already on the watchlist.`)], ephemeral: true });

      db.appendLog(target.id, 'WATCH_ADDED', `Added by ${interaction.user.username}`, interaction.guildId);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle(`${config.botName} // SURVEILLANCE ACTIVE`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ SUBJECT ADDED TO WATCHLIST ]\n` +
          `> Target   : ${target.username}\n` +
          `> ID       : ${target.id}\n` +
          `> Status   : ⚠️ UNDER SURVEILLANCE\n` +
          `> Added By : ${interaction.user.username}\n` +
          `> Note     : Cross-server join alerts enabled\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── remove ────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      if (!await perms.requireAccess(interaction, 'watch.remove')) return;
      const target = interaction.options.getUser('user');
      const result = db.removeFromWatchlist(target.id);

      if (result.notWatched) return interaction.reply({ embeds: [err('NOT WATCHED', `\`${target.username}\` is not on the watchlist.`)], ephemeral: true });

      db.appendLog(target.id, 'WATCH_REMOVED', `Removed by ${interaction.user.username}`, interaction.guildId);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // SURVEILLANCE LIFTED`)
        .setDescription(
          `\`\`\`\n[ SUBJECT REMOVED FROM WATCHLIST ]\n` +
          `> Target     : ${target.username}\n` +
          `> Removed By : ${interaction.user.username}\n` +
          `> Time       : ${new Date().toUTCString()}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── log ───────────────────────────────────────────────────────────────
    if (sub === 'log') {
      if (!await perms.requireAccess(interaction, 'watch.log')) return;
      const target  = interaction.options.getUser('user');
      const limit   = interaction.options.getInteger('limit') || 20;
      const logData = db.getUserLogs(target.id, limit);

      if (!logData || logData.totalEvents === 0) {
        return interaction.reply({ embeds: [err('NO LOG DATA', `No events found for \`${target.username}\`.`)], ephemeral: true });
      }

      const profile = db.getProfile(target.id);
      const evChunks = chunk(logData.recentEvents, 10);

      const pages = evChunks.map((ch, i) => {
        const lines = ch.map((e, idx) => {
          const ts = new Date(e.timestamp).toISOString().replace('T', ' ').split('.')[0];
          return `  [${String(idx + 1).padStart(2, '0')}] [${ts}]\n       ${e.type}: ${e.detail.substring(0, 55)}`;
        }).join('\n') || '  No events.';

        return new EmbedBuilder()
          .setColor(profile?.watchlisted ? config.warningColor : '#888')
          .setTitle(`${config.botName} // SURVEILLANCE LOG`)
          .setDescription(
            `\`\`\`\n[ ${target.username} — LOG ${i + 1}/${evChunks.length} ]\n` +
            `> Watchlisted  : ${profile?.watchlisted ? 'YES ⚠️' : 'NO'}\n` +
            `> Total Events : ${logData.totalEvents}\n\n` +
            `${lines}\n\`\`\``
          )
          .setFooter({ text: `Queried by ${interaction.user.username}` }).setTimestamp();
      });

      return paginate(interaction, pages);
    }

    // ── list ──────────────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!await perms.requireAccess(interaction, 'watch.list')) return;
      const watchlist = db.getWatchlist();

      if (!watchlist.length) return interaction.reply({ embeds: [err('EMPTY', 'No subjects currently under surveillance.')], ephemeral: true });

      const chunks = chunk(watchlist, 8);
      const pages  = chunks.map((ch, i) => {
        const lines = ch.map((w, idx) => {
          const p    = db.getProfile(w.userId);
          const name = p ? p.username : w.userId;
          const since = new Date(w.watchlistedAt).toISOString().split('T')[0];
          return `  [${String(idx + 1).padStart(2, '0')}] ${name.padEnd(22)} Since: ${since} | ${w.eventCount} events`;
        }).join('\n');

        return new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle(`${config.botName} // ACTIVE WATCHLIST`)
          .setDescription(
            `\`\`\`\n[ ${watchlist.length} SUBJECT(S) UNDER SURVEILLANCE ]\n\n` +
            `  IDX  USERNAME                SINCE       EVENTS\n` +
            `  ${'─'.repeat(50)}\n${lines}\n\`\`\``
          )
          .setFooter({ text: `Page ${i + 1}/${chunks.length}` }).setTimestamp();
      });

      return paginate(interaction, pages);
    }

    // ── notify ────────────────────────────────────────────────────────────
    if (sub === 'notify') {
      if (!await perms.requireAccess(interaction, 'watch.notify')) return;
      const target = interaction.options.getUser('user');

      // Ensure profile exists
      if (!db.getProfile(target.id)) db.createProfile(target, interaction.guildId);

      db.enableNotify(target.id, interaction.guildId);

      // Also ensure they're on the watchlist
      const wr = db.addToWatchlist(target.id, interaction.user.username, interaction.guildId);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle(`${config.botName} // JOIN NOTIFICATIONS ENABLED`)
        .setDescription(
          `\`\`\`\n[ NOTIFY CONFIGURED ]\n` +
          `> Target   : ${target.username}\n` +
          `> Server   : ${interaction.guild?.name}\n` +
          `> Effect   : This server will receive an alert embed\n` +
          `             whenever ${target.username} joins.\n` +
          `> Watchlist: ${wr.alreadyWatched ? 'Already active' : 'Now active'}\n` +
          `> Setup    : Set alert channel with /admin setup\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── disable-notify ─────────────────────────────────────────────────────
    if (sub === 'disable-notify') {
      if (!await perms.requireAccess(interaction, 'watch.disable-notify')) return;
      const target = interaction.options.getUser('user');
      const result = db.disableNotify(target.id, interaction.guildId);

      if (result.notEnabled) {
        return interaction.reply({ embeds: [err('NOT CONFIGURED', 'Join notifications are not enabled for `' + target.username + '` on this server.')], ephemeral: true });
      }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // JOIN NOTIFICATIONS DISABLED`)
        .setDescription(
          `\`\`\`\n[ NOTIFY REMOVED ]\n` +
          `> Target : ${target.username}\n` +
          `> Server : ${interaction.guild?.name}\n` +
          `> Note   : This server will no longer receive join alerts for this subject.\n\`\`\``
        ).setTimestamp()
      ]});
    }
  }
};
