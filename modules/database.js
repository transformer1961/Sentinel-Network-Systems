/**
 * DATABASE MODULE
 * Core file-based persistence layer for Sentinel Network.
 * All reads/writes go through these functions to keep data access consistent.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// ─── Generic Helpers ────────────────────────────────────────────────────────

/**
 * Load a JSON data file. Returns parsed object, or empty object on failure.
 * @param {string} filename - e.g. 'profiles', 'cases', 'logs'
 */
function loadData(filename) {
  const filePath = path.join(DATA_DIR, `${filename}.json`);
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '{}', 'utf8');
      return {};
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DATABASE] Failed to load ${filename}:`, err.message);
    return {};
  }
}

/**
 * Save data to a JSON file.
 * @param {string} filename - e.g. 'profiles', 'cases', 'logs'
 * @param {object} data - object to serialize
 */
function saveData(filename, data) {
  const filePath = path.join(DATA_DIR, `${filename}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[DATABASE] Failed to save ${filename}:`, err.message);
    return false;
  }
}

// ─── Profile Helpers ────────────────────────────────────────────────────────

/**
 * Retrieve a single profile by Discord user ID. Returns null if not found.
 */
function getProfile(userId) {
  const profiles = loadData('profiles');
  return profiles[userId] || null;
}

/**
 * Create a new profile for a Discord user.
 * @param {import('discord.js').User} user - Discord User object
 * @returns {object} The newly created profile
 */
function createProfile(user) {
  const profiles = loadData('profiles');

  if (profiles[user.id]) {
    return profiles[user.id]; // Already exists, return existing
  }

  const profile = {
    userId: user.id,
    username: user.username,
    discriminator: user.discriminator || '0',
    riskLevel: 'NONE',         // NONE | LOW | MEDIUM | HIGH | CRITICAL
    clearance: 1,              // Default clearance level
    notes: [],
    flags: [],
    watchlisted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  profiles[user.id] = profile;
  saveData('profiles', profiles);
  return profile;
}

/**
 * Update fields on an existing profile. Returns updated profile or null.
 */
function updateProfile(userId, updates) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;

  profiles[userId] = {
    ...profiles[userId],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveData('profiles', profiles);
  return profiles[userId];
}

/**
 * Add a note to a profile.
 */
function addNoteToProfile(userId, note) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;

  profiles[userId].notes.push({
    text: note,
    addedAt: new Date().toISOString()
  });
  profiles[userId].updatedAt = new Date().toISOString();

  saveData('profiles', profiles);
  return profiles[userId];
}

/**
 * Add a flag to a profile.
 */
function addFlagToProfile(userId, level, reason) {
  const profiles = loadData('profiles');
  if (!profiles[userId]) return null;

  profiles[userId].flags.push({
    level,
    reason,
    addedAt: new Date().toISOString()
  });

  // Auto-update risk level based on flag severity
  const flagLevels = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const currentRisk = flagLevels[profiles[userId].riskLevel] || 0;
  const newRisk = flagLevels[level] || 0;
  if (newRisk > currentRisk) {
    profiles[userId].riskLevel = level;
  }

  profiles[userId].updatedAt = new Date().toISOString();
  saveData('profiles', profiles);
  return profiles[userId];
}

/**
 * Get all profiles (for audit purposes).
 */
function getAllProfiles() {
  return loadData('profiles');
}

module.exports = {
  loadData,
  saveData,
  getProfile,
  createProfile,
  updateProfile,
  addNoteToProfile,
  addFlagToProfile,
  getAllProfiles
};
