const path = require('path');
const dotenv = require('dotenv');

// Load environment variables if not already loaded.
dotenv.config();

const rawConfig = require(path.join(__dirname, '..', 'config.json'));
const config = { ...rawConfig };

function parseBoolean(value) {
  if (typeof value !== 'string') return Boolean(value);
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function override(envKey, configKey, parser = (value) => value) {
  const value = process.env[envKey];
  if (value !== undefined && value !== '') {
    config[configKey] = parser(value);
  }
}

override('DISCORD_TOKEN', 'token');
override('CLIENT_ID', 'clientId');
override('GUILD_ID', 'guildId');
override('SN_SERVER_ID', 'snServerId');
override('SN_ALERT_CHANNEL_ID', 'snAlertChannelId');
override('SN_AUDIT_CHANNEL_ID', 'snAuditChannelId');
override('SYSTEM_OWNER_ID', 'systemOwnerId');
override('TRUSTED_SERVER_STAFF_ROLE', 'trustedServerStaffRole');
override('HIGH_STAFF_ROLE', 'highStaffRole');
override('DASHBOARD', 'dashboard', parseBoolean);
override('DASHBOARD_PORT', 'dashboardPort', (value) => Number(value) || config.dashboardPort);
override('DASHBOARD_PASSWORD', 'dashboardPassword');
override('BOT_NAME', 'botName');
override('BACKUP_ENABLED', 'backupEnabled', parseBoolean);
override('BACKUP_DIRECTORY', 'backupDirectory');
override('BACKUP_RETENTION', 'backupRetention', (value) => Number(value) || config.backupRetention);

typeof config.dashboardPort === 'number' || (config.dashboardPort = Number(config.dashboardPort) || 3000);
typeof config.backupEnabled === 'boolean' || (config.backupEnabled = parseBoolean(config.backupEnabled));
config.backupDirectory = config.backupDirectory || 'backups';
config.backupRetention = Number(config.backupRetention) || 10;

module.exports = config;
