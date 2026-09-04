/**
 * DATABASE MODULE v3
 * Multi-server, file-based JSON persistence.
 * Supports profiles, cases, logs, blacklist, per-server config.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// ─── Generic I/O ─────────────────────────────────────────────────────────────

function loadData(filename) {
  const fp = path.join(DATA_DIR, `${filename}.json`);
  try {
    if (!fs.existsSync(fp)) { fs.writeFileSync(fp, '{}', 'utf8'); return {}; }
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    console.error(`[DB] Load error (${filename}):`, e.message);
    return {};
  }
}

function saveData(filename, data) {
  const fp = path.join(DATA_DIR, `${filename}.json`);
  try {
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[DB] Save error (${filename}):`, e.message);
    return false;
  }
}

// ─── PROFILES ────────────────────────────────────────────────────────────────

function getProfile(userId) {
  const profiles = loadData('profiles');
  return profiles[userId] || null;
}

/**
 * Create a profile for a Discord user.
 * @param {import('discord.js').User} user
 * @param {string} serverId - The server where profile was created
 */
function createProfile(user, serverId) {
  const profiles = loadData('profiles');
  if (profiles[user.id]) return profiles[user.id];

  profiles[user.id] = {
    userId:     user.id,
    username:   user.username,
    riskLevel:  0,          // 0 = none, 1-5 severity scale
    clearance:  1,          // SN clearance level
    notes:      [],         // [{ id, text, addedBy, addedAt, serverId }]
    flags:      [],         // [{ level, reason, addedBy, addedAt, serverId }]
    servers:    serverId ? [serverId] : [],
    watchlisted: false,
    blacklisted: false,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString()
  };

  saveData('profiles', profiles);
  return profiles[user.id];
}

function updateProfile(userId, updates) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;
  profiles[userId] = { ...profiles[userId], ...updates, updatedAt: new Date().toISOString() };
  saveData('profiles', profiles);
  return profiles[userId];
}

function addNote(userId, text, addedBy, serverId) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;

  const noteId = `NOTE-${Date.now()}`;
  profiles[userId].notes.push({ id: noteId, text, addedBy, serverId, addedAt: new Date().toISOString() });
  profiles[userId].updatedAt = new Date().toISOString();
  saveData('profiles', profiles);
  return profiles[userId];
}

function removeNote(userId, noteId) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;

  const before = profiles[userId].notes.length;
  profiles[userId].notes = profiles[userId].notes.filter(n => n.id !== noteId);
  if (profiles[userId].notes.length === before) return { error: 'NOTE_NOT_FOUND' };

  profiles[userId].updatedAt = new Date().toISOString();
  saveData('profiles', profiles);
  return profiles[userId];
}

function addFlag(userId, level, reason, addedBy, serverId) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;

  profiles[userId].flags.push({ level, reason, addedBy, serverId, addedAt: new Date().toISOString() });

  // Auto-escalate risk level
  if (level > (profiles[userId].riskLevel || 0)) {
    profiles[userId].riskLevel = level;
  }

  // Track server
  if (serverId && !profiles[userId].servers.includes(serverId)) {
    profiles[userId].servers.push(serverId);
  }

  profiles[userId].updatedAt = new Date().toISOString();
  saveData('profiles', profiles);
  return profiles[userId];
}

function getAllProfiles() { return loadData('profiles'); }

// Register a server on a profile (for multi-server tracking)
function trackServer(userId, serverId) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return;
  if (!profiles[userId].servers.includes(serverId)) {
    profiles[userId].servers.push(serverId);
    saveData('profiles', profiles);
  }
}

// ─── CASES ───────────────────────────────────────────────────────────────────

function getCase(caseId) {
  const cases = loadData('cases');
  return cases[caseId.toUpperCase()] || null;
}

function getAllCases() { return loadData('cases'); }

function createCase(title, creatorId, serverId) {
  const cases = loadData('cases');
  const ids   = Object.keys(cases);
  const nums  = ids.map(id => parseInt(id.replace('CASE-', ''), 10)).filter(n => !isNaN(n));
  const next  = nums.length ? Math.max(...nums) + 1 : 1;
  const caseId = `CASE-${String(next).padStart(4, '0')}`;

  cases[caseId] = {
    caseId,
    title,
    status:         'OPEN',
    creatorId,
    serverId,
    assignedAgents: [creatorId],
    evidence:       [],
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    closedAt:       null,
    closedBy:       null
  };

  saveData('cases', cases);
  return cases[caseId];
}

function updateCase(caseId, updates) {
  const cases = loadData('cases');
  if (!cases[caseId.toUpperCase()]) return null;
  cases[caseId.toUpperCase()] = { ...cases[caseId.toUpperCase()], ...updates, updatedAt: new Date().toISOString() };
  saveData('cases', cases);
  return cases[caseId.toUpperCase()];
}

function addEvidence(caseId, text, submittedBy) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status === 'CLOSED') return { error: 'CASE_CLOSED' };

  c.evidence.push({ id: `EVD-${Date.now()}`, text, submittedBy, submittedAt: new Date().toISOString() });
  c.status = 'UNDER REVIEW';
  c.updatedAt = new Date().toISOString();
  saveData('cases', cases);
  return c;
}

function assignAgent(caseId, agentId) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status === 'CLOSED') return { error: 'CASE_CLOSED' };
  if (!c.assignedAgents.includes(agentId)) c.assignedAgents.push(agentId);
  c.updatedAt = new Date().toISOString();
  saveData('cases', cases);
  return c;
}

