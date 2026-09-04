/**
 * EVENT: ready
 * Fires once when the bot successfully connects to Discord.
 */

const { Events, ActivityType } = require('discord.js');
const logger = require('../modules/logger');
const config = require('../modules/config');

module.exports = {
  name:  Events.ClientReady,
  once:  true,

  execute(client) {
    const guilds = client.guilds.cache.size;
    const users  = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║     SENTINEL NETWORK v3.0 — ONLINE          ║');
    console.log(`║  Bot     : ${client.user.tag.padEnd(33)}║`);
    console.log(`║  Servers : ${String(guilds).padEnd(33)}║`);
    console.log(`║  Members : ${String(users).padEnd(33)}║`);
    console.log(`║  SN HQ   : ${(config.snServerId || 'NOT SET').padEnd(33)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    if (!config.snAlertChannelId) logger.warn('ready', 'snAlertChannelId not set — cross-server alerts disabled');
    if (!config.snAuditChannelId) logger.warn('ready', 'snAuditChannelId not set — audit logging disabled');
    if (!config.systemOwnerId)    logger.warn('ready', 'systemOwnerId not set — no System Owner access');
    if (config.debug)             logger.info('ready', 'DEBUG MODE ENABLED — verbose logging active');

    client.user.setActivity('Monitoring all servers...', { type: ActivityType.Watching });

    logger.info('ready', `Bot online as ${client.user.tag} in ${guilds} server(s)`);
  }
};
