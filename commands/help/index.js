/**
 * HELP COMMAND v3
 * Shows all commands with clearance requirements and access status.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const perms  = require('../../modules/permissions');
const rl     = require('../../modules/rateLimit');
const config = require('../../modules/config');

const ALL_CMDS = [
  { cmd: '/profile create [user]',           clr: 1,   desc: 'Create profile' },
  { cmd: '/profile view [user]',             clr: 1,   desc: 'View dossier' },
  { cmd: '/profile severity [user]',         clr: 1,   desc: 'Check risk level' },
  { cmd: '/profile search [filter]',         clr: 1,   desc: 'Search profiles' },
  { cmd: '/profile add-note [user] [text]',  clr: 2,   desc: 'Add intel note' },
  { cmd: '/profile remove-note [user] [id]', clr: 2,   desc: 'Remove note' },
  { cmd: '/case open [title]',               clr: 2,   desc: 'Open case' },
  { cmd: '/case view [caseId]',              clr: 1,   desc: 'View case details' },
  { cmd: '/case list [status]',              clr: 1,   desc: 'List cases' },
  { cmd: '/case add-evidence [id] [text]',   clr: 2,   desc: 'File evidence' },
  { cmd: '/profile flag [user] [lvl]',       clr: 3,   desc: 'Flag user (1-5)' },
  { cmd: '/watch add [user]',                clr: 3,   desc: 'Add to watchlist' },
  { cmd: '/watch remove [user]',             clr: 3,   desc: 'Remove from watchlist' },
  { cmd: '/watch notify [user]',             clr: 3,   desc: 'Enable join alerts' },
  { cmd: '/watch disable-notify [user]',     clr: 3,   desc: 'Disable join alerts' },
  { cmd: '/case assign [id] [user]',         clr: 2.5, desc: 'Assign agent' },
  { cmd: '/watch log [user]',                clr: 2,   desc: 'View activity log' },
  { cmd: '/watch list',                      clr: 2,   desc: 'Watchlist overview' },
  { cmd: '/admin setup [channel]',           clr: 4,   desc: 'Set server alert channel' },
  { cmd: '/case close [id]',                 clr: 4,   desc: 'Close investigation' },
  { cmd: '/case reopen [id]',                clr: 4,   desc: 'Reopen investigation' },
  { cmd: '/admin audit',                     clr: 4,   desc: 'System audit report' },
  { cmd: '/admin promote [user] [level]',    clr: 3.5, desc: 'Promote agent' },
  { cmd: '/admin demote [user] [level]',     clr: 3.5, desc: 'Demote agent' },
  { cmd: '/profile escalate [user] [lvl]',   clr: 5,   desc: 'Escalate severity (Director+)' },
  { cmd: '/admin blacklist [user] [reason]', clr: 5,   desc: 'Global blacklist (Director+)' },
  { cmd: '/admin unblacklist [user]',        clr: 5,   desc: 'Remove from blacklist (Director+)' },
  { cmd: '/lockdown enable [level] [reason]', clr: 2,   desc: 'Enable local lockdown' },
  { cmd: '/lockdown disable [reason]',       clr: 2,   desc: 'Disable local lockdown' },
  { cmd: '/lockdown status',                 clr: 1,   desc: 'View local lockdown status' },
  { cmd: '/tls set [level] [tcl] [reason]', clr: 2,   desc: 'Set local threat level and classification' },
  { cmd: '/tls view',                       clr: 1,   desc: 'View local threat level' },
  { cmd: '/hq lockdown force [id] [level] [reason]', clr: 4, desc: 'Force HQ lockdown (Director+)' },
  { cmd: '/hq lockdown clear [id] [reason]',  clr: 4,   desc: 'Clear HQ lockdown' },
  { cmd: '/hq lockdown status [id]',         clr: 4,   desc: 'View HQ lockdown status' },
  { cmd: '/hq tls set [id] [level] [tcl] [reason]', clr: 4,   desc: 'Set HQ threat level and classification' },
  { cmd: '/hq tls view [id]',               clr: 4,   desc: 'View HQ threat status' },
  { cmd: '/hq tls list',                    clr: 4,   desc: 'List HQ security entries' },
  { cmd: '/servers check',                   clr: 1,   desc: 'Check if this server is blacklisted' },
  { cmd: '/servers blacklist [id] [reason]', clr: 99,  desc: 'Blacklist a server (High Staff only)' },
  { cmd: '/servers lift [id]',               clr: 99,  desc: 'Lift server restriction (High Staff only)' },
  { cmd: '/servers info [id]',               clr: 99,  desc: 'View server blacklist entry (High Staff only)' },
  { cmd: '/servers list [status]',           clr: 99,  desc: 'List blacklisted servers (High Staff only)' },
  { cmd: '/servers appeal [id] [note]',      clr: 99,  desc: 'Add appeal note (High Staff only)' },
  { cmd: '/blacklist user [target]',         clr: 1,   desc: 'Check a user blacklist status' },
  { cmd: '/blacklist server [serverid]',     clr: 1,   desc: 'Check a server blacklist status' },
  { cmd: '/blacklist list',                  clr: 5,   desc: 'List active blacklist entries' },
  { cmd: '/kepler activate [reason]',        clr: 99,  desc: 'Activate Kepler Protocol (System Owner only)' },
  { cmd: '/kepler deactivate [reason]',      clr: 99,  desc: 'Deactivate Kepler Protocol (System Owner only)' },
  { cmd: '/kepler status',                   clr: 99,  desc: 'View Kepler Protocol status (System Owner only)' },
  { cmd: '/kepler phase',                    clr: 99,  desc: 'View current Kepler phase (System Owner only)' },
  { cmd: '/kepler advance [target]',         clr: 5,   desc: 'Advance Kepler phase (Director+ only)' },
  { cmd: '/kepler snapshot [label]',         clr: 5,   desc: 'Create forensic snapshot (Director+ only)' },
  { cmd: '/kepler diagnostics',              clr: 1,   desc: 'Run system diagnostics' },
  { cmd: '/kepler simulate',                 clr: 5,   desc: 'Run training simulation (Director+ only)' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all Sentinel Network commands and your access level'),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;

    const userLevel = perms.getUserClearance(interaction.user.id);
    const groups    = {};

    for (const c of ALL_CMDS) {
      const key = String(c.clr);
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }

    const fields = Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, cmds]) => {
        const lvlNum = Number(level);
        const header = lvlNum === 99 ? '🔱 High Staff Role Required' : `🔐 ${perms.getRoleName(lvlNum)} Required`;
        const lines = cmds.map(c => {
          const accessible = lvlNum === 99
            ? (interaction.user.id === config.systemOwnerId)
            : userLevel >= c.clr;
          return `  ${accessible ? '✅' : '🔒'} ${c.cmd.padEnd(36)} ${c.desc}`;
        }).join('\n');

        return { name: header, value: `\`\`\`\n${lines}\n\`\`\``, inline: false };
      });

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // COMMAND MANIFEST`)
        .setDescription(
          `\`\`\`\n[ SENTINEL NETWORK — HELP SYSTEM ]\n` +
          `> Your Clearance : ${perms.getRoleName(userLevel)}\n` +
          `> ✅ = Access granted  |  🔒 = Clearance required\n\`\`\``
        )
        .addFields(...fields)
        .setFooter({ text: 'Use /admin promote to elevate agent clearance' })
        .setTimestamp()
      ],
      ephemeral: true
    });
  }
};
