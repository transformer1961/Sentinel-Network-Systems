/**
 * EVENT: guildMemberRemove
 * Logs leaves for watched/flagged users.
 */

const { Events } = require('discord.js');
const db     = require('../modules/database');
const logger = require('../modules/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  once: false,

  async execute(member, client) {
    const { user, guild } = member;
    logger.debug('guildMemberRemove', `${user.username} left ${guild.name}`);

    try {
      if (!db.isWatched(user.id)) return;

      db.appendLog(user.id, 'LEAVE', `Left ${guild.name} (${guild.id})`, guild.id);
      logger.info('guildMemberRemove', `[SURVEILLANCE] ${user.username} left ${guild.name}`);
    } catch (err) {
      logger.error('guildMemberRemove', `Failed to process leave for ${user?.username}`, err);
    }
  }
};
