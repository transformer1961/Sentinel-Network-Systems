/**
 * LOCAL TLS COMMAND GROUP
 *
 * Allows trusted server staff and guild owners to set local threat levels.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const security = require('../../modules/serverSecurity');
const rl = require('../../modules/rateLimit');
const config = require('../../modules/config');

const TLS_LEVELS = [
  { name: 'GREEN', value: 'GREEN' },
  { name: 'BLUE', value: 'BLUE' },
  { name: 'YELLOW', value: 'YELLOW' },
  { name: 'ORANGE', value: 'ORANGE' },
  { name: 'RED', value: 'RED' }
];

const TLC_LEVELS = security.VALID_TLC.map(tcl => ({ name: tcl, value: tcl }));

function hasLocalAdmin(interaction) {
  if (!interaction.guild) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  const roleName = config.trustedServerStaffRole || 'SN-Trusted';
  return interaction.member?.roles?.cache?.some(r => r.name === roleName);
}

function buildTLSStatusEmbed(state) {
  const localTls = state.tls.local;
  const hqTls = state.tls.hq;

  return new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(`${config.botName} // THREAT LEVEL STATUS`)
    .setDescription(
      `\`\`\`\n` +
      `> Server         : ${state.serverId}\n` +
      `> Effective TLS  : ${state.effectiveTLS}\n` +
      `> Local TLS      : ${localTls.level}\n` +
      `> Local TLC      : ${localTls.tcl || 'UNCLASSIFIED'}\n` +
      `> Local Set By   : ${localTls.setBy || 'N/A'}\n` +
      `> Local Set At   : ${localTls.setAt || 'N/A'}\n` +
      `> Local Reason   : ${localTls.reason || 'None'}\n\n` +
      `> HQ TLS         : ${hqTls.level}\n` +
      `> HQ TLC         : ${hqTls.tcl || 'UNCLASSIFIED'}\n` +
      `> HQ Set By      : ${hqTls.setBy || 'N/A'}\n` +
      `> HQ Set At      : ${hqTls.setAt || 'N/A'}\n` +
      `> HQ Reason      : ${hqTls.reason || 'None'}\n` +
      `\`\`\``
    )
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tls')
    .setDescription('Local threat level controls')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set a local threat level for this server')
        .addStringOption(opt => opt.setName('level').setDescription('Local threat level').setRequired(true).addChoices(...TLS_LEVELS))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for threat level').setRequired(true))
        .addStringOption(opt => opt.setName('tcl').setDescription('Threat level class for this incident').setRequired(false).addChoices(...TLC_LEVELS))
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View this server threat level status')
    ),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.dangerColor)
          .setTitle(`${config.botName} // INVALID CONTEXT`)
          .setDescription(`\`\`\`\nLocal TLS commands may only be used inside a Discord server.\n\`\`\``)
          .setTimestamp()
        ],
        ephemeral: true
      });
    }

    if (!hasLocalAdmin(interaction)) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.dangerColor)
          .setTitle(`${config.botName} // ACCESS DENIED`)
          .setDescription(`\`\`\`\nOnly the guild owner or trusted server staff may manage local threat levels.\n\`\`\``)
          .setTimestamp()
        ],
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const state = security.getSecurityState(interaction.guild.id);

    if (sub === 'set') {
      const level = interaction.options.getString('level');
      const tcl = interaction.options.getString('tcl');
      const reason = interaction.options.getString('reason');
      const normalizedTcl = tcl ? security.normalizeTLC(tcl) : null;

      if (tcl && !normalizedTcl) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.dangerColor)
            .setTitle(`${config.botName} // INVALID THREAT CLASS`)
            .setDescription(`\`\`\`\nThreat class must be one of: ${security.VALID_TLC.join(', ')}\n\`\`\``)
            .setTimestamp()
          ],
          ephemeral: true
        });
      }

      const entry = security.setLocalTLS(interaction.guild.id, level, normalizedTcl, reason, interaction.user.username, interaction.user.id);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(level === 'RED' ? config.criticalColor : config.warningColor)
          .setTitle(`${config.botName} // LOCAL THREAT LEVEL SET`)
          .setDescription(
            `\`\`\`\n` +
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
      return interaction.reply({ embeds: [buildTLSStatusEmbed(state)], ephemeral: true });
    }

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.dangerColor)
        .setTitle(`${config.botName} // INVALID COMMAND`)
        .setDescription(`\`\`\`\nUnknown TLS subcommand.\n\`\`\``)
        .setTimestamp()
      ],
      ephemeral: true
    });
  }
};
