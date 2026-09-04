/**
 * EVENT: interactionCreate v3.2
 *
 * Pipeline per command:
 * 1. Resolve command key (name.subcommand)
 * 2. serverGuard.check() — blocks restricted commands in blacklisted servers
 * 3. Route to command's execute()
 * 4. Audit log (non-blocking)
 * 5. Clean error handling
 */

const { Events, EmbedBuilder } = require('discord.js');
const serverGuard = require('../modules/serverGuard');
const alerts      = require('../modules/alerts');
const logger      = require('../modules/logger');
const config      = require('../modules/config');

module.exports = {
  name: Events.InteractionCreate,
  once: false,

  async execute(interaction, client) {

    // ── Slash Commands ─────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // Build the command key (e.g. "profile.flag", "watch.add", "hq.lockdown.force")
      const group      = interaction.options.getSubcommandGroup(false);
      const sub        = interaction.options.getSubcommand(false);
      const commandKey = group
        ? `${interaction.commandName}.${group}.${sub}`
        : sub
          ? `${interaction.commandName}.${sub}`
          : interaction.commandName;

      // ── Server Guard check ─────────────────────────────────────────────
      // This blocks restricted commands in blacklisted servers
      // and fires HQ alerts + staff notifications automatically
      const allowed = await serverGuard.check(interaction, commandKey);
      if (!allowed) return;

      // ── Audit trail (non-blocking) ─────────────────────────────────────
      alerts.auditLog(client, interaction, sub).catch(e =>
        logger.warn('interactionCreate', 'Audit log failed', e)
      );

      logger.event('interactionCreate', `/${commandKey}`, {
        user:   interaction.user.username,
        userId: interaction.user.id,
        server: interaction.guild?.name || 'DM',
        guild:  interaction.guildId
      });

      // ── Execute command ────────────────────────────────────────────────
      try {
        await command.execute(interaction);
      } catch (err) {
        logger.error('interactionCreate', `Error in /${commandKey}`, err);

        const errEmbed = new EmbedBuilder()
          .setColor(config.dangerColor)
          .setTitle(`${config.botName} // SYSTEM ERROR`)
          .setDescription(
            `\`\`\`\n[ COMMAND FAILED ]\n` +
            `> Command : /${commandKey}\n` +
            `> Error   : ${err.message || 'Unknown error'}\n` +
            `> Contact the System Owner if this persists.\n\`\`\``
          )
          .setTimestamp();

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errEmbed], ephemeral: true });
          } else {
            await interaction.reply({ embeds: [errEmbed], ephemeral: true });
          }
        } catch {
          // Interaction expired — nothing we can do
        }
      }
      return;
    }

    // ── Buttons (pagination collectors handle their own interactions) ──────
    if (interaction.isButton()) {
      logger.debug('interactionCreate', `Button: ${interaction.customId} by ${interaction.user.username}`);
      return;
    }
  }
};
