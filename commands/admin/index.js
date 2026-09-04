/**
 * ADMIN COMMAND GROUP v3
 * /admin promote | demote | audit | blacklist | unblacklist | setup
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db     = require('../../modules/database');
const perms  = require('../../modules/permissions');
const rl     = require('../../modules/rateLimit');
const alerts = require('../../modules/alerts');
const inv    = require('../../modules/investigation');
const { paginate, chunk } = require('../../modules/pagination');
const config = require('../../modules/config');
const snsSync = require('../../modules/snsSync');

function err(title, desc) {
  return new EmbedBuilder().setColor(config.dangerColor)
    .setTitle(`${config.botName} // ${title}`)
    .setDescription(`\`\`\`\n[ ERROR ]\n> ${desc}\n\`\`\``)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administrative controls — SN staff only')

    .addSubcommand(s => s.setName('promote').setDescription('Promote a user to a clearance level')
      .addUserOption(o => o.setName('user').setDescription('Agent to promote').setRequired(true))
      .addNumberOption(o => o.setName('level').setDescription('New clearance level').setRequired(true)
        .addChoices(
          { name: 'Level 1 — Recruit',               value: 1   },
          { name: 'Level 1.5 — Trainee Agent',       value: 1.5 },
          { name: 'Level 2 — Agent',                 value: 2   },
          { name: 'Level 2.5 — Investigator',        value: 2.5 },
          { name: 'Level 3 — Senior Investigator',   value: 3   },
          { name: 'Level 3.5 — Supervisor',          value: 3.5 },
          { name: 'Level 4 — Operations Lead',       value: 4   },
          { name: 'Level 4.5 — Deputy Director',     value: 4.5 },
          { name: 'Level 5 — Director',              value: 5   },
          { name: 'Level 6 — System Owner',          value: 6   }
        )))

    .addSubcommand(s => s.setName('demote').setDescription('Demote a user to a lower clearance level')
      .addUserOption(o => o.setName('user').setDescription('Agent to demote').setRequired(true))
      .addNumberOption(o => o.setName('level').setDescription('New (lower) clearance level').setRequired(true)
        .addChoices(
          { name: 'Level 1 — Recruit',               value: 1   },
          { name: 'Level 1.5 — Trainee Agent',       value: 1.5 },
          { name: 'Level 2 — Agent',                 value: 2   },
          { name: 'Level 2.5 — Investigator',        value: 2.5 },
          { name: 'Level 3 — Senior Investigator',   value: 3   },
          { name: 'Level 3.5 — Supervisor',          value: 3.5 },
          { name: 'Level 4 — Operations Lead',       value: 4   }
        )))

    .addSubcommand(s => s.setName('audit').setDescription('View full system audit (Operations Lead+)'))

    .addSubcommand(s => s.setName('blacklist').setDescription('Add a user to the global blacklist (Director+)')
      .addUserOption(o => o.setName('user').setDescription('User to blacklist').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason (proof required)').setRequired(true).setMaxLength(400)))

    .addSubcommand(s => s.setName('unblacklist').setDescription('Remove a user from the global blacklist (Director+)')
      .addUserOption(o => o.setName('user').setDescription('User to unblacklist').setRequired(true)))

    .addSubcommand(s => s.setName('setup').setDescription('Configure this server\'s alert channel')
      .addChannelOption(o => o.setName('channel').setDescription('Alert channel for this server').setRequired(true))),

  async execute(interaction) {
    if (!await rl.apply(interaction)) return;
    const sub = interaction.options.getSubcommand();

    // ── promote ───────────────────────────────────────────────────────────
    if (sub === 'promote') {
      if (!await perms.requireAccess(interaction, 'admin.promote')) return;

      const target   = interaction.options.getUser('user');
      const newLevel = interaction.options.getNumber('level');
      const myLevel  = perms.getUserClearance(interaction.user.id);

      // Can't promote to your own level or above (unless System Owner)
      if (newLevel >= myLevel && myLevel < 6) {
        return interaction.reply({ embeds: [err('DENIED', `You cannot promote to Level ${newLevel} — exceeds your clearance.`)], ephemeral: true });
      }

      let p = db.getProfile(target.id);
      if (!p) p = db.createProfile(target, interaction.guildId);

      const oldLevel = p.clearance;
      if (newLevel <= oldLevel) {
        return interaction.reply({ embeds: [err('USE DEMOTE', `Target is already Level ${oldLevel}. Use /admin demote instead.`)], ephemeral: true });
      }

      perms.setClearance(target.id, newLevel);
      db.appendLog(target.id, 'PROMOTED', `L${oldLevel} → L${newLevel} by ${interaction.user.username}`, interaction.guildId);
      await alerts.auditLog(interaction.client, interaction, sub);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // AGENT PROMOTED`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ CLEARANCE UPDATED ]\n` +
          `> Agent    : ${target.username}\n` +
          `> Previous : ${perms.getRoleName(oldLevel)}\n` +
          `> New      : ${perms.getRoleName(newLevel)}\n` +
          `> Issued By: ${interaction.user.username}\n` +
          `> Time     : ${new Date().toUTCString()}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── demote ────────────────────────────────────────────────────────────
    if (sub === 'demote') {
      if (!await perms.requireAccess(interaction, 'admin.promote')) return;

      const target   = interaction.options.getUser('user');
      const newLevel = interaction.options.getNumber('level');
      const myLevel  = perms.getUserClearance(interaction.user.id);

      let p = db.getProfile(target.id);
      if (!p) return interaction.reply({ embeds: [err('NO PROFILE', `No profile for \`${target.username}\`.`)], ephemeral: true });

      const oldLevel = p.clearance;
      if (newLevel >= oldLevel) {
        return interaction.reply({ embeds: [err('USE PROMOTE', `New level must be lower than current (${oldLevel}). Use /admin promote.`)], ephemeral: true });
      }

      // Can't demote someone at or above your own clearance
      if (oldLevel >= myLevel && myLevel < 6) {
        return interaction.reply({ embeds: [err('DENIED', `Cannot demote an agent at or above your clearance.`)], ephemeral: true });
      }

      perms.setClearance(target.id, newLevel);
      db.appendLog(target.id, 'DEMOTED', `L${oldLevel} → L${newLevel} by ${interaction.user.username}`, interaction.guildId);
      await alerts.auditLog(interaction.client, interaction, sub);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle(`${config.botName} // AGENT DEMOTED`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ CLEARANCE REDUCED ]\n` +
          `> Agent    : ${target.username}\n` +
          `> Previous : ${perms.getRoleName(oldLevel)}\n` +
          `> New      : ${perms.getRoleName(newLevel)}\n` +
          `> Issued By: ${interaction.user.username}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── audit ─────────────────────────────────────────────────────────────
    if (sub === 'audit') {
      if (!await perms.requireAccess(interaction, 'admin.audit')) return;

      const allProfiles  = Object.values(db.getAllProfiles());
      const allCases     = Object.values(db.getAllCases());
      const watchlist    = db.getWatchlist();
      const blacklist    = Object.values(db.getBlacklist());

      const riskOrder = { 5: 5, 4: 4, 3: 3, 2: 2, 1: 1, 0: 0 };
      const topRisk = allProfiles
        .filter(p => p.riskLevel > 0)
        .sort((a, b) => (riskOrder[b.riskLevel] || 0) - (riskOrder[a.riskLevel] || 0))
        .slice(0, 6)
        .map(p => `  ${alerts.SEVERITY_ICONS[p.riskLevel]} ${p.username.padEnd(22)} L${p.riskLevel}${p.blacklisted ? ' ⛔' : ''}`)
        .join('\n') || '  None.';

      const clearDist = {};
      for (const p of allProfiles) {
        const k = `${p.clearance}`;
        clearDist[k] = (clearDist[k] || 0) + 1;
      }
      const distLines = Object.entries(clearDist)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([lvl, cnt]) => `  ${perms.getRoleName(Number(lvl))}: ${cnt}`)
        .join('\n') || '  No data.';

      const recentCases = allCases.filter(c => c.status !== 'CLOSED').slice(-5)
        .map(c => `  🟢 ${c.caseId} — ${c.title.substring(0, 30)}`).join('\n') || '  None.';

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // SYSTEM AUDIT`)
        .setDescription(
          `\`\`\`\n[ NETWORK STATUS — ${new Date().toUTCString()} ]\n` +
          `> Auditor   : ${interaction.user.username}\n\`\`\``
        )
        .addFields(
          { name: '👤 SUBJECTS', value: `\`\`\`\nTotal      : ${allProfiles.length}\nFlagged    : ${allProfiles.filter(p => p.riskLevel > 0).length}\nWatchlisted: ${watchlist.length}\nBlacklisted: ${blacklist.length}\n\`\`\``, inline: true },
          { name: '📁 CASES',    value: `\`\`\`\nTotal  : ${allCases.length}\nOpen   : ${allCases.filter(c => c.status === 'OPEN').length}\nReview : ${allCases.filter(c => c.status === 'UNDER REVIEW').length}\nClosed : ${allCases.filter(c => c.status === 'CLOSED').length}\n\`\`\``, inline: true },
          { name: '🚨 TOP THREATS',         value: `\`\`\`\n${topRisk}\n\`\`\``,     inline: false },
          { name: '📋 ACTIVE CASES',        value: `\`\`\`\n${recentCases}\n\`\`\``, inline: false },
          { name: '🔐 CLEARANCE BREAKDOWN', value: `\`\`\`\n${distLines}\n\`\`\``,  inline: false }
        )
        .setTimestamp()
      ]});
    }

    // ── blacklist ─────────────────────────────────────────────────────────
    if (sub === 'blacklist') {
      if (!await perms.requireAccess(interaction, 'admin.blacklist')) return;

      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (db.isBlacklisted(target.id)) {
        return interaction.reply({ embeds: [err('ALREADY BLACKLISTED', `\`${target.username}\` is already on the global blacklist.`)], ephemeral: true });
      }

      // Ensure profile exists
      if (!db.getProfile(target.id)) db.createProfile(target, interaction.guildId);

      db.addToBlacklist(target.id, reason, interaction.user.username);
      snsSync.publishBlacklistUpdate({
        scope: 'user',
        action: 'add',
        subjectId: target.id,
        entry: db.getBlacklist()[target.id]
      });
      db.appendLog(target.id, 'BLACKLISTED', `By ${interaction.user.username}: ${reason}`, interaction.guildId);
      await alerts.alertBlacklist(interaction.client, target.username, target.id, reason, interaction.user.username);
      await alerts.auditLog(interaction.client, interaction, sub);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.criticalColor)
        .setTitle(`${config.botName} // ⛔ GLOBAL BLACKLIST`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `\`\`\`\n[ SUBJECT BLACKLISTED ]\n` +
          `> Subject   : ${target.username}\n` +
          `> ID        : ${target.id}\n` +
          `> Reason    : ${reason}\n` +
          `> Risk      : 💀 EXTREME (5/5)\n` +
          `> Added By  : ${interaction.user.username}\n` +
          `> Alert     : All SN staff notified\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── unblacklist ───────────────────────────────────────────────────────
    if (sub === 'unblacklist') {
      if (!await perms.requireAccess(interaction, 'admin.unblacklist')) return;

      const target = interaction.options.getUser('user');
      const removed = db.removeFromBlacklist(target.id);

      if (!removed) {
        return interaction.reply({ embeds: [err('NOT BLACKLISTED', `\`${target.username}\` is not on the blacklist.`)], ephemeral: true });
      }

      snsSync.publishBlacklistUpdate({
        scope: 'user',
        action: 'remove',
        subjectId: target.id,
        entry: {}
      });

      db.appendLog(target.id, 'UNBLACKLISTED', `By ${interaction.user.username}`, interaction.guildId);
      await alerts.auditLog(interaction.client, interaction, sub);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // BLACKLIST REMOVED`)
        .setDescription(
          `\`\`\`\n[ SUBJECT UNBLACKLISTED ]\n` +
          `> Subject    : ${target.username}\n` +
          `> Removed By : ${interaction.user.username}\n` +
          `> Time       : ${new Date().toUTCString()}\n\`\`\``
        ).setTimestamp()
      ]});
    }

    // ── setup ─────────────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!await perms.requireAccess(interaction, 'admin.setup')) return;
      const channel = interaction.options.getChannel('channel');

      db.setServerConfig(interaction.guildId, { alertChannelId: channel.id, serverId: interaction.guildId, serverName: interaction.guild?.name });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle(`${config.botName} // SERVER CONFIGURED`)
        .setDescription(
          `\`\`\`\n[ ALERT CHANNEL SET ]\n` +
          `> Server  : ${interaction.guild?.name}\n` +
          `> Channel : #${channel.name}\n` +
          `> Effect  : Flagged user join alerts will\n` +
          `            post to this channel.\n` +
          `> Set By  : ${interaction.user.username}\n\`\`\``
        ).setTimestamp()
      ]});
    }
  }
};
