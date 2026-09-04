/**
 * SERVERS COMMAND GROUP
 *
 * Commands:
 *   /servers blacklist [server-id] [reason]  — Blacklist a server
 *   /servers lift [server-id] [reason]       — Lift a blacklist
 *   /servers info [server-id]                — View blacklist entry
 *   /servers list [status]                   — List blacklisted servers
 *   /servers appeal [server-id] [note]       — Add an appeal note
 *   /servers check                           — Check if current server is blacklisted
 *
 * Access: "──── High Staff ────" role on SN server, or System Owner from anywhere.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const sbl        = require('../../modules/serverBlacklist');
const guard      = require('../../modules/serverGuard');
const rl         = require('../../modules/rateLimit');
const logger     = require('../../modules/logger');
const { paginate, chunk } = require('../../modules/pagination');
const config     = require('../../modules/config');
const snsSync    = require('../../modules/snsSync');

const STATUS_COLOR = {
  ACTIVE:    config.criticalColor,
  APPEALING: config.warningColor,
  LIFTED:    '#555555'
};
const STATUS_ICON = {
  ACTIVE:    '⛔',
  APPEALING: '🟡',
  LIFTED:    '✅'
};

function err(title, desc) {
  return new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${desc}\n\`\`\``)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('servers')
    .setDescription('Sentinel Network server blacklist management')

    // ── blacklist ──────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('blacklist')
      .setDescription('Add a server to the blacklist (High Staff only)')
      .addStringOption(o => o
        .setName('serverid')
        .setDescription('Discord server/guild ID to blacklist')
        .setRequired(true))
      .addStringOption(o => o
        .setName('reason')
        .setDescription('Reason for blacklisting (shown to server staff)')
        .setRequired(true)
        .setMaxLength(400))
    )

    // ── lift ───────────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('lift')
      .setDescription('Lift a server blacklist restriction (High Staff only)')
      .addStringOption(o => o
        .setName('serverid')
        .setDescription('Server ID to unblacklist')
        .setRequired(true))
      .addStringOption(o => o
        .setName('reason')
        .setDescription('Reason for lifting (stored in record)')
        .setRequired(false)
        .setMaxLength(300))
    )

    // ── info ───────────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('info')
      .setDescription('View full details of a server blacklist entry')
      .addStringOption(o => o
        .setName('serverid')
        .setDescription('Server ID to look up')
        .setRequired(true))
    )

    // ── list ───────────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List blacklisted servers')
      .addStringOption(o => o
        .setName('status')
        .setDescription('Filter by status (default: Active only)')
        .setRequired(false)
        .addChoices(
          { name: '⛔ Active',    value: 'ACTIVE'    },
          { name: '🟡 Appealing', value: 'APPEALING' },
          { name: '✅ Lifted',    value: 'LIFTED'    },
          { name: '📋 All',       value: 'ALL'       }
        ))
    )

    // ── appeal ─────────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('appeal')
      .setDescription('Append an appeal note to a server blacklist entry')
      .addStringOption(o => o
        .setName('serverid')
        .setDescription('Server ID to add appeal note to')
        .setRequired(true))
      .addStringOption(o => o
        .setName('note')
        .setDescription('Appeal note content')
        .setRequired(true)
        .setMaxLength(500))
    )

    // ── check ──────────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('check')
      .setDescription('Check if the current server is on the blacklist')
    ),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── /servers check — anyone in any server can run this ────────────────
    if (sub === 'check') {
      const entry = sbl.getBlacklistedServer(interaction.guildId);

      if (!entry || entry.status === 'LIFTED') {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.accentColor)
            .setTitle(`${config.botName} // SERVER STATUS`)
            .setDescription(
              `\`\`\`\n[ SERVER CLEARANCE CHECK ]\n` +
              `> Server  : ${interaction.guild?.name || 'Unknown'}\n` +
              `> ID      : ${interaction.guildId}\n` +
              `> Status  : ✅ CLEAR — Not on blacklist\n` +
              `> Access  : All commands available\n\`\`\``
            )
            .setTimestamp()
          ],
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(STATUS_COLOR[entry.status])
          .setTitle(`${config.botName} // SERVER STATUS`)
          .setDescription(
            `\`\`\`\n[ SERVER CLEARANCE CHECK ]\n` +
            `> Server  : ${interaction.guild?.name || 'Unknown'}\n` +
            `> ID      : ${interaction.guildId}\n` +
            `> Status  : ${STATUS_ICON[entry.status]} ${entry.status}\n` +
            `> Reason  : ${entry.reason}\n` +
            `> Since   : ${new Date(entry.addedAt).toUTCString()}\n` +
            `> Effect  : Sensitive commands are restricted\n` +
            `> Appeal  : Contact Sentinel Network HQ\n\`\`\``
          )
          .setTimestamp()
        ],
        ephemeral: true
      });
    }

    // ── All other /servers subcommands require High Staff ─────────────────
    if (!guard.hasHighStaffRole(interaction)) {
      return interaction.reply({
        embeds: [guard.buildNoHighStaffEmbed()],
        ephemeral: true
      });
    }

    // Owner can run from anywhere; High Staff must be in SN server
    const isOwner = interaction.user.id === config.systemOwnerId;
    if (!isOwner && interaction.guildId !== config.snServerId) {
      return interaction.reply({
        embeds: [err('WRONG SERVER', 'Server blacklist management must be done from the Sentinel Network main server.')],
        ephemeral: true
      });
    }

    // ── /servers blacklist ─────────────────────────────────────────────────
    if (sub === 'blacklist') {
      const serverId = interaction.options.getString('serverid').trim();
      const reason   = interaction.options.getString('reason');

      // Validate ID format
      if (!/^\d{17,20}$/.test(serverId)) {
        return interaction.reply({
          embeds: [err('INVALID ID', `\`${serverId}\` is not a valid Discord server ID. IDs are 17-20 digit numbers.`)],
          ephemeral: true
        });
      }

      // Prevent blacklisting the SN server itself
      if (serverId === config.snServerId) {
        return interaction.reply({
          embeds: [err('INVALID TARGET', 'You cannot blacklist the Sentinel Network main server.')],
          ephemeral: true
        });
      }

      // Try to fetch server info from Discord
      let serverName   = 'Unknown (not in server)';
      let memberCount  = 0;
      let ownerId      = 'Unknown';

      try {
        const guild = await interaction.client.guilds.fetch(serverId);
        if (guild) {
          serverName  = guild.name;
          memberCount = guild.memberCount;
          ownerId     = guild.ownerId;
        }
      } catch {
        // Bot is not in that server — that's fine, we still blacklist it
        logger.debug('servers', `Bot not in server ${serverId} — blacklisting anyway`);
      }

      const result = sbl.blacklistServer({
        serverId,
        serverName,
        reason,
        addedBy:    interaction.user.username,
        addedById:  interaction.user.id,
        memberCount,
        ownerId
      });

      if (result.error === 'ALREADY_BLACKLISTED') {
        return interaction.reply({
          embeds: [err('ALREADY BLACKLISTED', `Server \`${serverId}\` (${result.entry.serverName}) is already blacklisted with status: ${result.entry.status}`)],
          ephemeral: true
        });
      }

      const entry = result.entry;
      snsSync.publishBlacklistUpdate({
        scope: 'server',
        action: 'add',
        subjectId: serverId,
        entry
      });
      logger.info('servers', `Server blacklisted: ${serverName} (${serverId}) by ${interaction.user.username}`);

      // Alert HQ channels
      const alertEmbed = new EmbedBuilder()
        .setColor(config.criticalColor)
        .setTitle(`${config.botName} // ⛔ SERVER BLACKLISTED`)
        .setDescription(
          `\`\`\`\n[ SERVER ADDED TO BLACKLIST ]\n` +
          `> Server   : ${serverName}\n` +
          `> ID       : ${serverId}\n` +
          `> Owner ID : ${ownerId}\n` +
          `> Members  : ${memberCount}\n` +
          `> Reason   : ${reason}\n` +
          `> Added By : ${interaction.user.username}\n` +
          `> Time     : ${new Date().toUTCString()}\n\`\`\``
        )
        .setTimestamp();

      for (const chId of [config.snAlertChannelId, config.snAuditChannelId]) {
        if (!chId) continue;
        try {
          const ch = await interaction.client.channels.fetch(chId);
          if (ch?.isTextBased()) await ch.send({ embeds: [alertEmbed] });
        } catch { /* channel not found */ }
      }

      // DM system owner
      if (config.systemOwnerId && interaction.user.id !== config.systemOwnerId) {
        try {
          const owner = await interaction.client.users.fetch(config.systemOwnerId);
          await owner.send({ embeds: [alertEmbed] });
        } catch { /* DMs closed */ }
      }

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.criticalColor)
          .setTitle(`${config.botName} // SERVER BLACKLISTED`)
          .setDescription(
            `\`\`\`\n[ BLACKLIST ENTRY CREATED ]\n` +
            `> Server   : ${serverName}\n` +
            `> ID       : ${serverId}\n` +
            `> Members  : ${memberCount}\n` +
            `> Reason   : ${reason}\n` +
            `> Added By : ${interaction.user.username}\n` +
            `> Status   : ⛔ ACTIVE\n` +
            `> Effect   : Sensitive commands now restricted in that server\n` +
            `> HQ       : Alert sent to all SN channels\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }

    // ── /servers lift ──────────────────────────────────────────────────────
    if (sub === 'lift') {
      const serverId  = interaction.options.getString('serverid').trim();
      const liftReason = interaction.options.getString('reason') || 'No reason provided';

      const result = sbl.liftServerBlacklist(serverId, interaction.user.username, liftReason);

      if (result.error === 'NOT_FOUND') {
        return interaction.reply({
          embeds: [err('NOT FOUND', `No blacklist entry found for server ID \`${serverId}\``)],
          ephemeral: true
        });
      }
      if (result.error === 'ALREADY_LIFTED') {
        return interaction.reply({
          embeds: [err('ALREADY LIFTED', `Server \`${serverId}\` blacklist has already been lifted.`)],
          ephemeral: true
        });
      }

      const entry = result.entry;
      snsSync.publishBlacklistUpdate({
        scope: 'server',
        action: 'lift',
        subjectId: serverId,
        entry
      });
      logger.info('servers', `Server blacklist lifted: ${serverId} (${entry.serverName}) by ${interaction.user.username}`);

      // Alert HQ
      const liftEmbed = new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // ✅ SERVER BLACKLIST LIFTED`)
        .setDescription(
          `\`\`\`\n[ SERVER RESTRICTION REMOVED ]\n` +
          `> Server   : ${entry.serverName}\n` +
          `> ID       : ${serverId}\n` +
          `> Lifted By: ${interaction.user.username}\n` +
          `> Reason   : ${liftReason}\n` +
          `> Time     : ${new Date().toUTCString()}\n\`\`\``
        )
        .setTimestamp();

      for (const chId of [config.snAlertChannelId, config.snAuditChannelId]) {
        if (!chId) continue;
        try {
          const ch = await interaction.client.channels.fetch(chId);
          if (ch?.isTextBased()) await ch.send({ embeds: [liftEmbed] });
        } catch { /* skip */ }
      }

      return interaction.reply({ embeds: [liftEmbed] });
    }

    // ── /servers info ──────────────────────────────────────────────────────
    if (sub === 'info') {
      const serverId = interaction.options.getString('serverid').trim();
      const entry    = sbl.getBlacklistedServer(serverId);

      if (!entry) {
        return interaction.reply({
          embeds: [err('NOT FOUND', `No blacklist entry for server ID \`${serverId}\``)],
          ephemeral: true
        });
      }

      const appealLines = entry.appealNotes?.length > 0
        ? entry.appealNotes.map((a, i) =>
            `  [${i + 1}] [${new Date(a.addedAt).toISOString().split('T')[0]}] ${a.addedBy}: ${a.note.substring(0, 80)}`
          ).join('\n')
        : '  No appeal notes.';

      const pages = [];

      pages.push(new EmbedBuilder()
        .setColor(STATUS_COLOR[entry.status] || '#555')
        .setTitle(`${config.botName} // SERVER BLACKLIST ENTRY`)
        .setDescription(
          `\`\`\`\n[ SERVER: ${entry.serverName} ]\n` +
          `> Server ID  : ${entry.serverId}\n` +
          `> Status     : ${STATUS_ICON[entry.status]} ${entry.status}\n` +
          `> Owner ID   : ${entry.ownerId}\n` +
          `> Members    : ${entry.memberCount}\n` +
          `> Reason     : ${entry.reason}\n` +
          `> Added By   : ${entry.addedBy}\n` +
          `> Added At   : ${new Date(entry.addedAt).toUTCString()}\n` +
          (entry.liftedAt ? `> Lifted At  : ${new Date(entry.liftedAt).toUTCString()}\n` : '') +
          (entry.liftedBy ? `> Lifted By  : ${entry.liftedBy}\n` : '') +
          (entry.liftReason ? `> Lift Reason: ${entry.liftReason}\n` : '') +
          `> Appeals    : ${entry.appealNotes?.length || 0} note(s)\n\`\`\``
        )
        .setFooter({ text: 'Page 1 — Overview' })
        .setTimestamp()
      );

      pages.push(new EmbedBuilder()
        .setColor(STATUS_COLOR[entry.status] || '#555')
        .setTitle(`${config.botName} // APPEAL NOTES`)
        .setDescription(`\`\`\`\n[ SERVER: ${entry.serverName} ]\n\n${appealLines}\n\`\`\``)
        .setFooter({ text: 'Page 2 — Appeal Notes' })
        .setTimestamp()
      );

      return paginate(interaction, pages);
    }

    // ── /servers list ──────────────────────────────────────────────────────
    if (sub === 'list') {
      const statusFilter = interaction.options.getString('status') || 'ACTIVE';
      const all          = sbl.getAllServerBlacklist();

      const filtered = statusFilter === 'ALL'
        ? all
        : all.filter(e => e.status === statusFilter);

      if (!filtered.length) {
        return interaction.reply({
          embeds: [err('NO RESULTS', `No blacklisted servers with status: \`${statusFilter}\``)],
          ephemeral: true
        });
      }

      const chunks = chunk(filtered, 6);
      const pages  = chunks.map((ch, i) => {
        const lines = ch.map(e =>
          `  ${STATUS_ICON[e.status]} ${e.serverId.padEnd(20)} ${e.serverName.substring(0, 22).padEnd(22)} ${e.status}`
        ).join('\n');

        return new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // SERVER BLACKLIST`)
          .setDescription(
            `\`\`\`\n[ FILTER: ${statusFilter} — ${filtered.length} ENTRY/ENTRIES ]\n\n` +
            `  ST SERVER ID            NAME                   STATUS\n` +
            `  ${'─'.repeat(60)}\n${lines}\n\`\`\``
          )
          .setFooter({ text: `Page ${i + 1}/${chunks.length} | Sentinel Network` })
          .setTimestamp();
      });

      return paginate(interaction, pages);
    }

    // ── /servers appeal ────────────────────────────────────────────────────
    if (sub === 'appeal') {
      const serverId = interaction.options.getString('serverid').trim();
      const note     = interaction.options.getString('note');

      const result = sbl.addAppealNote(serverId, note, interaction.user.username);

      if (result.error === 'NOT_FOUND') {
        return interaction.reply({
          embeds: [err('NOT FOUND', `No blacklist entry for server ID \`${serverId}\``)],
          ephemeral: true
        });
      }

      const entry = result.entry;
      snsSync.publishBlacklistUpdate({
        scope: 'server',
        action: 'appeal',
        subjectId: serverId,
        entry
      });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle(`${config.botName} // APPEAL NOTE ADDED`)
          .setDescription(
            `\`\`\`\n[ APPEAL REGISTERED ]\n` +
            `> Server  : ${entry.serverName}\n` +
            `> ID      : ${serverId}\n` +
            `> Status  : ${STATUS_ICON[entry.status]} ${entry.status}\n` +
            `> Note    : ${note.substring(0, 100)}${note.length > 100 ? '...' : ''}\n` +
            `> Added By: ${interaction.user.username}\n` +
            `> Total   : ${entry.appealNotes.length} appeal note(s)\n\`\`\``
          )
          .setTimestamp()
        ]
      });
    }
  }
};
