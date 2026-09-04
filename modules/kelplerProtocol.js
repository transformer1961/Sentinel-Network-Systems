const logger = require('./logger');
const { loadData, saveData } = require('./database');
const config = require('./config');

const FILE = 'kelplerState';

const KEPLER_PHASES = {
  ALERT: 'I-Alert',
  ISOLATION: 'II-Isolation',
  CONTAINMENT: 'III-Containment',
  LOCKDOWN: 'IV-Lockdown',
  PRESERVATION: 'V-Preservation',
  VERIFICATION: 'VI-Verification',
  RECOVERY: 'VII-Recovery',
  STANDDOWN: 'VIII-Stand Down'
};

const PHASE_ORDER = [
  'I-Alert',
  'II-Isolation',
  'III-Containment',
  'IV-Lockdown',
  'V-Preservation',
  'VI-Verification',
  'VII-Recovery',
  'VIII-Stand Down'
];

function loadKelplerState() {
  return loadData(FILE);
}

function saveKelplerState(data) {
  saveData(FILE, data);
}

function ensureKelplerEntry() {
  const state = loadKelplerState();
  if (!state.status) {
    state.status = {
      active: false,
      phase: null,
      activatedAt: null,
      activatedBy: null,
      activatedById: null,
      activationReason: null,
      deactivatedAt: null,
      deactivatedBy: null,
      deactivationReason: null,
      authorizedBy: null,
      authorizedById: null,
      snapshots: [],
      incidents: [],
      restrictions: {
        dashboardDisabled: false,
        hqAccessRestricted: false,
        commandsFrozen: false,
        configLocked: false,
        synchronizationSuspended: false
      }
    };
    saveKelplerState(state);
  }
  return state;
}

function getKelplerStatus() {
  const state = loadKelplerState();
  return state.status || null;
}

function isKelplerActive() {
  const status = getKelplerStatus();
  return status && status.active === true;
}

function getCurrentPhase() {
  const status = getKelplerStatus();
  return status ? status.phase : null;
}

function getPhaseIndex(phase) {
  return PHASE_ORDER.indexOf(phase);
}

