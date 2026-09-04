/**
 * HQ COMMAND GROUP
 *
 * Controls HQ lockdown and threat level assignments across servers.
 * Only Directors and above may use these commands from the SN main server,
 * or the System Owner from anywhere.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getServerSecurity, getAllSecurityStates, getSecurityState, setLockdown, clearLockdown, setHQTLS, VALID_TLC, normalizeTLC } = require('../../modules/serverSecurity');
const rl = require('../../modules/rateLimit');
const perms = require('../../modules/permissions');
const logger = require('../../modules/logger');
const config = require('../../modules/config');

const LOCKDOWN_LEVELS = [
  { name: 'SOFT', value: 'SOFT' },
  { name: 'MEDIUM', value: 'MEDIUM' },
  { name: 'HARD', value: 'HARD' },
  { name: 'TOTAL', value: 'TOTAL' }
];

const TLS_LEVELS = [
  { name: 'GREEN', value: 'GREEN' },
  { name: 'BLUE', value: 'BLUE' },
  { name: 'YELLOW', value: 'YELLOW' },
  { name: 'ORANGE', value: 'ORANGE' },
  { name: 'RED', value: 'RED' },
  { name: 'BLACK', value: 'BLACK' }
];

function validateServerId(serverId) {
  return /^\d{17,20}$/.test(serverId);
}

function buildStatusEmbed(state) {
  const lockdown = state.lockdown;
  const hqTls = state.tls.hq;
  const localTls = state.tls.local;

  return new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(`${config.botName} // HQ SECURITY STATUS`)
    .setDescription(
      `\`\`\`\n` +
      `> Server     : ${state.serverId}\n` +
      `> Lockdown   : ${lockdown.active ? lockdown.level : 'NONE'} (${lockdown.type})\n` +
      `> Lockdown By: ${lockdown.triggeredBy || 'N/A'}\n` +
      `> Lockdown At: ${lockdown.triggeredAt || 'N/A'}\n` +
      `> Lockdown Reason: ${lockdown.reason || 'None'}\n\n` +
      `> TLS HQ      : ${hqTls.level}\n` +
      `> TLS HQ Class: ${hqTls.tcl || 'UNCLASSIFIED'}\n` +
      `> TLS HQ By   : ${hqTls.setBy || 'N/A'}\n` +
      `> TLS HQ At   : ${hqTls.setAt || 'N/A'}\n` +
      `> TLS HQ Note : ${hqTls.reason || 'None'}\n\n` +
      `> TLS Local   : ${localTls.level}\n` +
      `> TLS Local Class: ${localTls.tcl || 'UNCLASSIFIED'}\n` +
      `> TLS Local By: ${localTls.setBy || 'N/A'}\n` +
      `> TLS Local At: ${localTls.setAt || 'N/A'}\n` +
      `> TLS Local Note: ${localTls.reason || 'None'}\n\n` +
      `> Effective TLS      : ${state.effectiveTLS}\n` +
      `> Effective Lockdown : ${state.effectiveLockdown.level}\n` +
      `> Effective Source   : ${state.effectiveLockdown.source}\n` +
      `\`\`\``
    )
    .setTimestamp();
}

function buildListEmbed(states) {
  const lines = states.map(s => {
    const lock = s.lockdown.active ? s.lockdown.level : 'NONE';
    const hqTls = s.tls.hq.level;
    const hqTcl = s.tls.hq.tcl || 'UNCLASSIFIED';
    const localTls = s.tls.local.level;
    const localTcl = s.tls.local.tcl || 'UNCLASSIFIED';
    return `${s.serverId} | LD:${lock} | HQ:${hqTls}/${hqTcl} | LO:${localTls}/${localTcl}`;
  });

  return new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(`${config.botName} // HQ SECURITY OVERVIEW`)
    .setDescription(
      `\`\`\`\n` +
      (lines.length ? lines.join('\n') : 'No server security entries available.') +
      `\`\`\``
    )
    .setFooter({ text: `Showing ${lines.length} server(s)` })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hq')
    .setDescription('Sentinel HQ security controls')

    .addSubcommandGroup(group =>
      group.setName('lockdown')
        .setDescription('Force or clear a server lockdown')
        .addSubcommand(sub =>
          sub.setName('force')
            .setDescription('Force a server lockdown level')
            .addStringOption(opt => opt.setName('serverid').setDescription('Server ID to lock down').setRequired(true))
            .addStringOption(opt => opt.setName('level').setDescription('Lockdown level').setRequired(true).addChoices(...LOCKDOWN_LEVELS))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for lockdown').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('clear')
            .setDescription('Clear an active server lockdown')
            .addStringOption(opt => opt.setName('serverid').setDescription('Server ID to clear').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for clearing').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('status')
            .setDescription('View a server lockdown and TLS status')
            .addStringOption(opt => opt.setName('serverid').setDescription('Server ID to inspect').setRequired(true))
        )
    )

    .addSubcommandGroup(group =>
      group.setName('tls')
        .setDescription('Set or view threat levels')
        .addSubcommand(sub =>
          sub.setName('set')
            .setDescription('Set an HQ threat level for a server')
            .addStringOption(opt => opt.setName('serverid').setDescription('Server ID to target').setRequired(true))
            .addStringOption(opt => opt.setName('level').setDescription('Threat level').setRequired(true).addChoices(...TLS_LEVELS))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the threat level').setRequired(true))
            .addStringOption(opt => opt.setName('tcl').setDescription('Threat level class for this incident').setRequired(false).addChoices(...VALID_TLC.map(tcl => ({ name: tcl, value: tcl }))))
        )
        .addSubcommand(sub =>
          sub.setName('view')
            .setDescription('View a server threat level status')
            .addStringOption(opt => opt.setName('serverid').setDescription('Server ID to inspect').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('list')
            .setDescription('List all configured HQ server security states')
        )
    ),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    const commandKey = `${interaction.commandName}.${group}`;

    if (!await perms.requireAccess(interaction, commandKey)) return;

    const serverId = interaction.options.getString('serverid');
    const reason = interaction.options.getString('reason');

    if ((sub === 'force' || sub === 'clear' || sub === 'status' || sub === 'set' || sub === 'view') && !validateServerId(serverId)) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.dangerColor)
          .setTitle(`${config.botName} // INVALID SERVER ID`)
          .setDescription(`\`\`\`\nServer ID must be a 17-20 digit Discord guild ID.\n\`\`\``)
          .setTimestamp()
        ],
        ephemeral: true
      });
    }

    if (group === 'lockdown') {
      if (sub === 'force') {
        const level = interaction.options.getString('level');
        const entry = setLockdown(serverId, {
          level,
          type: 'HQ',
          reason,
          triggeredBy: interaction.user.username,
          triggeredById: interaction.user.id
        });

        logger.info('hq', `HQ lockdown forced on ${serverId}: ${level}`);

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.criticalColor)
            .setTitle(`${config.botName} // HQ LOCKDOWN ENGAGED`)
            .setDescription(
              `\`\`\`\n` +
              `> Server : ${serverId}\n` +
              `> Level  : ${entry.level}\n` +
              `> Reason : ${entry.reason}\n` +
              `> By     : ${entry.triggeredBy}\n` +
              `> Time   : ${entry.triggeredAt}\n` +
              `\`\`\``
            )
            .setTimestamp()
          ]
        });
      }

      if (sub === 'clear') {
        const result = clearLockdown(serverId, interaction.user.username, reason);
        if (result.error) {
          return interaction.reply({
            embeds: [new EmbedBuilder()
              .setColor(config.dangerColor)
              .setTitle(`${config.botName} // NO LOCKDOWN FOUND`)
              .setDescription(`\`\`\`\nThere is no active lockdown for server ${serverId}.\n\`\`\``)
              .setTimestamp()
            ],
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.accentColor)
            .setTitle(`${config.botName} // HQ LOCKDOWN CLEARED`)
            .setDescription(
              `\`\`\`\n` +
              `> Server : ${serverId}\n` +
              `> Cleared By : ${result.entry.clearedBy}\n` +
              `> Reason     : ${result.entry.clearedReason}\n` +
              `> Cleared At : ${result.entry.clearedAt}\n` +
              `\`\`\``
            )
            .setTimestamp()
          ]
        });
      }

      if (sub === 'status') {
        const state = getSecurityState(serverId);
        return interaction.reply({ embeds: [buildStatusEmbed(state)], ephemeral: true });
      }
    }

    if (group === 'tls') {
      if (sub === 'set') {
        const level = interaction.options.getString('level');
        const tcl = interaction.options.getString('tcl');
        const normalizedTcl = tcl ? normalizeTLC(tcl) : null;

        if (tcl && !normalizedTcl) {
          return interaction.reply({
            embeds: [new EmbedBuilder()
              .setColor(config.dangerColor)
              .setTitle(`${config.botName} // INVALID THREAT CLASS`)
              .setDescription(`\`\`\`\nThreat class must be one of: ${VALID_TLC.join(', ')}\n\`\`\``)
              .setTimestamp()
            ],
            ephemeral: true
          });
        }

        const entry = setHQTLS(serverId, level, normalizedTcl, reason, interaction.user.username, interaction.user.id);
        const active = level === 'RED' || level === 'BLACK';

        logger.info('hq', `HQ TLS set on ${serverId}: ${level}${entry.tcl ? ` ${entry.tcl}` : ''}`);

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(active ? config.criticalColor : config.warningColor)
            .setTitle(`${config.botName} // HQ THREAT LEVEL SET`)
            .setDescription(
              `\`\`\`\n` +
              `> Server : ${serverId}\n` +
              `> Level  : ${entry.level}\n` +
              `> Class  : ${entry.tcl || 'UNCLASSIFIED'}\n` +
              `> Reason : ${entry.reason}\n` +
              `> By     : ${entry.setBy}\n` +
              `> Time   : ${entry.setAt}\n` +
              `\`\`\``
            )
            .setTimestamp()
          ]
        });
      }

      if (sub === 'view') {
        const state = getSecurityState(serverId);
        return interaction.reply({ embeds: [buildStatusEmbed(state)], ephemeral: true });
      }

      if (sub === 'list') {
        const allStates = getAllSecurityStates().slice(0, 20);
        return interaction.reply({ embeds: [buildListEmbed(allStates)], ephemeral: true });
      }
    }

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.dangerColor)
        .setTitle(`${config.botName} // INVALID HQ COMMAND`)
        .setDescription(`\`\`\`\nSubcommand not recognized.\n\`\`\``)
        .setTimestamp()
      ],
      ephemeral: true
    });
  }
};
