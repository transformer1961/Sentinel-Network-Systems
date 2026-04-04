/**
 * SENTINEL NETWORK — Main Entry Point v2
 * New: auto-profile on join, dashboard, audit logging, watched message alerts,
 *      rate limiting, all new command groups auto-loaded.
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  EmbedBuilder,
  Events
} = require('discord.js');

const token = process.env.TOKEN;
const fs   = require('fs');
const path = require('path');

const config  = require('./config.json');
const surv    = require('./modules/surveillance');
const db      = require('./modules/database');
const alerts  = require('./modules/alerts');

// ─── Client Setup ────────────────────────────────────────────────────────────

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

// ─── Command Loader ───────────────────────────────────────────────────────────

function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFolders = fs.readdirSync(commandsPath);
  const commandData = [];

  for (const folder of commandFolders) {
    const cmdPath = path.join(commandsPath, folder, 'index.js');
    if (!fs.existsSync(cmdPath)) continue;

    try {
      // Clear require cache so hot-reload works if needed
      delete require.cache[require.resolve(cmdPath)];
      const command = require(cmdPath);

      if (!command.data || !command.execute) {
        console.warn(`[LOADER] Skipping ${folder}: missing data or execute.`);
        continue;
      }

      client.commands.set(command.data.name, command);
      commandData.push(command.data.toJSON());
      console.log(`[LOADER] ✓ /${command.data.name}`);
    } catch (err) {
      console.error(`[LOADER] ✗ ${folder}:`, err.message);
    }
  }

  return commandData;
}

// ─── Slash Command Registration ───────────────────────────────────────────────

async function registerCommands(commandData) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log(`[REGISTRY] Registering ${commandData.length} command(s)...`);
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commandData }
    );
    console.log('[REGISTRY] ✓ All commands registered.');
  } catch (err) {
    console.error('[REGISTRY] ✗ Failed:', err.message);
  }
}

// ─── Interaction Handler ──────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Fire audit log (non-blocking)
  const sub = interaction.options.getSubcommand(false);
  alerts.auditLog(client, interaction, sub).catch(() => {});

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[CMD] Error in /${interaction.commandName}:`, err);

    const errEmbed = new EmbedBuilder()
      .setColor(config.dangerColor)
      .setTitle(`${config.botName} // SYSTEM ERROR`)
      .setDescription(`\`\`\`\n[ INTERNAL FAILURE ]\n> ${err.message || 'Unknown error'}\n\`\`\``)
      .setTimestamp();

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [errEmbed], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
    } catch { /* interaction may have expired */ }
  }
});

// ─── Passive Surveillance Listeners ──────────────────────────────────────────

// Log and alert on watched user messages
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!surv.isWatched(message.author.id)) return;

  const preview = message.content.substring(0, 80) || '[no text content]';
  const channelName = message.channel.name || 'unknown';

  surv.logEvent(message.author.id, 'MESSAGE', `#${channelName}: ${preview}`);
  await alerts.alertWatchedMessage(client, message.author.id, message.author.username, channelName, preview);
});

// Auto-create profile and log join for all new members
client.on(Events.GuildMemberAdd, async member => {
  // Auto-create profile
  if (!db.getProfile(member.id)) {
    db.createProfile(member.user);
    await alerts.alertNewMember(client, member);
  }

  // Log if watched
  if (surv.isWatched(member.id)) {
    surv.logEvent(member.id, 'JOIN', `Joined server: ${member.guild.name}`);
    console.log(`[SURVEILLANCE] Watched user joined: ${member.user.username}`);
  }
});

// Log leaves for watched users
client.on(Events.GuildMemberRemove, member => {
  if (!surv.isWatched(member.id)) return;
  surv.logEvent(member.id, 'LEAVE', `Left server: ${member.guild.name}`);
  console.log(`[SURVEILLANCE] Watched user left: ${member.user.username}`);
});

// ─── Ready Event ──────────────────────────────────────────────────────────────

client.once(Events.ClientReady, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       SENTINEL NETWORK v2.0 ONLINE           ║');
  console.log(`║  Bot   : ${client.user.tag.padEnd(35)}║`);
  console.log(`║  Guild : ${config.guildId.padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  if (config.logChannelId)   console.log(`[ALERTS] Log channel  : ${config.logChannelId}`);
  if (config.auditChannelId) console.log(`[ALERTS] Audit channel: ${config.auditChannelId}`);

  client.user.setActivity('Monitoring subjects...', { type: 3 }); // WATCHING
});

// ─── Boot Sequence ────────────────────────────────────────────────────────────

(async () => {
  // Start web dashboard if enabled
  if (config.dashboard) {
    try {
      const { startDashboard } = require('./dashboard/server');
      startDashboard();
    } catch (err) {
      console.warn('[DASHBOARD] Could not start:', err.message);
    }
  }

  const commandData = loadCommands();
  await registerCommands(commandData);
  await client.login(token);
})().catch(err => {
  console.error('[BOOT] Fatal error:', err);
  process.exit(1);
});
