/**
 * ALERTS MODULE
 * Handles DM notifications, channel alerts, and audit logging.
 * All alert functions are fire-and-forget (non-blocking).
 */

const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

/**
 * Send a DM to a user. Silently fails if DMs are closed.
 * @param {import('discord.js').Client} client
 * @param {string} userId
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function dmUser(client, userId, embed) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
  } catch {
    // User has DMs disabled — silently ignore
  }
}

/**
 * Post to the configured log/alert channel.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function postToLogChannel(client, embed) {
  if (!config.logChannelId) return;
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch {
    // Channel not found or no permission
  }
}

/**
 * Alert agents when they're assigned to a case.
 */
async function alertCaseAssigned(client, agentId, caseData, assignedBy) {
  const embed = new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // CASE ASSIGNMENT`)
    .setDescription(
      `\`\`\`\n` +
      `[ YOU HAVE BEEN ASSIGNED TO A CASE ]\n` +
      `> Case ID  : ${caseData.caseId}\n` +
      `> Title    : ${caseData.title}\n` +
      `> Status   : ${caseData.status}\n` +
      `> Assigned By: ${assignedBy}\n` +
      `> Time     : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Report to your case immediately.' })
    .setTimestamp();

  await dmUser(client, agentId, embed);
}

/**
 * Alert log channel when a watched user sends a message.
 */
async function alertWatchedMessage(client, userId, username, channelName, preview) {
  const embed = new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`${config.botName} // SURVEILLANCE ALERT`)
    .setDescription(
      `\`\`\`\n` +
      `[ WATCHED SUBJECT ACTIVITY DETECTED ]\n` +
      `> Subject  : ${username}\n` +
      `> ID       : ${userId}\n` +
      `> Channel  : #${channelName}\n` +
      `> Preview  : "${preview}"\n` +
      `> Time     : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Automated surveillance alert.' })
    .setTimestamp();

  await postToLogChannel(client, embed);
}

/**
 * Alert log channel when a CRITICAL flag is issued.
 */
async function alertCriticalFlag(client, targetUsername, targetId, issuedBy) {
  const embed = new EmbedBuilder()
    .setColor(config.dangerColor)
    .setTitle(`${config.botName} // ⚠️ CRITICAL FLAG ISSUED`)
    .setDescription(
      `\`\`\`\n` +
      `[ HIGH PRIORITY THREAT DETECTED ]\n` +
      `> Subject  : ${targetUsername}\n` +
      `> ID       : ${targetId}\n` +
      `> Flag     : CRITICAL\n` +
      `> Issued By: ${issuedBy}\n` +
      `> Time     : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Immediate review recommended.' })
    .setTimestamp();

  await postToLogChannel(client, embed);
}

/**
 * Post an audit log entry whenever any command is executed.
 */
async function auditLog(client, interaction, subcommand) {
  if (!config.auditChannelId) return;

  const embed = new EmbedBuilder()
    .setColor('#1a1a2e')
    .setTitle(`${config.botName} // AUDIT LOG`)
    .setDescription(
      `\`\`\`\n` +
      `> Agent   : ${interaction.user.username} (${interaction.user.id})\n` +
      `> Command : /${interaction.commandName}${subcommand ? ' ' + subcommand : ''}\n` +
      `> Channel : #${interaction.channel?.name || 'unknown'}\n` +
      `> Time    : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(config.auditChannelId);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch {
    // Silent fail
  }
}

/**
 * Alert when a new member joins — auto-profile creation notice.
 */
async function alertNewMember(client, member) {
  if (!config.logChannelId) return;

  const embed = new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(`${config.botName} // NEW SUBJECT DETECTED`)
    .setDescription(
      `\`\`\`\n` +
      `[ NEW MEMBER JOINED ]\n` +
      `> Username : ${member.user.username}\n` +
      `> ID       : ${member.id}\n` +
      `> Profile  : AUTO-CREATED\n` +
      `> Time     : ${new Date().toUTCString()}\n` +
      `\`\`\``
    )
    .setFooter({ text: 'Sentinel Network // Profile initialized automatically.' })
    .setTimestamp();

  await postToLogChannel(client, embed);
}

module.exports = {
  dmUser,
  postToLogChannel,
  alertCaseAssigned,
  alertWatchedMessage,
  alertCriticalFlag,
  auditLog,
  alertNewMember
};
