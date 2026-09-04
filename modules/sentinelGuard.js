/**
 * SENTINEL GUARD MODULE
 * 
 * Advanced server protection system with:
 * - Threat detection and prevention
 * - Raid protection
 * - Permission management
 * - Security policies
 * - Alert system
 * - Website/control panel integration
 * 
 * Version: 4.0 (Website-Integrated)
 */

const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const logger = require('./logger');
const config = require('./config');
const alerts = require('./alerts');

// ─────────────────────────────────────────────────────────────────────
// THREAT DETECTION & ANALYSIS
// ─────────────────────────────────────────────────────────────────────

const threats = new Map(); // serverId → { threatLevel, threats: [], lastUpdate }
const raidDetection = new Map(); // serverId → { joinCount, timeWindow, suspects: [] }
const suspiciousActivity = new Map(); // userId → { actions: [], score, timestamp }

class SentinelGuard {
  /**
   * Initialize guard for a server
   */
  static initializeServer(serverId) {
    if (!threats.has(serverId)) {
      threats.set(serverId, {
        serverId,
        threatLevel: 'low', // low, medium, high, critical
        threats: [],
        protectionEnabled: true,
        autoProtect: true,
        lockdownActive: false,
        lastUpdate: new Date(),
        policies: {
          raidThreshold: 5, // users/minute triggers raid alert
          suspiciousJoinThreshold: 3, // suspicious joins in 5min
          maxFailedLogins: 5,
          requireVerification: false,
          verificationLevel: 1, // 0=none, 1=email, 2=phone, 3=id
        }
      });

      raidDetection.set(serverId, {
        joinCount: 0,
        leaveCount: 0,
        timeWindow: Date.now(),
        suspects: [],
        flagged: false
      });

      logger.info('guard', `🛡️ Sentinel Guard initialized for server: ${serverId}`);
      db.setServerSecurityLevel(serverId, 'medium');
    }
  }

  /**
   * Analyze user for suspicious behavior
   */
  static analyzeUserThreat(userId, action, context = {}) {
    if (!suspiciousActivity.has(userId)) {
      suspiciousActivity.set(userId, {
        userId,
        actions: [],
        score: 0,
        flagged: false,
        timestamp: Date.now()
      });
    }

    const userThreat = suspiciousActivity.get(userId);
    const threatValue = this.getThreatValue(action);

    userThreat.actions.push({
      action,
      score: threatValue,
      context,
      timestamp: Date.now()
    });

    userThreat.score += threatValue;

    // Clean old actions (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    userThreat.actions = userThreat.actions.filter(a => a.timestamp > oneHourAgo);
    userThreat.score = userThreat.actions.reduce((sum, a) => sum + a.score, 0);

    if (userThreat.score >= 50) {
      userThreat.flagged = true;
      return { threat: 'high', score: userThreat.score, flagged: true };
    }

    return { threat: userThreat.score > 25 ? 'medium' : 'low', score: userThreat.score };
  }

  /**
   * Get threat score for specific action
   */
  static getThreatValue(action) {
    const threatScores = {
      // Suspicious account behavior
      'new_account': 10,
      'no_avatar': 5,
      'suspicious_username': 8,
      'failed_verification': 15,

      // Raid-related
      'mass_joins': 20,
      'mass_joins_same_time': 25,
      'mass_message_spam': 15,
      'mention_spam': 12,

      // Security violations
      'permission_escalation_attempt': 30,
      'unauthorized_command': 10,
      'failed_auth_attempt': 5,
      'data_access_attempt': 20,

      // Policy violations
      'policy_violation': 8,
      'repeated_warnings': 5,
      'blacklist_bypass_attempt': 25
    };

    return threatScores[action] || 0;
  }

