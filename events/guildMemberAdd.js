/**
 * EVENT: guildMemberAdd
 *
 * Fires when any user joins any server the bot is in.
 *
 * Responsibilities:
 * 1. Auto-create profile if new to the network
 * 2. Track new server on existing profile
 * 3. Cross-server alert if flagged (risk ≥ 2) or blacklisted
 * 4. Log join for watched users
 * 5. Global watchlist propagation: if flagged in one server → globally flagged
 */

const { Events } = require('discord.js');
const db     = require('../modules/database');
const alerts = require('../modules/alerts');
const logger = require('../modules/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  once: false,

  async execute(member, client) {
    const { user, guild } = member;
    logger.debug('guildMemberAdd', `${user.username} joined ${guild.name}`);

    try {
      // ── 1. Profile management ──────────────────────────────────────────────
      const existing = db.getProfile(user.id);

      if (!existing) {
        // Brand new to the network
        db.createProfile(user, guild.id);
        logger.debug('guildMemberAdd', `Auto-created profile for ${user.username}`);
      } else {
        // Track this new server
        db.trackServer(user.id, guild.id);

        // ── 6. Global watchlist propagation ───────────────────────────────────
        // If profile has riskLevel ≥ 2 and not yet watchlisted, auto-watchlist
        if (existing.riskLevel >= 2 && !existing.watchlisted) {
          db.addToWatchlist(user.id, 'SYSTEM (auto — risk ≥ 2)', guild.id);
          logger.info('guildMemberAdd', `Auto-watchlisted ${user.username} due to risk level ${existing.riskLevel}`);
        }
      }

      // ── 2. Surveillance log ────────────────────────────────────────────────
      if (db.isWatched(user.id)) {
        db.appendLog(user.id, 'JOIN', `Joined ${guild.name} (${guild.id})`, guild.id);
        logger.info('guildMemberAdd', `[SURVEILLANCE] ${user.username} joined ${guild.name}`);
      }

      // ── 3. Cross-server alert ──────────────────────────────────────────────
      await alerts.checkAndAlertJoin(client, member);

    } catch (err) {
      logger.error('guildMemberAdd', `Failed to process join for ${user.username}`, err);
    }
  }
};