function getNextPhase(currentPhase) {
  const index = getPhaseIndex(currentPhase);
  if (index === -1 || index >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[index + 1];
}

function getPreviousPhase(currentPhase) {
  const index = getPhaseIndex(currentPhase);
  if (index <= 0) return null;
  return PHASE_ORDER[index - 1];
}

function activateKepler(activatedBy, activatedById, reason) {
  const state = ensureKelplerEntry();

  state.status.active = true;
  state.status.phase = KEPLER_PHASES.ALERT;
  state.status.activatedAt = new Date().toISOString();
  state.status.activatedBy = activatedBy;
  state.status.activatedById = activatedById;
  state.status.activationReason = reason;
  state.status.deactivatedAt = null;
  state.status.deactivatedBy = null;
  state.status.deactivationReason = null;

  state.status.restrictions = {
    dashboardDisabled: false,
    hqAccessRestricted: false,
    commandsFrozen: false,
    configLocked: false,
    synchronizationSuspended: false
  };

  saveKelplerState(state);

  logger.info('KEPLER', `Kepler Protocol ACTIVATED by ${activatedBy} (${activatedById}): ${reason}`, {
    timestamp: new Date().toISOString(),
    activatedBy,
    activatedById,
    reason
  });

  return state.status;
}

function deactivateKepler(deactivatedBy, deactivatedById, reason, authorizedBy, authorizedById) {
  const state = ensureKelplerEntry();

  state.status.active = false;
  state.status.phase = KEPLER_PHASES.STANDDOWN;
  state.status.deactivatedAt = new Date().toISOString();
  state.status.deactivatedBy = deactivatedBy;
  state.status.deactivationReason = reason;
  state.status.authorizedBy = authorizedBy;
  state.status.authorizedById = authorizedById;

  state.status.restrictions = {
    dashboardDisabled: false,
    hqAccessRestricted: false,
    commandsFrozen: false,
    configLocked: false,
    synchronizationSuspended: false
  };

  saveKelplerState(state);

  logger.info('KEPLER', `Kepler Protocol DEACTIVATED by ${deactivatedBy} (${deactivatedById}): ${reason}`, {
    timestamp: new Date().toISOString(),
    deactivatedBy,
    deactivatedById,
    authorizedBy,
    authorizedById,
    reason
  });

  return state.status;
}

function advancePhase(targetPhase, approvedBy, approvedById) {
  const state = ensureKelplerEntry();

  if (!isKelplerActive()) {
    return { success: false, error: 'Kepler Protocol is not active' };
  }

  const currentIndex = getPhaseIndex(state.status.phase);
  const targetIndex = getPhaseIndex(targetPhase);

  if (targetIndex === -1) {
    return { success: false, error: 'Invalid phase' };
  }

  if (targetIndex <= currentIndex) {
    return { success: false, error: 'Can only advance to later phases' };
  }

  const previousPhase = state.status.phase;
  state.status.phase = targetPhase;

  if (targetPhase === KEPLER_PHASES.LOCKDOWN) {
    state.status.restrictions.dashboardDisabled = true;
    state.status.restrictions.hqAccessRestricted = true;
    state.status.restrictions.commandsFrozen = true;
    state.status.restrictions.configLocked = true;
  }

  if (targetPhase === KEPLER_PHASES.PRESERVATION) {
    state.status.restrictions.synchronizationSuspended = true;
  }

  if (targetPhase === KEPLER_PHASES.RECOVERY || targetPhase === KEPLER_PHASES.STANDDOWN) {
    state.status.restrictions.dashboardDisabled = false;
    state.status.restrictions.hqAccessRestricted = false;
    state.status.restrictions.commandsFrozen = false;
    state.status.restrictions.configLocked = false;
    state.status.restrictions.synchronizationSuspended = false;
  }

  saveKelplerState(state);

  logger.info('KEPLER', `Phase advanced from ${previousPhase} to ${targetPhase} by ${approvedBy}`, {
    timestamp: new Date().toISOString(),
    previousPhase,
    targetPhase,
    approvedBy,
    approvedById
  });

  return { success: true, newPhase: targetPhase, previousPhase };
}

function createSnapshot(createdBy, createdById, label) {
  const state = ensureKelplerEntry();

  const snapshot = {
    id: `SNAPSHOT-${Date.now()}`,
    createdAt: new Date().toISOString(),
    createdBy,
    createdById,
    label,
    phase: state.status.phase,
    timestamp: new Date().toISOString()
  };

  if (!state.status.snapshots) {
    state.status.snapshots = [];
  }

  state.status.snapshots.push(snapshot);
  saveKelplerState(state);

  logger.info('KEPLER', `Forensic snapshot created: ${snapshot.id} by ${createdBy}`, {
    timestamp: new Date().toISOString(),
    snapshotId: snapshot.id,
    label,
    createdBy,
    createdById
  });

  return snapshot;
}

function recordIncident(tlcCode, serverId, description, recordedBy, recordedById) {
  const state = ensureKelplerEntry();

  const incident = {
    id: `INC-${Date.now()}`,
    recordedAt: new Date().toISOString(),
    tlcCode,
    serverId,
    description,
    recordedBy,
    recordedById
  };

  if (!state.status.incidents) {
    state.status.incidents = [];
  }

  state.status.incidents.push(incident);
  saveKelplerState(state);

  return incident;
}

function checkAutoActivationConditions() {
  // Returns indicators for automatic activation
  // This would be called by other modules when critical events occur
  return {
    botTokenCompromised: false,
    multipleHQCompromise: false,
    coreIntegrityFailure: false,
    criticalConfigTampering: false,
    multipleTLCKIncidents: false,
    catastrophicInfrastructureFailure: false,
    widespreadMultiServerCompromise: false
  };
}

module.exports = {
  // State
  loadKelplerState,
  saveKelplerState,
  ensureKelplerEntry,
  getKelplerStatus,
  isKelplerActive,
  getCurrentPhase,

  // Phase management
  KEPLER_PHASES,
  PHASE_ORDER,
  getPhaseIndex,
  getNextPhase,
  getPreviousPhase,
  advancePhase,

  // Operations
  activateKepler,
  deactivateKepler,
  createSnapshot,
  recordIncident,
  checkAutoActivationConditions
};
