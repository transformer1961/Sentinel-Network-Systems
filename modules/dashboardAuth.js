/**
 * DASHBOARD AUTHENTICATION MODULE
 * Handles rate limiting, session persistence, and security enforcement
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./database');
const crypto = require('crypto');

const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// ─── FILE PROTECTION GUIDANCE ────────────────────────────────────────────────
// IMPORTANT: Restrict access to data/sessions.json file:
// - Only the bot account should have read/write access
// - Remove 'Everyone' permissions in Windows Security properties
// - Optional: Enable Windows file encryption via Properties → Advanced → "Encrypt contents"
// - Keep OS updated and restrict ports/firewall for server security
// - Back up session/data files regularly

// ─── In-memory rate limiter (IP-based) ────────────────────────────────────────
const loginAttempts = new Map(); // { ip: [timestamp, timestamp, ...] }
const lockedIPs = new Map();     // { ip: lockoutUntil }

/**
 * Check if IP is rate-limited
 * @param {string} ip - Client IP address
 * @returns {boolean} - true if locked out, false if allowed
 */
function isRateLimited(ip) {
  // Check if in active lockout
  if (lockedIPs.has(ip)) {
    const lockoutUntil = lockedIPs.get(ip);
    if (Date.now() < lockoutUntil) {
      return true; // Still locked out
    } else {
      lockedIPs.delete(ip);
      loginAttempts.delete(ip);
      return false; // Lockout expired
    }
  }

  // Check attempt count in time window
  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, []);
  }

  const attempts = loginAttempts.get(ip);
  const now = Date.now();
  const recentAttempts = attempts.filter(t => now - t < LOGIN_ATTEMPT_WINDOW);

  if (recentAttempts.length >= MAX_ATTEMPTS) {
    // Lock this IP
    lockedIPs.set(ip, now + LOCKOUT_DURATION);
    loginAttempts.set(ip, []);
    return true;
  }

  return false;
}

/**
 * Record a failed login attempt
 * @param {string} ip - Client IP address
 */
function recordFailedAttempt(ip) {
  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, []);
  }
  loginAttempts.get(ip).push(Date.now());
}

/**
 * Clear failed attempts for IP (on successful login)
 * @param {string} ip - Client IP address
 */
function clearAttempts(ip) {
  loginAttempts.delete(ip);
  lockedIPs.delete(ip);
}

// ─── Session Management ───────────────────────────────────────────────────────

/**
 * Load sessions from persistent storage
 * @returns {Object} - { token: { createdAt, expiresAt, userId }, ... }
 */
function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      return {};
    }
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    
    // Prune expired sessions
    const valid = {};
    for (const [token, session] of Object.entries(data)) {
      if (session.expiresAt && now < session.expiresAt) {
        valid[token] = session;
      }
    }
    
    return valid;
  } catch (e) {
    console.error('[DASHBOARD AUTH] Failed to load sessions:', e.message);
    return {};
  }
}

/**
 * Save sessions to persistent storage
 * @param {Object} sessions - Sessions object
 */
function saveSessions(sessions) {
  try {
    const dataDir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[DASHBOARD AUTH] Failed to save sessions:', e.message);
  }
}

/**
 * Get current session statistics and file integrity status.
 * @returns {Object}
 */
function getSessionStats() {
  const status = {
    healthy: true,
    fileExists: false,
    activeSessions: 0,
    lastUpdated: new Date().toISOString(),
    message: 'OK'
  };

  try {
    status.fileExists = fs.existsSync(SESSIONS_FILE);
    if (!status.fileExists) {
      status.message = 'Session file missing';
      return status;
    }

    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const now = Date.now();
    const active = Object.entries(parsed || {}).filter(([, session]) => session.expiresAt && now < session.expiresAt);

    status.activeSessions = active.length;
    status.healthy = true;
  } catch (e) {
    status.healthy = false;
    status.message = `Session store error: ${e.message}`;
  }

  return status;
}

/**
 * Generate a secure session token
 * @returns {string} - 64-character hex token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session
 * @param {string} userId - Discord user ID (optional for password-only auth)
 * @returns {string} - Session token
 */
function createSession(userId = null) {
  const sessions = loadSessions();
  const token = generateToken();
  const now = Date.now();

  sessions[token] = {
    createdAt: new Date().toISOString(),
    expiresAt: now + SESSION_TTL,
    userId: userId || null,
    lastActivity: now
  };

  saveSessions(sessions);
  return token;
}

/**
 * Verify session token is valid
 * @param {string} token - Session token from cookie
 * @returns {Object|null} - Session object if valid, null if expired/invalid
 */
function verifySession(token) {
  if (!token) return null;

  const sessions = loadSessions();
  const session = sessions[token];

  if (!session) return null;
  
  const now = Date.now();
  if (session.expiresAt && now >= session.expiresAt) {
    // Session expired, remove it
    delete sessions[token];
    saveSessions(sessions);
    return null;
  }

  // Update last activity
  session.lastActivity = now;
  saveSessions(sessions);

  return session;
}

/**
 * Delete a session
 * @param {string} token - Session token to delete
 */
function deleteSession(token) {
  const sessions = loadSessions();
  if (sessions[token]) {
    delete sessions[token];
    saveSessions(sessions);
  }
}

/**
 * Delete all sessions (for emergencies)
 */
function deleteAllSessions() {
  saveSessions({});
}

/**
 * Get user's clearance level from their Discord ID
 * @param {string} userId - Discord user ID
 * @returns {number} - Clearance level (1-6), or 1 if not found
 */
function getUserClearance(userId) {
  if (!userId) return 1;
  
  try {
    const profile = db.getProfile(userId);
    if (profile && profile.clearance) {
      return profile.clearance;
    }
  } catch (e) {
    console.error('[DASHBOARD AUTH] Failed to get user clearance:', e.message);
  }
  
  return 1; // Default clearance
}

/**
 * Check if user has required clearance for dashboard access
 * @param {string} userId - Discord user ID
 * @param {number} requiredLevel - Minimum clearance required (default 4 for Operations Lead)
 * @returns {boolean}
 */
function hasAccessLevel(userId, requiredLevel = 4) {
  const clearance = getUserClearance(userId);
  return clearance >= requiredLevel;
}

/**
 * Extract client IP from request (handles proxies)
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string} - Client IP address
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.socket.remoteAddress ||
         'unknown';
}

/**
 * Extract session token from request cookies
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string|null} - Token or null
 */
function getSessionToken(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .find(c => c.trim().startsWith('sn_token='));
  
  if (!cookie) return null;
  return cookie.trim().replace('sn_token=', '');
}

/**
 * Check if request has valid authentication
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {boolean}
 */
function isAuthenticated(req) {
  const token = getSessionToken(req);
  return verifySession(token) !== null;
}

module.exports = {
  isRateLimited,
  recordFailedAttempt,
  clearAttempts,
  loadSessions,
  saveSessions,
  getSessionStats,
  generateToken,
  createSession,
  verifySession,
  deleteSession,
  deleteAllSessions,
  getUserClearance,
  hasAccessLevel,
  getClientIP,
  getSessionToken,
  isAuthenticated,
  SESSION_TTL,
  MAX_ATTEMPTS,
  LOCKOUT_DURATION
};