function closeCase(caseId, closedBy) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status === 'CLOSED') return { error: 'ALREADY_CLOSED' };
  c.status   = 'CLOSED';
  c.closedBy = closedBy;
  c.closedAt = new Date().toISOString();
  c.updatedAt = new Date().toISOString();
  saveData('cases', cases);
  return c;
}
function reopenCase(caseId, reopenedBy) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status !== 'CLOSED') return { error: 'NOT_CLOSED' };
  c.status    = 'OPEN';
  c.closedBy  = null;
  c.closedAt  = null;
  c.updatedAt = new Date().toISOString();
  saveData('cases', cases);
  return c;
}
// ─── LOGS ────────────────────────────────────────────────────────────────────

function appendLog(userId, type, detail, serverId) {
  const logs = loadData('logs');
  if (!logs[userId]) logs[userId] = { events: [] };

  logs[userId].events.push({ type, detail, serverId, timestamp: new Date().toISOString() });
  if (logs[userId].events.length > 500) logs[userId].events = logs[userId].events.slice(-500);

  saveData('logs', logs);
}

function getUserLogs(userId, limit = 20) {
  const logs = loadData('logs');
  if (!logs[userId]) return null;
  return {
    totalEvents:  logs[userId].events.length,
    recentEvents: [...logs[userId].events].reverse().slice(0, limit)
  };
}

// ─── BLACKLIST ───────────────────────────────────────────────────────────────

function getBlacklist() { return loadData('blacklist'); }

function addToBlacklist(userId, reason, addedBy) {
  const bl = loadData('blacklist');
  bl[userId] = { userId, reason, addedBy, addedAt: new Date().toISOString() };
  saveData('blacklist', bl);

  // Also mark on profile
  const profiles = loadData('profiles');
  if (profiles[userId]) {
    profiles[userId].blacklisted = true;
    profiles[userId].riskLevel   = 5;
    saveData('profiles', profiles);
  }

  return bl[userId];
}

function removeFromBlacklist(userId) {
  const bl = loadData('blacklist');
  if (!bl[userId]) return false;
  delete bl[userId];
  saveData('blacklist', bl);

  const profiles = loadData('profiles');
  if (profiles[userId]) {
    profiles[userId].blacklisted = false;
    saveData('profiles', profiles);
  }

  return true;
}

function isBlacklisted(userId) {
  const bl = loadData('blacklist');
  return !!bl[userId];
}

// ─── WATCHLIST ───────────────────────────────────────────────────────────────

function addToWatchlist(userId, addedBy, serverId) {
  const logs = loadData('logs');
  if (!logs[userId]) logs[userId] = { events: [] };
  if (logs[userId].watchlisted) return { alreadyWatched: true };

  logs[userId].watchlisted    = true;
  logs[userId].watchlistedAt  = new Date().toISOString();
  logs[userId].watchlistedBy  = addedBy;
  logs[userId].notifyServers  = logs[userId].notifyServers || [];
  saveData('logs', logs);

  const profiles = loadData('profiles');
  if (profiles[userId]) { profiles[userId].watchlisted = true; saveData('profiles', profiles); }

  return { success: true };
}

function removeFromWatchlist(userId) {
  const logs = loadData('logs');
  if (!logs[userId] || !logs[userId].watchlisted) return { notWatched: true };
  logs[userId].watchlisted = false;
  logs[userId].removedAt   = new Date().toISOString();
  saveData('logs', logs);

  const profiles = loadData('profiles');
  if (profiles[userId]) { profiles[userId].watchlisted = false; saveData('profiles', profiles); }
  return { success: true };
}

function isWatched(userId) {
  const logs = loadData('logs');
  return !!(logs[userId] && logs[userId].watchlisted);
}

function enableNotify(userId, serverId) {
  const logs = loadData('logs');
  if (!logs[userId]) logs[userId] = { events: [] };
  if (!logs[userId].notifyServers) logs[userId].notifyServers = [];
  if (!logs[userId].notifyServers.includes(serverId)) {
    logs[userId].notifyServers.push(serverId);
  }
  saveData('logs', logs);
}

function disableNotify(userId, serverId) {
  const logs = loadData('logs');
  if (!logs[userId] || !Array.isArray(logs[userId].notifyServers)) return { notEnabled: true };
  const before = logs[userId].notifyServers.length;
  logs[userId].notifyServers = logs[userId].notifyServers.filter(id => id !== serverId);
  if (logs[userId].notifyServers.length === before) return { notEnabled: true };
  saveData('logs', logs);
  return { success: true };
}

function getWatchlist() {
  const logs = loadData('logs');
  return Object.entries(logs)
    .filter(([, v]) => v.watchlisted)
    .map(([userId, v]) => ({
      userId,
      watchlistedAt: v.watchlistedAt,
      watchlistedBy: v.watchlistedBy,
      eventCount:    (v.events || []).length
    }));
}

// ─── SERVER CONFIG ────────────────────────────────────────────────────────────

function getServerConfig(serverId) {
  const cfg = loadData('serverConfig');
  return cfg[serverId] || null;
}

function setServerConfig(serverId, updates) {
  const cfg = loadData('serverConfig');
  cfg[serverId] = { ...(cfg[serverId] || { serverId }), ...updates };
  saveData('serverConfig', cfg);
  return cfg[serverId];
}

module.exports = {
  loadData, saveData,
  getProfile, createProfile, updateProfile, addNote, removeNote, addFlag, getAllProfiles, trackServer,
  getCase, getAllCases, createCase, updateCase, addEvidence, assignAgent, closeCase, reopenCase,
  appendLog, getUserLogs,
  getBlacklist, addToBlacklist, removeFromBlacklist, isBlacklisted,
  addToWatchlist, removeFromWatchlist, isWatched, enableNotify, disableNotify, getWatchlist,
  getServerConfig, setServerConfig
};
