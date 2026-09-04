/**
 * SERVER BLACKLIST MODULE
 *
 * Manages the blacklist of Discord servers flagged by Sentinel HQ.
 *
 * Schema per entry:
 * {
 *   serverId:     string   — Discord guild ID
 *   serverName:   string   — Name at time of blacklisting
 *   reason:       string   — Why it was blacklisted
 *   addedBy:      string   — Username of staff who added it
 *   addedById:    string   — User ID of staff who added it
 *   addedAt:      ISO8601
 *   memberCount:  number   — Member count at time of blacklisting
 *   ownerId:      string   — Guild owner ID at time of blacklisting
 *   status:       'ACTIVE' | 'APPEALING' | 'LIFTED'
 *   appealNotes:  string[] — Notes added during appeal process
 *   liftedAt:     ISO8601 | null
 *   liftedBy:     string | null
 *   liftReason:   string | null
 * }
 */

const { loadData, saveData } = require('./database');
const logger = require('./logger');

const FILE = 'serverBlacklist';

// ─── Read ─────────────────────────────────────────────────────────────────────

function getServerBlacklist() {
  return loadData(FILE);
}

function getBlacklistedServer(serverId) {
  const bl = loadData(FILE);
  return bl[serverId] || null;
}

/**
 * Check if a server is actively blacklisted.
 * Only ACTIVE and APPEALING count as restricted — LIFTED does not.
 */
function isServerBlacklisted(serverId) {
  const entry = getBlacklistedServer(serverId);
  return !!(entry && entry.status !== 'LIFTED');
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Add a server to the blacklist.
 * @param {object} opts
 * @param {string} opts.serverId
 * @param {string} opts.serverName
 * @param {string} opts.reason
 * @param {string} opts.addedBy       — username
 * @param {string} opts.addedById     — user ID
 * @param {number} opts.memberCount
 * @param {string} opts.ownerId
 */
function blacklistServer({ serverId, serverName, reason, addedBy, addedById, memberCount, ownerId }) {
  const bl = loadData(FILE);

  if (bl[serverId] && bl[serverId].status !== 'LIFTED') {
    return { error: 'ALREADY_BLACKLISTED', entry: bl[serverId] };
  }

  bl[serverId] = {
    serverId,
    serverName:  serverName || 'Unknown',
    reason,
    addedBy,
    addedById,
    addedAt:     new Date().toISOString(),
    memberCount: memberCount || 0,
    ownerId:     ownerId || 'Unknown',
    status:      'ACTIVE',
    appealNotes: [],
    liftedAt:    null,
    liftedBy:    null,
    liftReason:  null
  };

  saveData(FILE, bl);
  logger.event('serverBlacklist', `Server blacklisted: ${serverName} (${serverId}) by ${addedBy}`);
  return { success: true, entry: bl[serverId] };
}

/**
 * Remove a server from the blacklist (lift restriction).
 */
function liftServerBlacklist(serverId, liftedBy, liftReason) {
  const bl = loadData(FILE);

  if (!bl[serverId]) return { error: 'NOT_FOUND' };
  if (bl[serverId].status === 'LIFTED') return { error: 'ALREADY_LIFTED' };

  bl[serverId].status     = 'LIFTED';
  bl[serverId].liftedAt   = new Date().toISOString();
  bl[serverId].liftedBy   = liftedBy;
  bl[serverId].liftReason = liftReason || 'No reason provided';

  saveData(FILE, bl);
  logger.event('serverBlacklist', `Server blacklist lifted: ${serverId} by ${liftedBy}`);
  return { success: true, entry: bl[serverId] };
}

/**
 * Append an appeal note to a blacklisted server entry.
 */
function addAppealNote(serverId, note, addedBy) {
  const bl = loadData(FILE);
  if (!bl[serverId]) return { error: 'NOT_FOUND' };

  bl[serverId].appealNotes.push({
    note,
    addedBy,
    addedAt: new Date().toISOString()
  });

  if (bl[serverId].status === 'ACTIVE') {
    bl[serverId].status = 'APPEALING';
  }

  saveData(FILE, bl);
  logger.event('serverBlacklist', `Appeal note added to ${serverId} by ${addedBy}`);
  return { success: true, entry: bl[serverId] };
}

/**
 * Update server name / member count when we see an interaction from that server.
 * Keeps the record fresh without requiring manual updates.
 */
function refreshServerMeta(serverId, serverName, memberCount, ownerId) {
  const bl = loadData(FILE);
  if (!bl[serverId]) return;

  let changed = false;
  if (serverName  && bl[serverId].serverName  !== serverName)  { bl[serverId].serverName  = serverName;  changed = true; }
  if (memberCount && bl[serverId].memberCount  !== memberCount) { bl[serverId].memberCount = memberCount; changed = true; }
  if (ownerId     && bl[serverId].ownerId      !== ownerId)     { bl[serverId].ownerId     = ownerId;     changed = true; }

  if (changed) saveData(FILE, bl);
}

// ─── Query helpers ────────────────────────────────────────────────────────────

function getActiveBlacklist() {
  const bl = loadData(FILE);
  return Object.values(bl).filter(e => e.status !== 'LIFTED');
}

function getAllServerBlacklist() {
  return Object.values(loadData(FILE));
}

module.exports = {
  getServerBlacklist,
  getBlacklistedServer,
  isServerBlacklisted,
  blacklistServer,
  liftServerBlacklist,
  addAppealNote,
  refreshServerMeta,
  getActiveBlacklist,
  getAllServerBlacklist
};
