const logger = require('./logger');
const { loadData, saveData } = require('./database');
const config = require('./config');
const serverBlacklist = require('./serverBlacklist');

/**
 * SERVER SECURITY MODULE v4.0
 * 
 * Manages per-server security state:
 * - Lockdown (SOFT, MEDIUM, HARD, TOTAL) — LOCAL or HQ scope
 * - Threat Levels (GREEN, BLUE, YELLOW, ORANGE, RED, BLACK) — per scope
 * - Threat Level Classes (TLC-A through TLC-K) — incident classification
 * 
 * NOTE: Kepler Protocol is a GLOBAL system-wide emergency response.
 * It is independent of server lockdowns and threat levels.
 * See modules/kelplerProtocol.js for Kepler management.
 */

const FILE = 'serverSecurity';
const VALID_TLS = ['GREEN', 'BLUE', 'YELLOW', 'ORANGE', 'RED', 'BLACK'];
const VALID_LOCKDOWN = ['SOFT', 'MEDIUM', 'HARD', 'TOTAL'];
const VALID_TLC = ['TLC-A', 'TLC-B', 'TLC-C', 'TLC-D', 'TLC-E', 'TLC-F', 'TLC-K'];

function loadSecurityData() {
  return loadData(FILE);
}

function saveSecurityData(data) {
  saveData(FILE, data);
}

function ensureSecurityEntry(serverId) {
  const all = loadSecurityData();
  if (!all[serverId]) {
    all[serverId] = {
      serverId,
      lockdown: {
        active: false,
        level: 'SOFT',
        type: 'LOCAL',
        reason: null,
        triggeredBy: null,
        triggeredById: null,
        triggeredAt: null,
        clearedAt: null,
        clearedBy: null,
        clearedReason: null
      },
      tls: {
        local: {
          level: 'GREEN',
          tcl: null,
          reason: null,
          setBy: null,
          setById: null,
          setAt: null
        },
        hq: {
          level: 'GREEN',
          tcl: null,
          reason: null,
          setBy: null,
          setById: null,
          setAt: null
        }
      }
    };
    saveSecurityData(all);
  }
  return all[serverId];
}

function getServerSecurity(serverId) {
  const all = loadSecurityData();
  return all[serverId] || null;
}

function getLockdown(serverId) {
  const entry = getServerSecurity(serverId);
  return entry ? entry.lockdown : null;
}

function getLocalTLS(serverId) {
  const entry = getServerSecurity(serverId);
  return entry ? entry.tls.local : null;
}

function getHQTLS(serverId) {
  const entry = getServerSecurity(serverId);
  return entry ? entry.tls.hq : null;
}

function getThreatLevelRank(level) {
  return VALID_TLS.indexOf(level);
}

function getLockdownRank(level) {
  return VALID_LOCKDOWN.indexOf(level);
}

function normalizeTLSLevel(level) {
  if (!level) return 'GREEN';
  const normalized = String(level).toUpperCase();
  return VALID_TLS.includes(normalized) ? normalized : 'GREEN';
}

function normalizeTLC(tcl) {
  if (!tcl) return null;
  const raw = String(tcl).trim().toUpperCase();
  const normalized = raw.startsWith('TLC-') ? raw : `TLC-${raw}`;
  return VALID_TLC.includes(normalized) ? normalized : null;
}

function normalizeLockdownLevel(level) {
  if (!level) return 'SOFT';
  const normalized = String(level).toUpperCase();
  return VALID_LOCKDOWN.includes(normalized) ? normalized : 'SOFT';
}

function buildDefaultSecurityState(serverId) {
  return ensureSecurityEntry(serverId);
}

function setLockdown(serverId, { level, type, reason, triggeredBy, triggeredById }) {
  const entry = ensureSecurityEntry(serverId);
  const normalized = normalizeLockdownLevel(level);

  entry.lockdown = {
    active: true,
    level: normalized,
    type: type || 'LOCAL',
    reason: reason || 'No reason provided',
    triggeredBy: triggeredBy || 'Unknown',
    triggeredById: triggeredById || 'Unknown',
    triggeredAt: new Date().toISOString(),
    clearedAt: null,
    clearedBy: null,
    clearedReason: null
  };

  const all = loadSecurityData();
  all[serverId] = entry;
  saveSecurityData(all);
  logger.event('serverSecurity', `Lockdown set on ${serverId}: ${normalized} (${entry.lockdown.type})`);
  return entry.lockdown;
}

function clearLockdown(serverId, clearedBy, reason) {
  const entry = ensureSecurityEntry(serverId);
  if (!entry.lockdown.active) return { error: 'NO_LOCKDOWN' };

  entry.lockdown.active = false;
  entry.lockdown.clearedAt = new Date().toISOString();
  entry.lockdown.clearedBy = clearedBy || 'Unknown';
  entry.lockdown.clearedReason = reason || 'No reason provided';

  const all = loadSecurityData();
  all[serverId] = entry;
  saveSecurityData(all);
  logger.event('serverSecurity', `Lockdown cleared on ${serverId} by ${clearedBy}`);
  return { success: true, entry: entry.lockdown };
}

