/**
 * WATCH COMMAND GROUP — v2
 * Handles: /watch add | remove | log | list
 * New: watchlist overview, rate limiting, paginated logs
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const surv = require('../../modules/surveillance');
const db = require('../../modules/database');
const { requireClearance } = require('../../modules/permissions');
const { applyRateLimit } = require('../../modules/rateLimit');
const { paginate, chunkArray } = require('../../modules/pagination');
const config = require('../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watch')
    .setDescription('Manage surveillance watchlist and activity logs')

    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Place a subject under active surveillance')
      .addUserOption(opt => opt.setName('user').setDescription('Target subject').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a subject from active surveillance')
      .addUserOption(opt => opt.setName('user').setDescription('Target subject').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('log')
      .setDescription('View surveillance log for a subject')
      .addUserOption(opt => opt.setName('user').setDescription('Target subject').setRequired(true))
      .addIntegerOption(opt => opt.setName('limit').setDescription('Events to show (default: 20)').setMinValue(1).setMaxValue(100).setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View all currently watched subjects')
    ),

  async execute(interaction) {
    if (!await applyRateLimit(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── /watch add ────────────────────────────────────────────────────────
    if (sub === 'add') {
      if (!await requireClearance(interaction, 'watch.add')) return;
      const target = interaction.options.getUser('user');

      let profile = db.getProfile(target.id);
      if (!profile) profile = db.createProfile(target);

      const result = surv.addToWatchlist(target.id, interaction.user.id);

      if (!result.success && result.alreadyWatched) {
        return interaction.reply({
          embeds: [errorEmbed('ALREADY MONITORED', `\`${target.username}\` is already on the watchlist.`)],
          ephemeral: true
        });
      }

      surv.logEvent(target.id, 'SURVEILLANCE_START', `Added to watchlist by ${interaction.user.username}`);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle(`${config.botName} // SURVEILLANCE ACTIVE`)
          .setThumbnail(target.displayAvatarURL())
          .setDescription(
            `\`\`\`\n[ SUBJECT ADDED TO WATCHLIST ]\n` +
            `> Target   : ${target.username}\n` +
            `> ID       : ${target.id}\n` +
            `> Status   : UNDER SURVEILLANCE ⚠️\n` +
            `> Added By : ${interaction.user.username}\n` +
            `> Time     : ${new Date().toUTCString()}\n\`\`\``
          )
          .setFooter({ text: `All messages, joins, and leaves will be logged.` })
          .setTimestamp()
        ]
      });
    }

    // ── /watch remove ─────────────────────────────────────────────────────
    if (sub === 'remove') {
      if (!await requireClearance(interaction, 'watch.remove')) return;
      const target = interaction.options.getUser('user');
      const result = surv.removeFromWatchlist(target.id);

      if (!result.success && result.notWatched) {
        return interaction.reply({
          embeds: [errorEmbed('NOT ON WATCHLIST', `\`${target.username}\` is not currently under surveillance.`)],
          ephemeral: true
        });
      }

      surv.logEvent(target.id, 'SURVEILLANCE_END', `Removed from watchlist by ${interaction.user.username}`);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // SURVEILLANCE ENDED`)
          .setDescription(
            `\`\`\`\n[ SUBJECT REMOVED FROM WATCHLIST ]\n` +
            `> Target     : ${target.username}\n` +
            `> Status     : SURVEILLANCE LIFTED\n` +
            `> Removed By : ${interaction.user.username}\n` +
            `> Time       : ${new Date().toUTCString()}\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /watch log ────────────────────────────────────────────────────────
    if (sub === 'log') {
      if (!await requireClearance(interaction, 'watch.log')) return;
      const target = interaction.options.getUser('user');
      const limit = interaction.options.getInteger('limit') || 20;
      const logData = surv.getUserLogs(target.id, limit);

      if (!logData || (logData.totalEvents === 0 && !logData.watchlisted)) {
        return interaction.reply({
          embeds: [errorEmbed('NO LOG DATA', `No surveillance records found for \`${target.username}\`.`)],
          ephemeral: true
        });
      }

      // Paginate 10 events per page
      const eventChunks = chunkArray(logData.recentEvents, 10);
      if (eventChunks.length === 0) eventChunks.push([]);

      const pages = eventChunks.map((chunk, i) => {
        const lines = chunk.length > 0
          ? chunk.map((e, idx) => {
              const ts = new Date(e.timestamp).toISOString().replace('T', ' ').split('.')[0];
              return `  [${String(idx + 1).padStart(2, '0')}] [${ts}]\n       ${e.type}: ${e.detail.substring(0, 55)}`;
            }).join('\n')
          : '  No events recorded.';

        return new EmbedBuilder()
          .setColor(logData.watchlisted ? config.warningColor : '#888888')
          .setTitle(`${config.botName} // SURVEILLANCE REPORT`)
          .setDescription(
            `\`\`\`\n[ ${target.username} — LOG PAGE ${i + 1}/${eventChunks.length} ]\n` +
            `> Watchlisted  : ${logData.watchlisted ? 'YES ⚠️' : 'NO'}\n` +
            `> Total Events : ${logData.totalEvents}\n\n` +
            `${lines}\n\`\`\``
          )
          .setFooter({ text: `Queried by ${interaction.user.username} | Sentinel Network` })
          .setTimestamp();
      });

      return paginate(interaction, pages);
    }

    // ── /watch list ───────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!await requireClearance(interaction, 'watch.log')) return;
      const watchlist = surv.getWatchlist();

      if (watchlist.length === 0) {
        return interaction.reply({
          embeds: [errorEmbed('WATCHLIST EMPTY', 'No subjects are currently under surveillance.')],
          ephemeral: true
        });
      }

      const chunks = chunkArray(watchlist, 8);
      const pages = chunks.map((chunk, i) => {
        const lines = chunk.map((entry, idx) => {
          const profile = db.getProfile(entry.userId);
          const name = profile ? profile.username : entry.userId;
          const since = new Date(entry.watchlistedAt).toISOString().split('T')[0];
          return `  [${String(idx + 1).padStart(2, '0')}] ${name.padEnd(20)} | Since: ${since} | Events: ${entry.eventCount}`;
        }).join('\n');

        return new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle(`${config.botName} // ACTIVE WATCHLIST`)
          .setDescription(
            `\`\`\`\n[ ${watchlist.length} SUBJECT(S) UNDER SURVEILLANCE ]\n\n` +
            `  IDX  USERNAME             | SINCE      | EVENTS\n` +
            `  ${'─'.repeat(50)}\n${lines}\n\`\`\``
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
