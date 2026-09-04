/**
 * EVENT: messageCreate
 *
 * Fires on every message in every server.
 *
 * Responsibilities:
 * 1. Ignore bots
 * 2. If author is watched → log message + alert channel
 * 3. If author is blacklisted → log (no further action — just tracking)
 * 4. Rate-limit alerts per user (max 1 per 60s) to avoid spam
 */

const { Events } = require('discord.js');
const db     = require('../modules/database');
const alerts = require('../modules/alerts');
const logger = require('../modules/logger');

// Per-user alert cooldown: userId → last alert timestamp
const alertCooldown = new Map();
const COOLDOWN_MS   = 60 * 1000; // 1 minute between message alerts per user

module.exports = {
  name: Events.MessageCreate,
  once: false,

  async execute(message, client) {
    // 1. Ignore bots and DMs
    if (message.author.bot) return;
    if (!message.guild)     return;

    const { author, guild, channel, content } = message;

    try {
      const isWatched     = db.isWatched(author.id);
      const isBlacklisted = db.isBlacklisted(author.id);

      if (!isWatched && !isBlacklisted) return;

      const preview   = (content || '[attachment/embed/sticker]').substring(0, 100);
      const chanName  = channel.name || 'unknown';
      const detail    = `#${chanName}: ${preview}`;

      // 2. Log message activity
      db.appendLog(author.id, 'MESSAGE', detail, guild.id);
      logger.debug('messageCreate', `[SURVEILLANCE] ${author.username} in ${guild.name}#${chanName}`);

      // 3. Alert channel (rate-limited)
      if (isWatched) {
        const lastAlert = alertCooldown.get(author.id) || 0;
        const now       = Date.now();

        if (now - lastAlert >= COOLDOWN_MS) {
          alertCooldown.set(author.id, now);
          await alerts.alertWatchedMessage(
            client, author.id, author.username, chanName, preview, guild.id
          );
          logger.event('messageCreate', `Alert sent for watched user ${author.username}`);
        }
      }

    } catch (err) {
      logger.error('messageCreate', `Failed to process message from ${author?.username}`, err);
    }
  }
};