  /**
   * Detect raid in progress
   */
  static detectRaid(serverId, userId, eventType = 'join') {
    this.initializeServer(serverId);

    const raid = raidDetection.get(serverId);
    const now = Date.now();

    // Reset if time window passed (1 minute)
    if (now - raid.timeWindow > 60000) {
      raid.joinCount = 0;
      raid.leaveCount = 0;
      raid.suspects = [];
      raid.flagged = false;
      raid.timeWindow = now;
    }

    if (eventType === 'join') {
      raid.joinCount++;
      raid.suspects.push({ userId, timestamp: now });

      const threat = threats.get(serverId);
      const threshold = threat.policies.raidThreshold;

      if (raid.joinCount >= threshold) {
        raid.flagged = true;
        return {
          detected: true,
          type: 'raid',
          severity: raid.joinCount > threshold * 2 ? 'critical' : 'high',
          joinCount: raid.joinCount,
          suspects: raid.suspects
        };
      }
    }

    return { detected: false };
  }

  /**
   * Get current threat level for server
   */
  static getThreatLevel(serverId) {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    return threat.threatLevel;
  }

  /**
   * Set threat level and trigger actions
   */
  static setThreatLevel(serverId, level, reason = '') {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    const oldLevel = threat.threatLevel;
    threat.threatLevel = level;
    threat.lastUpdate = new Date();

    const levelOrder = ['low', 'medium', 'high', 'critical'];
    const escalated = levelOrder.indexOf(level) > levelOrder.indexOf(oldLevel);

    if (escalated) {
      logger.warn('guard', `🚨 Server ${serverId} threat escalated: ${oldLevel} → ${level} (${reason})`);
      this.triggerProtectionActions(serverId, level, reason);
    }

    db.setServerSecurityLevel(serverId, level);
    return { oldLevel, newLevel: level, escalated };
  }

  /**
   * Trigger automatic protection actions based on threat level
   */
  static async triggerProtectionActions(serverId, threatLevel, reason) {
    const threat = threats.get(serverId);
    if (!threat.autoProtect) return;

    const actions = {
      low: [],
      medium: [
        { action: 'monitor', description: 'Increase monitoring' },
        { action: 'warn_staff', description: 'Alert staff to suspicious activity' }
      ],
      high: [
        { action: 'warn_staff', description: 'Alert staff to potential threat' },
        { action: 'restrict_new_members', description: 'Require verification for new users' },
        { action: 'disable_commands', description: 'Disable public commands' }
      ],
      critical: [
        { action: 'lockdown', description: 'Activate emergency lockdown' },
        { action: 'restrict_all', description: 'Restrict all non-staff access' },
        { action: 'alert_hq', description: 'Alert HQ immediately' },
        { action: 'archive_logs', description: 'Archive all activity logs' }
      ]
    };

    const toExecute = actions[threatLevel] || [];
    threat.threats.push({
      type: 'threat_escalation',
      level: threatLevel,
      reason,
      actions: toExecute,
      timestamp: new Date(),
      status: 'active'
    });

    return toExecute;
  }

  /**
   * Apply security policy to server
   */
  static updatePolicy(serverId, policyName, value) {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);

