/**
 * INVESTIGATION MODULE
 * Handles case creation, evidence tracking, and case lifecycle.
 */

const { loadData, saveData } = require('./database');

/**
 * Generate next sequential case ID in CASE-XXXX format.
 */
function generateCaseId() {
  const cases = loadData('cases');
  const ids = Object.keys(cases);

  if (ids.length === 0) return 'CASE-0001';

  // Extract numeric parts and find max
  const nums = ids
    .map(id => parseInt(id.replace('CASE-', ''), 10))
    .filter(n => !isNaN(n));

  const next = Math.max(...nums) + 1;
  return `CASE-${String(next).padStart(4, '0')}`;
}

/**
 * Open a new investigation case.
 * @param {string} title - Case title
 * @param {string} creatorId - Discord user ID of the agent opening the case
 * @returns {object} The new case object
 */
function openCase(title, creatorId) {
  const cases = loadData('cases');
  const caseId = generateCaseId();

  const newCase = {
    caseId,
    title,
    status: 'OPEN',                      // OPEN | UNDER REVIEW | CLOSED
    creatorId,
    assignedAgents: [creatorId],         // Creator auto-assigned
    evidence: [],
    notes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null
  };

  cases[caseId] = newCase;
  saveData('cases', cases);
  return newCase;
}

/**
 * Retrieve a case by ID. Returns null if not found.
 */
function getCase(caseId) {
  const cases = loadData('cases');
  return cases[caseId.toUpperCase()] || null;
}

/**
 * Get all cases.
 */
function getAllCases() {
  return loadData('cases');
}

/**
 * Get cases by status filter.
 */
function getCasesByStatus(status) {
  const cases = loadData('cases');
  return Object.values(cases).filter(c => c.status === status.toUpperCase());
}

/**
 * Add evidence to an existing case.
 * @param {string} caseId
 * @param {string} text - Evidence description
 * @param {string} submitterId - Who submitted it
 * @returns {object|null} Updated case or null if not found
 */
function addEvidence(caseId, text, submitterId) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status === 'CLOSED') return { error: 'CASE_CLOSED' };

  c.evidence.push({
    evidenceId: `EVD-${Date.now()}`,
    text,
    submittedBy: submitterId,
    submittedAt: new Date().toISOString()
  });

  c.status = 'UNDER REVIEW';
  c.updatedAt = new Date().toISOString();
  cases[caseId.toUpperCase()] = c;
  saveData('cases', cases);
  return c;
}

/**
 * Assign an agent to a case.
 */
function assignAgent(caseId, agentId) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status === 'CLOSED') return { error: 'CASE_CLOSED' };

  if (!c.assignedAgents.includes(agentId)) {
    c.assignedAgents.push(agentId);
  }

  c.updatedAt = new Date().toISOString();
  cases[caseId.toUpperCase()] = c;
  saveData('cases', cases);
  return c;
}

/**
 * Close a case.
 */
function closeCase(caseId, closedBy) {
  const cases = loadData('cases');
  const c = cases[caseId.toUpperCase()];
  if (!c) return null;
  if (c.status === 'CLOSED') return { error: 'ALREADY_CLOSED' };

  c.status = 'CLOSED';
  c.closedBy = closedBy;
  c.closedAt = new Date().toISOString();
  c.updatedAt = new Date().toISOString();

  cases[caseId.toUpperCase()] = c;
  saveData('cases', cases);
  return c;
}

module.exports = {
  generateCaseId,
  openCase,
  getCase,
  getAllCases,
  getCasesByStatus,
  addEvidence,
  assignAgent,
  closeCase
};
