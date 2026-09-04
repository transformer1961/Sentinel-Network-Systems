/**
 * LOCAL LOCKDOWN COMMAND GROUP
 *
 * Allows trusted server staff and guild owners to manage local lockdown state.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const security = require('../../modules/serverSecurity');
const rl = require('../../modules/rateLimit');
const config = require('../../modules/config');

const LOCKDOWN_LEVELS = [
  { name: 'SOFT', value: 'SOFT' },
  { name: 'MEDIUM', value: 'MEDIUM' },
  { name: 'HARD', value: 'HARD' }
];

function hasLocalAdmin(interaction) {
  if (!interaction.guild) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  const roleName = config.trustedServerStaffRole || 'SN-Trusted';
  return interaction.member?.roles?.cache?.some(r => r.name === roleName);
}

function buildLockdownStatusEmbed(state) {
  const lockdown = state.lockdown;
  const tlsLocal = state.tls.local;
  const tlsHq = state.tls.hq;

  return new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(`${config.botName} // SERVER LOCKDOWN STATUS`)
    .setDescription(
      `\`\`\`\n` +
      `> Server        : ${state.serverId}\n` +
      `> Effective TLS : ${state.effectiveTLS}\n` +
      `> Effective Lockdown : ${state.effectiveLockdown.level}\n` +
      `> Lockdown Active    : ${lockdown.active ? 'Yes' : 'No'}\n` +
      `> Local Lockdown     : ${lockdown.active ? lockdown.level : 'NONE'}\n` +
      `> Local TLS          : ${tlsLocal.level}\n` +
      `> Local TLC          : ${tlsLocal.tcl || 'UNCLASSIFIED'}\n` +
      `> HQ TLS             : ${tlsHq.level}\n` +
      `> HQ TLC             : ${tlsHq.tcl || 'UNCLASSIFIED'}\n` +
      `\`\`\``
    )
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Local server lockdown management')
    .addSubcommand(sub =>
      sub.setName('enable')
        .setDescription('Enable local lockdown for this server')
        .addStringOption(opt => opt.setName('level').setDescription('Local lockdown level').setRequired(true).addChoices(...LOCKDOWN_LEVELS))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for lockdown').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable the local lockdown for this server')
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for clearing').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('View this server lock and threat status')
    ),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.dangerColor)
          .setTitle(`${config.botName} // INVALID CONTEXT`)
          .setDescription(`\`\`\`\nLocal lockdown commands may only be used inside a Discord server.\n\`\`\``)
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
          .setDescription(`\`\`\`\nOnly the guild owner or trusted server staff may manage local lockdown state.\n\`\`\``)
          .setTimestamp()
        ],
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const state = security.getSecurityState(interaction.guild.id);

    if (sub === 'enable') {
      const level = interaction.options.getString('level');
      const reason = interaction.options.getString('reason');
      const entry = security.setLockdown(interaction.guild.id, {
        level,
        type: 'LOCAL',
        reason,
        triggeredBy: interaction.user.username,
        triggeredById: interaction.user.id
      });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle(`${config.botName} // LOCAL LOCKDOWN ENABLED`)
          .setDescription(
            `\`\`\`\n` +
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

    if (sub === 'disable') {
      const reason = interaction.options.getString('reason');
      const result = security.clearLockdown(interaction.guild.id, interaction.user.username, reason);
      if (result.error) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.dangerColor)
            .setTitle(`${config.botName} // NO ACTIVE LOCKDOWN`)
            .setDescription(`\`\`\`\nThere is no local lockdown currently active for this server.\n\`\`\``)
            .setTimestamp()
          ],
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.accentColor)
          .setTitle(`${config.botName} // LOCAL LOCKDOWN CLEARED`)
          .setDescription(
            `\`\`\`\n` +
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
      return interaction.reply({ embeds: [buildLockdownStatusEmbed(state)], ephemeral: true });
    }

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.dangerColor)
        .setTitle(`${config.botName} // INVALID COMMAND`)
        .setDescription(`\`\`\`\nUnknown lockdown subcommand.\n\`\`\``)
        .setTimestamp()
      ],
      ephemeral: true
    });
  }
};