    if (threat.policies.hasOwnProperty(policyName)) {
      threat.policies[policyName] = value;
      logger.info('guard', `✓ Policy updated for ${serverId}: ${policyName} = ${value}`);
      return true;
    }
    return false;
  }

  /**
   * Get server security report
   */
  static getSecurityReport(serverId) {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    const raid = raidDetection.get(serverId);

    // Calculate stats
    const activeSuspicions = Array.from(suspiciousActivity.values())
      .filter(u => u.flagged && u.actions.some(a => a.context.serverId === serverId))
      .length;

    const recentThreats = threat.threats.filter(t => {
      const diff = Date.now() - new Date(t.timestamp).getTime();
      return diff < 3600000; // Last hour
    });

    return {
      serverId,
      threatLevel: threat.threatLevel,
      protectionEnabled: threat.protectionEnabled,
      lockdownActive: threat.lockdownActive,
      policies: threat.policies,
      stats: {
        totalThreats: threat.threats.length,
        recentThreats: recentThreats.length,
        flaggedUsers: activeSuspicions,
        raidDetected: raid.flagged,
        raidJoinCount: raid.joinCount
      },
      lastUpdate: threat.lastUpdate
    };
  }

  /**
   * Generate detailed security report for website
   */
  static generateDetailedReport(serverId) {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    const raid = raidDetection.get(serverId);

    return {
      summary: this.getSecurityReport(serverId),
      details: {
        threats: threat.threats.slice(-20), // Last 20 threats
        raidData: raid,
        suspiciousUsers: Array.from(suspiciousActivity.values())
          .filter(u => u.score > 10)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
      }
    };
  }

  /**
   * Enable/Disable protection for server
   */
  static toggleProtection(serverId, enabled) {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    threat.protectionEnabled = enabled;
    logger.info('guard', `${enabled ? '✓' : '✗'} Protection ${enabled ? 'enabled' : 'disabled'} for ${serverId}`);
    return threat.protectionEnabled;
  }

  /**
   * Activate emergency lockdown
   */
  static activateLockdown(serverId, duration = 3600000) { // 1 hour default
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    threat.lockdownActive = true;
    threat.threatLevel = 'critical';

    const lockdownEnd = Date.now() + duration;
    threat.lockdownEnd = lockdownEnd;

    logger.critical('guard', `🔐 LOCKDOWN ACTIVATED for ${serverId} - Duration: ${duration / 1000}s`);

    // Auto-deactivate after duration
    setTimeout(() => {
      this.deactivateLockdown(serverId);
    }, duration);

    return { active: true, duration, endsAt: new Date(lockdownEnd) };
  }

  /**
   * Deactivate lockdown
   */
  static deactivateLockdown(serverId) {
    this.initializeServer(serverId);
    const threat = threats.get(serverId);
    threat.lockdownActive = false;
    threat.threatLevel = 'medium';
    logger.info('guard', `🔓 Lockdown deactivated for ${serverId}`);
    return { active: false };
  }

  /**
   * Get all protected servers data
   */
  static getAllServersStatus() {
    const serversData = [];
    threats.forEach((threatData, serverId) => {
      serversData.push({
        serverId,
        threatLevel: threatData.threatLevel,
        protectionEnabled: threatData.protectionEnabled,
        lockdownActive: threatData.lockdownActive,
        threatCount: threatData.threats.length,
        lastUpdate: threatData.lastUpdate
      });
    });
    return serversData.sort((a, b) => {
      const levelOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return levelOrder[a.threatLevel] - levelOrder[b.threatLevel];
    });
  }

  /**
   * Clear flagged status for user (after investigation)
   */
  static clearUserFlag(userId) {
    if (suspiciousActivity.has(userId)) {
      const user = suspiciousActivity.get(userId);
      user.flagged = false;
      user.score = 0;
      user.actions = [];
      logger.info('guard', `✓ User ${userId} flagging cleared`);
      return true;
    }
    return false;
  }

  /**
   * Export guard data for website/API
   */
  static exportGuardData() {
    return {
      timestamp: new Date(),
      servers: this.getAllServersStatus(),
      flaggedUsers: Array.from(suspiciousActivity.values())
        .filter(u => u.flagged)
        .map(u => ({ userId: u.userId, score: u.score, actionCount: u.actions.length })),
      globalThreatLevel: this.calculateGlobalThreat()
    };
  }

  /**
   * Calculate global threat level across all servers
   */
  static calculateGlobalThreat() {
    const levels = Array.from(threats.values()).map(t => t.threatLevel);
    if (levels.includes('critical')) return 'critical';
    if (levels.includes('high')) return 'high';
    if (levels.includes('medium')) return 'medium';
    return 'low';
  }
}

module.exports = SentinelGuard;
