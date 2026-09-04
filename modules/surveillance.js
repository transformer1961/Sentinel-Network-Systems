/**
 * SURVEILLANCE MODULE
 * Re-exports watchlist/log functions from database.js for compatibility.
 */

const db = require('./database');

module.exports = {
  addToWatchlist:      db.addToWatchlist,
  removeFromWatchlist: db.removeFromWatchlist,
  isWatched:           db.isWatched,
  enableNotify:        db.enableNotify,
  getWatchlist:        db.getWatchlist,
  appendLog:           db.appendLog,
  getUserLogs:         db.getUserLogs
};
