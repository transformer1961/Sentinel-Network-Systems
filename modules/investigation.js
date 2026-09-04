/**
 * INVESTIGATION MODULE
 * Re-exports case functions from database for backward compatibility.
 * Investigation logic is fully integrated in database.js v3.
 */

const db = require('./database');

module.exports = {
  openCase:    (title, creatorId, serverId) => db.createCase(title, creatorId, serverId),
  getCase:     db.getCase,
  getAllCases: db.getAllCases,
  addEvidence: db.addEvidence,
  assignAgent: db.assignAgent,
  closeCase:   db.closeCase
};