function setTLS(serverId, scope, level, tcl, reason, setBy, setById) {
  const entry = ensureSecurityEntry(serverId);
  const normalized = normalizeTLSLevel(level);
  const scopeKey = scope === 'hq' ? 'hq' : 'local';
  const normalizedTLC = normalizeTLC(tcl) || entry.tls[scopeKey].tcl || null;

  entry.tls[scopeKey] = {
    level: normalized,
    tcl: normalizedTLC,
    reason: reason || 'No reason provided',
    setBy: setBy || 'Unknown',
    setById: setById || 'Unknown',
    setAt: new Date().toISOString()
  };

  const all = loadSecurityData();
  all[serverId] = entry;
  saveSecurityData(all);
  logger.event('serverSecurity', `${scopeKey.toUpperCase()} TLS set on ${serverId}: ${normalized}${normalizedTLC ? ` ${normalizedTLC}` : ''}`);

  if (normalized === 'RED' || normalized === 'BLACK') {
    applyThreatLevelAutomation(serverId, scopeKey, normalized);
  }
  if (normalized === 'BLACK') {
    autoBlacklistForBlackTL(serverId, scopeKey, reason, setBy, setById);
  }

  return entry.tls[scopeKey];
}

function setLocalTLS(serverId, level, tcl, reason, setBy, setById) {
  return setTLS(serverId, 'local', level, tcl, reason, setBy, setById);
}

function setHQTLS(serverId, level, tcl, reason, setBy, setById) {
  return setTLS(serverId, 'hq', level, tcl, reason, setBy, setById);
}

function autoBlacklistForBlackTL(serverId, scope, reason, setBy, setById) {
  const blacklistReason = `Automatic blacklist due to ${scope.toUpperCase()} threat level BLACK: ${reason}`;
  const lockReason = `Auto-lockdown TOTAL from ${scope.toUpperCase()} BLACK threat level`;

  if (!serverBlacklist.isServerBlacklisted(serverId)) {
    serverBlacklist.blacklistServer({
      serverId,
      serverName: `Unknown (auto-blacklist)`,
      reason: blacklistReason,
      addedBy: setBy || 'System',
      addedById: setById || 'System',
      memberCount: 0,
      ownerId: 'Unknown'
    });
  }

  setLockdown(serverId, {
    level: 'TOTAL',
    type: 'AUTO',
    reason: lockReason,
    triggeredBy: setBy || 'System',
    triggeredById: setById || 'System'
  });
}

function applyThreatLevelAutomation(serverId, scope, level) {
  const entry = ensureSecurityEntry(serverId);
  const effective = getEffectiveTLS(serverId);

  if (effective === 'RED') {
    const currentLockdown = getEffectiveLockdown(serverId);
    if (getLockdownRank(currentLockdown.level) < getLockdownRank('HARD')) {
      setLockdown(serverId, {
        level: 'HARD',
        type: scope === 'hq' ? 'HQ' : 'LOCAL',
        reason: `Automatic HARD lockdown triggered by ${scope.toUpperCase()} RED threat level`,
        triggeredBy: entry.tls[scope].setBy,
        triggeredById: entry.tls[scope].setById
      });
    }
  }

  if (effective === 'BLACK' && !serverBlacklist.isServerBlacklisted(serverId)) {
    autoBlacklistForBlackTL(serverId, scope, entry.tls[scope].reason, entry.tls[scope].setBy, entry.tls[scope].setById);
  }
}

function getEffectiveTLS(serverId) {
  const entry = ensureSecurityEntry(serverId);
  const hqLevel = entry.tls.hq.level || 'GREEN';
  if (getThreatLevelRank(hqLevel) > 0) return hqLevel;
  return entry.tls.local.level || 'GREEN';
}

function getEffectiveLockdown(serverId) {
  const entry        = ensureSecurityEntry(serverId);
  const manual       = entry.lockdown.active ? entry.lockdown : null;
  const effectiveTLS = getEffectiveTLS(serverId);
  const isBlacklisted = serverBlacklist.isServerBlacklisted(serverId);

  if (isBlacklisted) {
    return {
      active: true,
      level: 'MEDIUM',
      type: 'BLACKLIST',
      reason: 'Server is blacklisted by Sentinel Network HQ',
      source: 'BLACKLIST'
    };
  }

  if (effectiveTLS === 'BLACK') {
    return {
      active: true,
      level: 'TOTAL',
      type: 'AUTO',
      reason: 'BLACK threat level forces TOTAL lockdown',
      source: 'TLS'
    };
  }

  if (effectiveTLS === 'RED') {
    return {
      active: true,
      level: 'HARD',
      type: 'AUTO',
      reason: 'RED threat level enforces HARD lockdown',
      source: 'TLS'
    };
  }

  if (manual) {
    return {
      active: true,
      level: manual.level,
      type: manual.type,
      reason: manual.reason,
      triggeredBy: manual.triggeredBy,
      triggeredById: manual.triggeredById,
      triggeredAt: manual.triggeredAt,
      source: 'MANUAL'
    };
  }

  if (effectiveTLS === 'ORANGE') {
    return {
      active: true,
      level: 'SOFT',
      type: 'AUTO',
      reason: 'ORANGE threat level triggers SOFT lockdown monitoring',
      source: 'TLS'
    };
  }

  return {
    active: false,
    level: 'NONE',
    type: null,
    reason: null,
    source: null
  };
}

function getSecurityState(serverId) {
  const entry = ensureSecurityEntry(serverId);
  return {
    serverId,
    lockdown: entry.lockdown,
    tls: entry.tls,
    effectiveTLS: getEffectiveTLS(serverId),
    effectiveLockdown: getEffectiveLockdown(serverId)
  };
}

function getAllSecurityStates() {
  return Object.values(loadSecurityData());
}

module.exports = {
  VALID_TLS,
  VALID_TLC,
  normalizeTLC,
  VALID_LOCKDOWN,
  getServerSecurity,
  getLockdown,
  getLocalTLS,
  getHQTLS,
  getEffectiveTLS,
  getEffectiveLockdown,
  getSecurityState,
  getAllSecurityStates,
  setLockdown,
  clearLockdown,
  setLocalTLS,
  setHQTLS,
  setTLS
};
