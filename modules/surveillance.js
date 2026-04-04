/**
 * SURVEILLANCE MODULE
 * Manages watchlist, event logging, and log retrieval.
 */

const { loadData, saveData, getProfile, updateProfile } = require('./database');

/**
 * Add a user to the watchlist.
 * @param {string} userId
 * @param {string} addedBy - Agent who added them
 * @returns {{ success: boolean, alreadyWatched?: boolean }}
 */
function addToWatchlist(userId, addedBy) {
  const logs = loadData('logs');

  if (!logs[userId]) {
    logs[userId] = { events: [], watchlistedAt: null, watchlistedBy: null };
  }

  if (logs[userId].watchlisted) {
    return { success: false, alreadyWatched: true };
  }

  logs[userId].watchlisted = true;
  logs[userId].watchlistedAt = new Date().toISOString();
  logs[userId].watchlistedBy = addedBy;

  // Also mark in profile
  updateProfile(userId, { watchlisted: true });

  saveData('logs', logs);
  return { success: true };
}

/**
 * Remove a user from the watchlist.
 */
function removeFromWatchlist(userId) {
  const logs = loadData('logs');

  if (!logs[userId] || !logs[userId].watchlisted) {
    return { success: false, notWatched: true };
  }

  logs[userId].watchlisted = false;
  logs[userId].removedAt = new Date().toISOString();

  updateProfile(userId, { watchlisted: false });
  saveData('logs', logs);
  return { success: true };
}

/**
 * Check if a user is on the watchlist.
 */
function isWatched(userId) {
  const logs = loadData('logs');
  return !!(logs[userId] && logs[userId].watchlisted);
}

/**
 * Append a log event for a user.
 * @param {string} userId
 * @param {string} type - e.g. 'MESSAGE', 'JOIN', 'LEAVE', 'MANUAL'
 * @param {string} detail - Human-readable detail
 */
function logEvent(userId, type, detail) {
  const logs = loadData('logs');

  if (!logs[userId]) {
    logs[userId] = { watchlisted: false, events: [] };
  }

  logs[userId].events.push({
    type,
    detail,
    timestamp: new Date().toISOString()
  });

  // Keep last 500 events per user to prevent unbounded growth
  if (logs[userId].events.length > 500) {
    logs[userId].events = logs[userId].events.slice(-500);
  }

  saveData('logs', logs);
}

/**
 * Get all log events for a user.
 * @param {string} userId
 * @param {number} limit - Max events to return (most recent first)
 */
function getUserLogs(userId, limit = 20) {
  const logs = loadData('logs');
  if (!logs[userId]) return null;

  const entry = logs[userId];
  const recentEvents = [...(entry.events || [])].reverse().slice(0, limit);

  return {
    watchlisted: entry.watchlisted || false,
    watchlistedAt: entry.watchlistedAt || null,
    watchlistedBy: entry.watchlistedBy || null,
    totalEvents: entry.events.length,
    recentEvents
  };
}

/**
 * Get the full watchlist (all currently watched users).
 */
function getWatchlist() {
  const logs = loadData('logs');
  return Object.entries(logs)
    .filter(([, entry]) => entry.watchlisted)
    .map(([userId, entry]) => ({
      userId,
      watchlistedAt: entry.watchlistedAt,
      watchlistedBy: entry.watchlistedBy,
      eventCount: (entry.events || []).length
    }));
}

module.exports = {
  addToWatchlist,
  removeFromWatchlist,
  isWatched,
  logEvent,
  getUserLogs,
  getWatchlist
};
