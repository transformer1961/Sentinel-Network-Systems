/**
 * DATABASE INITIALIZATION SCRIPT
 * Run once before starting the bot for the first time, or after updates.
 * 
 * Usage:
 *   node scripts/initDB.js
 *   node scripts/initDB.js --reset   (WARNING: clears all data)
 * 
 * Ensures all required JSON data files exist with correct schema.
 * Migrates old schema fields to new ones without data loss.
 * Reports any issues found.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const LOG_DIR  = path.join(__dirname, '../logs');

const RESET = process.argv.includes('--reset');

// ─── Colour helpers ───────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const W = s => `\x1b[1m${s}\x1b[0m`;

// ─── Required data file schemas ───────────────────────────────────────────────
const SCHEMAS = {
  profiles: {
    description: 'Subject profiles — one entry per Discord user',
    example: {
      userId:      'STRING  — Discord user ID',
      username:    'STRING  — Discord username',
      riskLevel:   'NUMBER  — 0–5 severity scale',
      clearance:   'NUMBER  — SN clearance level 1–6',
      notes:       'ARRAY   — [{ id, text, addedBy, serverId, addedAt }]',
      flags:       'ARRAY   — [{ level, reason, addedBy, serverId, addedAt }]',
      servers:     'ARRAY   — server IDs where subject was seen',
      watchlisted: 'BOOLEAN',
      blacklisted: 'BOOLEAN',
      createdAt:   'ISO8601 date string',
      updatedAt:   'ISO8601 date string'
    }
  },
  cases: {
    description: 'Investigation cases',
    example: {
      caseId:         'STRING  — e.g. CASE-0001',
      title:          'STRING',
      status:         'STRING  — OPEN | UNDER REVIEW | CLOSED',
      creatorId:      'STRING  — Discord user ID',
      serverId:       'STRING  — originating server',
      assignedAgents: 'ARRAY   — Discord user IDs',
      evidence:       'ARRAY   — [{ id, text, submittedBy, submittedAt }]',
      createdAt:      'ISO8601',
      updatedAt:      'ISO8601',
      closedAt:       'ISO8601 | null',
      closedBy:       'STRING | null'
    }
  },
  logs: {
    description: 'Per-user surveillance logs',
    example: {
      '[userId]': {
        watchlisted:   'BOOLEAN',
        watchlistedAt: 'ISO8601 | null',
        watchlistedBy: 'STRING | null',
        notifyServers: 'ARRAY — server IDs opted in for join notifications',
        events:        'ARRAY — [{ type, detail, serverId, timestamp }] (max 500)'
      }
    }
  },
  blacklist: {
    description: 'Global blacklist — persists across all servers',
    example: {
      '[userId]': {
        userId:   'STRING',
        reason:   'STRING',
        addedBy:  'STRING',
        addedAt:  'ISO8601'
      }
    }
  },
  serverBlacklist: {
    description: 'Blacklisted Discord servers — restricts sensitive commands',
    example: {
      '[serverId]': {
        serverId:    'STRING  — Discord guild ID',
        serverName:  'STRING  — Name at time of blacklisting',
        reason:      'STRING  — Why it was blacklisted',
        addedBy:     'STRING  — Username',
        addedById:   'STRING  — User ID',
        addedAt:     'ISO8601',
        memberCount: 'NUMBER',
        ownerId:     'STRING',
        status:      'STRING  — ACTIVE | APPEALING | LIFTED',
        appealNotes: 'ARRAY   — [{ note, addedBy, addedAt }]',
        liftedAt:    'ISO8601 | null',
        liftedBy:    'STRING | null',
        liftReason:  'STRING | null'
      }
    }
  },
  serverConfig: {
    description: 'Per-server configuration',
    example: {
      '[serverId]': {
        serverId:       'STRING',
        serverName:     'STRING',
        alertChannelId: 'STRING | null — where join alerts are posted',
        setupBy:        'STRING',
        setupAt:        'ISO8601'
      }
    }
  },
  serverSecurity: {
    description: 'Server threat and lockdown state',
    example: {
      '[serverId]': {
        serverId: 'STRING',
        lockdown: {
          active: false,
          level: 'SOFT',
          type: 'LOCAL',
          reason: 'STRING',
          triggeredBy: 'STRING',
          triggeredById: 'STRING',
          triggeredAt: 'ISO8601',
          clearedAt: 'ISO8601 | null',
          clearedBy: 'STRING | null',
          clearedReason: 'STRING | null'
        },
        tls: {
          local: {
            level: 'GREEN',
            tcl: 'TLC-A | null',
            reason: 'STRING',
            setBy: 'STRING',
            setById: 'STRING',
            setAt: 'ISO8601'
          },
          hq: {
            level: 'GREEN',
            tcl: 'TLC-A | null',
            reason: 'STRING',
            setBy: 'STRING',
            setById: 'STRING',
            setAt: 'ISO8601'
          }
        }
      }
    }
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function load(file) {
  const fp = path.join(DATA_DIR, `${file}.json`);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function save(file, data) {
  const fp = path.join(DATA_DIR, `${file}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

function backup(file) {
  const src  = path.join(DATA_DIR, `${file}.json`);
  const dest = path.join(DATA_DIR, `${file}.backup-${Date.now()}.json`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return dest;
  }
  return null;
}

// ─── Main Init ────────────────────────────────────────────────────────────────
async function init() {
  console.log('');
  console.log(W('╔══════════════════════════════════════════════╗'));
  console.log(W('║   SENTINEL NETWORK — DATABASE INIT SCRIPT    ║'));
  console.log(W('╚══════════════════════════════════════════════╝'));
  console.log('');

  // Ensure directories
  [DATA_DIR, LOG_DIR, path.join(__dirname, '../logs')].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(G(`  ✓ Created directory: ${dir}`));
    }
  });

  if (RESET) {
    console.log(R('\n  ⚠️  RESET MODE — All data files will be cleared!\n'));
    const confirm = await new Promise(res => {
      process.stdout.write('  Type YES to confirm: ');
      process.stdin.once('data', d => res(d.toString().trim()));
    });
    if (confirm !== 'YES') { console.log(Y('  Cancelled.')); process.exit(0); }
  }

  console.log(B('\n  ── Checking data files ──────────────────────────\n'));

  let totalIssues = 0;
  let migrations  = 0;

  for (const [file, schema] of Object.entries(SCHEMAS)) {
    const fp = path.join(DATA_DIR, `${file}.json`);
    process.stdout.write(`  ${file}.json ... `);

    if (RESET) {
      save(file, {});
      console.log(Y('RESET'));
      continue;
    }

    if (!fs.existsSync(fp)) {
      save(file, {});
      console.log(G('CREATED (empty)'));
      continue;
    }

    const data = load(file);
    if (data === null) {
      console.log(R('CORRUPT — backing up and resetting'));
      backup(file);
      save(file, {});
      totalIssues++;
      continue;
    }

    // ── Profile-specific migration ──
    if (file === 'profiles') {
      let migrated = 0;
      for (const [uid, profile] of Object.entries(data)) {
        let changed = false;

        // Migrate old string riskLevel to numeric
        if (typeof profile.riskLevel === 'string') {
          const map = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4, EXTREME: 5 };
          profile.riskLevel = map[profile.riskLevel] ?? 0;
          changed = true;
        }

        // Ensure required fields exist
        if (!Array.isArray(profile.notes))     { profile.notes = [];     changed = true; }
        if (!Array.isArray(profile.flags))     { profile.flags = [];     changed = true; }
        if (!Array.isArray(profile.servers))   { profile.servers = [];   changed = true; }
        if (profile.clearance === undefined)   { profile.clearance = 1;  changed = true; }
        if (profile.watchlisted === undefined) { profile.watchlisted = false; changed = true; }
        if (profile.blacklisted === undefined) { profile.blacklisted = false; changed = true; }
        if (!profile.updatedAt)               { profile.updatedAt = profile.createdAt || new Date().toISOString(); changed = true; }

        // Migrate old note format (plain strings → objects)
        if (profile.notes.length && typeof profile.notes[0] === 'string') {
          profile.notes = profile.notes.map((n, i) => ({
            id: `NOTE-MIGRATED-${i}`, text: n,
            addedBy: 'migration', serverId: null,
            addedAt: profile.createdAt || new Date().toISOString()
          }));
          changed = true;
        }

        if (changed) { data[uid] = profile; migrated++; }
      }

      if (migrated > 0) {
        backup(file);
        save(file, data);
        console.log(G(`OK`) + Y(` (${migrated} profiles migrated)`));
        migrations += migrated;
      } else {
        console.log(G(`OK (${Object.keys(data).length} profiles)`));
      }
      continue;
    }

    // ── Case-specific migration ──
    if (file === 'cases') {
      let migrated = 0;
      for (const [cid, c] of Object.entries(data)) {
        let changed = false;
        if (!Array.isArray(c.assignedAgents)) { c.assignedAgents = []; changed = true; }
        if (!Array.isArray(c.evidence))       { c.evidence = [];       changed = true; }
        if (!c.serverId)                      { c.serverId = null;      changed = true; }
        if (!c.updatedAt)                     { c.updatedAt = c.createdAt; changed = true; }
        if (changed) { data[cid] = c; migrated++; }
      }
      if (migrated > 0) { backup(file); save(file, data); console.log(G('OK') + Y(` (${migrated} cases migrated)`)); migrations += migrated; }
      else console.log(G(`OK (${Object.keys(data).length} cases)`));
      continue;
    }

    // ── Logs migration ──
    if (file === 'logs') {
      let migrated = 0;
      for (const [uid, log] of Object.entries(data)) {
        let changed = false;
        if (!Array.isArray(log.events))         { log.events = [];        changed = true; }
        if (!Array.isArray(log.notifyServers))  { log.notifyServers = []; changed = true; }
        // Trim oversized logs
        if (log.events.length > 500) {
          log.events = log.events.slice(-500);
          changed = true;
        }
        if (changed) { data[uid] = log; migrated++; }
      }
      if (migrated > 0) { backup(file); save(file, data); console.log(G('OK') + Y(` (${migrated} logs migrated)`)); migrations += migrated; }
      else console.log(G(`OK (${Object.keys(data).length} log entries)`));
      continue;
    }

    // ── Generic files (blacklist, serverConfig) ──
    console.log(G(`OK (${Object.keys(data).length} entries)`));
  }

  // ── Config check ──
  console.log(B('\n  ── Checking config.json ─────────────────────────\n'));
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.log(R('  ✗ config.json missing! Copy and fill in config.json before starting.'));
    totalIssues++;
  } else {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const required = ['token', 'clientId', 'snServerId', 'systemOwnerId'];
    const missing  = required.filter(k => !cfg[k] || cfg[k].startsWith('YOUR_'));
    if (missing.length) {
      console.log(Y(`  ⚠️  config.json has unfilled fields: ${missing.join(', ')}`));
      console.log(Y('      Fill these in before starting the bot.'));
    } else {
      console.log(G('  ✓ config.json looks complete'));
    }

    // Warn about missing optional fields
    const optional = ['snAlertChannelId', 'snAuditChannelId', 'dashboardPassword'];
    const missingOpt = optional.filter(k => !cfg[k]);
    if (missingOpt.length) {
      console.log(Y(`  ℹ  Optional fields not set: ${missingOpt.join(', ')}`));
    }
  }

  // ── Summary ──
  console.log('');
  console.log(W('  ── Summary ──────────────────────────────────────'));
  console.log(G(`  ✓ Data files: ${Object.keys(SCHEMAS).length} checked`));
  if (migrations > 0) console.log(Y(`  ↑ Migrations applied: ${migrations}`));
  if (totalIssues > 0) console.log(R(`  ✗ Issues found: ${totalIssues}`));
  else console.log(G('  ✓ No issues found'));
  console.log('');
  console.log(G('  Database is ready. Run: node index.js'));
  console.log('');

  process.exit(0);
}

init().catch(e => {
  console.error(R('FATAL:'), e);
  process.exit(1);
});
