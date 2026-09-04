// SENTINEL NETWORK - Main Entry Point v3.2
// Clean modular architecture:
//   Commands: /commands/[group]/index.js
//   Events:   /events/[name].js
//   All listeners registered dynamically
//   Dashboard started if config.dashboard is true

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes
} = require('discord.js');

const fs     = require('fs');
const path   = require('path');
const config = require('./modules/config');
const logger = require('./modules/logger');
const backup = require('./modules/backup');

function isPlaceholder(value) {
  return typeof value === 'string' && (
    value.trim() === '' ||
    /YOUR_[A-Z_]+/.test(value) ||
    /BOT_TOKEN_HERE/i.test(value) ||
    /CLIENT_ID_HERE/i.test(value) ||
    /DISCORD_USER_ID/i.test(value)
  );
}

function isWeakPassword(value) {
  const weak = ['sentinel', 'admin', 'password', 'changeme', '123456', '12345678'];
  return !value || weak.includes(String(value).toLowerCase());
}

// ─── Environment Validation ────────────────────────────────────────────────────

function validateEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // Check production requirements
  if (isProduction) {
    logger.info('boot', '🚀 PRODUCTION MODE DETECTED - Enforcing strict requirements');
    
    if (!process.env.DISCORD_TOKEN) {
      errors.push('DISCORD_TOKEN not set in production');
    }
    
    if (!config.dashboardPassword || isWeakPassword(config.dashboardPassword)) {
      errors.push('DASHBOARD_PASSWORD must be strong (16+ chars) in production');
    }

    if (process.env.NODE_ENV !== 'production') {
      warnings.push('NODE_ENV should be set to "production"');
    }
  }

  // Check required config
  const requiredConfig = {
    token: 'DISCORD_TOKEN',
    clientId: 'CLIENT_ID',
    snServerId: 'SN_SERVER_ID',
    snAlertChannelId: 'SN_ALERT_CHANNEL_ID',
    snAuditChannelId: 'SN_AUDIT_CHANNEL_ID',
    systemOwnerId: 'SYSTEM_OWNER_ID'
  };

  for (const [key, envName] of Object.entries(requiredConfig)) {
    if (isPlaceholder(config[key]) || !config[key]) {
      errors.push(`Missing/invalid ${envName} (config.${key})`);
    }
  }

  if (errors.length > 0) {
    logger.critical('boot', '❌ Configuration validation failed:');
    errors.forEach(err => logger.critical('boot', `  - ${err}`));
    return false;
  }

  if (warnings.length > 0) {
    logger.warn('boot', '⚠️ Configuration warnings:');
    warnings.forEach(warn => logger.warn('boot', `  - ${warn}`));
  }

  return true;
}

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.commands = new Collection();

// ─── Load Commands ────────────────────────────────────────────────────────────

function loadCommands() {
  const cmdRoot = path.join(__dirname, 'commands');
  const folders = fs.readdirSync(cmdRoot);
  const data    = [];

  for (const folder of folders) {
    const fp = path.join(cmdRoot, folder, 'index.js');
    if (!fs.existsSync(fp)) continue;

    try {
      delete require.cache[require.resolve(fp)];
      const cmd = require(fp);

      if (!cmd.data || !cmd.execute) {
        logger.warn('loader', `Skipping ${folder}: missing data or execute`);
        continue;
      }

      client.commands.set(cmd.data.name, cmd);
      data.push(cmd.data.toJSON());
      logger.info('loader', `Loaded command: /${cmd.data.name}`);
    } catch (err) {
      logger.error('loader', `Failed to load command: ${folder}`, err);
    }
  }

  return data;
}

// ─── Load Events ──────────────────────────────────────────────────────────────

function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');
  const files      = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      delete require.cache[require.resolve(path.join(eventsPath, file))];
      const event = require(path.join(eventsPath, file));

      if (!event.name || !event.execute) {
        logger.warn('loader', `Skipping event ${file}: missing name or execute`);
        continue;
      }

      // Pass client as second argument to all event handlers
      const handler = (...args) => event.execute(...args, client);

      if (event.once) {
        client.once(event.name, handler);
      } else {
        client.on(event.name, handler);
      }

      logger.info('loader', `Loaded event: ${event.name}`);
    } catch (err) {
      logger.error('loader', `Failed to load event: ${file}`, err);
    }
  }
}

// ─── Register Slash Commands with Discord ─────────────────────────────────────

async function registerCommands(cmdData) {
  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    logger.info('registry', `Registering ${cmdData.length} command(s) globally...`);
    await rest.put(Routes.applicationCommands(config.clientId), { body: cmdData });
    logger.info('registry', 'Commands registered globally (up to 1 hour to propagate to all servers)');
  } catch (err) {
    logger.warn('registry', 'Global registration failed — trying guild fallback', err);

    if (config.snServerId) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(config.clientId, config.snServerId),
          { body: cmdData }
        );
        logger.info('registry', 'Commands registered to SN guild (instant, fallback mode)');
      } catch (err2) {
        logger.error('registry', 'Guild registration also failed', err2);
      }
    }
  }
}

// ─── Global Error Handlers ────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled promise rejection',
    reason instanceof Error ? reason : new Error(String(reason))
  );
});

process.on('uncaughtException', (err) => {
  logger.critical('process', 'Uncaught exception — bot may be unstable', err);
});

// ─── Boot Sequence ────────────────────────────────────────────────────────────

(async () => {
  logger.info('boot', '🚀 Starting Sentinel Network...');
  logger.info('boot', `Environment: ${process.env.NODE_ENV || 'development'}`);

  // Validate environment and config
  if (!validateEnvironment()) {
    process.exit(1);
  }

  // Final dashboard password check
  if (config.dashboard && isWeakPassword(config.dashboardPassword)) {
    logger.warn('boot', '⚠️  Dashboard enabled with weak password. In production, set DASHBOARD_PASSWORD to strong value (16+ chars).');
    if (process.env.NODE_ENV === 'production') {
      logger.critical('boot', '🔴 Refusing to start dashboard in production with weak password.');
      process.exit(1);
    }
  }

  // Backup on startup
  if (config.backupEnabled) {
    try {
      await backup.backupAllData();
    } catch (err) {
      logger.warn('boot', 'Automatic backup failed', err);
    }
  }

  // 1. Start web dashboard (non-blocking)
  if (config.dashboard) {
    try {
      const { startDashboard } = require('./dashboard/server');
      startDashboard();
      logger.info('boot', '✅ Dashboard server started');
    } catch (err) {
      logger.error('boot', '❌ Dashboard failed to start', err);
      if (process.env.NODE_ENV === 'production') {
        logger.critical('boot', 'Dashboard is critical in production - exiting');
        process.exit(1);
      }
    }
  }

  // 2. Load all command groups from /commands/
  const cmdData = loadCommands();
  logger.info('boot', `${cmdData.length} command group(s) loaded`);

  // 3. Load all event handlers from /events/
  loadEvents();

  // 4. Register slash commands with Discord API
  await registerCommands(cmdData);

  // 5. Connect to Discord
  logger.info('boot', 'Connecting to Discord...');
  await client.login(config.token);

})().catch(err => {
  logger.critical('boot', 'Fatal startup error', err);
  process.exit(1);
});
