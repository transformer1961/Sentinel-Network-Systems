/**
 * SENTINEL GUARD API ROUTES
 * 
 * Provides control panel and website integration endpoints
 * Add these routes to your dashboard/server.js
 */

const sentinelGuard = require('../modules/sentinelGuard');
const db = require('../modules/database');
const logger = require('../modules/logger');

/**
 * Add these routes to your Express app in dashboard/server.js
 * 
 * USAGE in server.js:
 * const guardRoutes = require('./guardRoutes');
 * guardRoutes.setupRoutes(app, config);
 */

function setupRoutes(app, config) {
  // ─────────────────────────────────────────────────────────────────
  // GUARD STATUS & MONITORING ENDPOINTS
  // ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/guard/status
   * Get overall guard status across all servers
   */
  app.get('/api/guard/status', requireAuth, (req, res) => {
    try {
      const status = sentinelGuard.exportGuardData();
      res.json(status);
    } catch (error) {
      logger.critical('guard-api', `Error fetching guard status: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch guard status' });
    }
  });

  /**
   * GET /api/guard/server/:serverId
   * Get detailed status for specific server
   */
  app.get('/api/guard/server/:serverId', requireAuth, (req, res) => {
    try {
      const serverId = req.params.serverId;
      const report = sentinelGuard.generateDetailedReport(serverId);
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch server status' });
    }
  });

  /**
   * GET /api/guard/servers
   * Get status for all servers
   */
  app.get('/api/guard/servers', requireAuth, (req, res) => {
    try {
      const servers = sentinelGuard.getAllServersStatus();
      res.json({ servers, timestamp: new Date() });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch servers' });
    }
  });

  /**
   * GET /api/guard/threats
   * Get current threats across network
   */
  app.get('/api/guard/threats', requireAuth, (req, res) => {
    try {
      const threats = sentinelGuard.exportGuardData();
      res.json({
        globalThreatLevel: threats.globalThreatLevel,
        serverThreats: threats.servers,
        flaggedUsers: threats.flaggedUsers,
        timestamp: threats.timestamp
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch threats' });
    }
  });

  /**
   * GET /api/guard/flagged-users
   * Get list of flagged suspicious users
   */
  app.get('/api/guard/flagged-users', requireAuth, (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 50;
      const threats = sentinelGuard.exportGuardData();
      const flagged = threats.flaggedUsers.slice(0, limit);
      res.json(flagged);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch flagged users' });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GUARD CONTROL ENDPOINTS
  // ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/guard/threat-level
   * Manually set threat level for server
   * Body: { serverId, level, reason }
   */
  app.post('/api/guard/threat-level', requireAuth, requireAdmin, (req, res) => {
    try {
      const { serverId, level, reason } = req.body;

      if (!serverId || !level) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!['low', 'medium', 'high', 'critical'].includes(level)) {
        return res.status(400).json({ error: 'Invalid threat level' });
      }

      const result = sentinelGuard.setThreatLevel(serverId, level, reason || 'Web control panel update');
      res.json({
        success: true,
        message: `Threat level updated from ${result.oldLevel} to ${result.newLevel}`,
        result
      });

      logger.info('guard-api', `🚨 Threat level set to ${level} for ${serverId} via web panel`);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update threat level' });
    }
  });

  /**
   * POST /api/guard/protection
   * Enable/disable protection for server
   * Body: { serverId, enabled }
   */
  app.post('/api/guard/protection', requireAuth, requireAdmin, (req, res) => {
    try {
      const { serverId, enabled } = req.body;

      if (serverId === undefined || enabled === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      sentinelGuard.toggleProtection(serverId, enabled);
      res.json({
        success: true,
        message: `Protection ${enabled ? 'enabled' : 'disabled'} for server`,
        protectionEnabled: enabled
      });

      logger.info('guard-api', `✓ Protection ${enabled ? 'enabled' : 'disabled'} for ${serverId}`);
    } catch (error) {
      res.status(500).json({ error: 'Failed to toggle protection' });
    }
  });

  /**
   * POST /api/guard/lockdown
   * Activate emergency lockdown
   * Body: { serverId, duration }
   */
  app.post('/api/guard/lockdown', requireAuth, requireAdmin, (req, res) => {
    try {
      const { serverId, duration } = req.body;
      const durationMs = (duration || 3600) * 1000;

      sentinelGuard.activateLockdown(serverId, durationMs);
      res.json({
        success: true,
        message: 'Emergency lockdown activated',
        duration: durationMs
      });

      logger.critical('guard-api', `🔐 LOCKDOWN activated via web panel for ${serverId}`);
    } catch (error) {
      res.status(500).json({ error: 'Failed to activate lockdown' });
    }
  });

  /**
   * POST /api/guard/lockdown/cancel
   * Cancel active lockdown
   * Body: { serverId }
   */
  app.post('/api/guard/lockdown/cancel', requireAuth, requireAdmin, (req, res) => {
    try {
      const { serverId } = req.body;

      sentinelGuard.deactivateLockdown(serverId);
      res.json({
        success: true,
        message: 'Lockdown deactivated'
      });

      logger.info('guard-api', `🔓 Lockdown cancelled for ${serverId}`);
    } catch (error) {
      res.status(500).json({ error: 'Failed to cancel lockdown' });
    }
  });

  /**
   * POST /api/guard/policy
   * Update server security policy
   * Body: { serverId, policyName, value }
   */
  app.post('/api/guard/policy', requireAuth, requireAdmin, (req, res) => {
    try {
      const { serverId, policyName, value } = req.body;

      if (!serverId || !policyName || value === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      sentinelGuard.updatePolicy(serverId, policyName, value);
      res.json({
        success: true,
        message: `Policy ${policyName} updated to ${value}`
      });

      logger.info('guard-api', `✓ Policy ${policyName} = ${value} for ${serverId}`);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update policy' });
    }
  });

  /**
   * POST /api/guard/user/clear-flag
   * Clear suspicious flag from user
   * Body: { userId }
   */
  app.post('/api/guard/user/clear-flag', requireAuth, requireAdmin, (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      const success = sentinelGuard.clearUserFlag(userId);
      res.json({
        success,
        message: success ? 'User flag cleared' : 'User not found'
      });

      logger.info('guard-api', `✓ User ${userId} flag cleared`);
    } catch (error) {
      res.status(500).json({ error: 'Failed to clear user flag' });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // CONTROL PANEL HTML PAGE
  // ─────────────────────────────────────────────────────────────────

  /**
   * GET /control-panel
   * Render control panel dashboard
   */
  app.get('/control-panel', requireAuth, (req, res) => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sentinel Guard Control Panel</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #0a0f1e;
            color: #c7d8ef;
            line-height: 1.6;
          }
          .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px;
            background: linear-gradient(135deg, #0f1d31 0%, #1a2a47 100%);
            border-left: 4px solid #00ff88;
            border-radius: 8px;
          }
          .header h1 {
            font-size: 28px;
            color: #00ff88;
          }
          .global-threat {
            font-size: 18px;
            padding: 10px 20px;
            border-radius: 6px;
            font-weight: bold;
          }
          .threat-low { background: #00ff88; color: #0a0f1e; }
          .threat-medium { background: #ffaa00; color: #0a0f1e; }
          .threat-high { background: #ff6600; color: #fff; }
          .threat-critical { background: #ff0000; color: #fff; animation: pulse 1s infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .card {
            background: #0f1d31;
            border: 1px solid #2a3a52;
            border-radius: 8px;
            padding: 20px;
            transition: all 0.3s;
          }
          .card:hover {
            border-color: #00ff88;
            box-shadow: 0 0 10px rgba(0,255,136,0.2);
          }
          .card-title {
            font-size: 14px;
            color: #00ff88;
            text-transform: uppercase;
            margin-bottom: 10px;
            font-weight: bold;
          }
          .card-value {
            font-size: 32px;
            font-weight: bold;
            color: #c7d8ef;
          }
          .card-meta {
            font-size: 12px;
            color: #6a7a8f;
            margin-top: 10px;
          }

          .servers-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: #0f1d31;
            border-radius: 8px;
            overflow: hidden;
          }
          .servers-table thead {
            background: #1a2a47;
          }
          .servers-table th {
            padding: 15px;
            text-align: left;
            color: #00ff88;
            font-weight: bold;
            border-bottom: 2px solid #2a3a52;
          }
          .servers-table td {
            padding: 12px 15px;
            border-bottom: 1px solid #2a3a52;
          }
          .servers-table tbody tr:hover {
            background: #1a2a47;
          }

          .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
          }
          .status-low { background: #00ff88; color: #0a0f1e; }
          .status-medium { background: #ffaa00; color: #0a0f1e; }
          .status-high { background: #ff6600; color: #fff; }
          .status-critical { background: #ff0000; color: #fff; }

          .controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin: 20px 0;
          }
          .control-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          label {
            font-size: 12px;
            color: #00ff88;
            text-transform: uppercase;
            font-weight: bold;
          }
          input, select, button {
            padding: 10px;
            background: #1a2a47;
            color: #c7d8ef;
            border: 1px solid #2a3a52;
            border-radius: 4px;
            font-size: 14px;
          }
          input:focus, select:focus {
            outline: none;
            border-color: #00ff88;
            box-shadow: 0 0 5px rgba(0,255,136,0.3);
          }
          button {
            background: #00ff88;
            color: #0a0f1e;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
          }
          button:hover {
            background: #00dd77;
            transform: translateY(-2px);
          }
          button.danger {
            background: #ff0000;
            color: #fff;
          }
          button.danger:hover {
            background: #dd0000;
          }

          .chart-container {
            background: #0f1d31;
            border: 1px solid #2a3a52;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          canvas { max-height: 300px; }

          .flagged-users {
            background: #0f1d31;
            border: 1px solid #ff6600;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .user-entry {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background: #1a2a47;
            border-radius: 4px;
            margin-bottom: 8px;
          }

          .loading { opacity: 0.5; pointer-events: none; }
          .success { color: #00ff88; }
          .error { color: #ff0000; }
          .warning { color: #ffaa00; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div>
              <h1>🛡️ Sentinel Guard Control Panel</h1>
              <p style="color: #6a7a8f; margin-top: 5px;">Centralized server protection management</p>
            </div>
            <div>
              <div class="global-threat" id="globalThreat" style="background: #ffaa00; color: #0a0f1e;">Loading...</div>
            </div>
          </div>

          <div class="grid">
            <div class="card">
              <div class="card-title">Total Servers</div>
              <div class="card-value" id="serverCount">0</div>
              <div class="card-meta">Under protection</div>
            </div>
            <div class="card">
              <div class="card-title">Active Threats</div>
              <div class="card-value" id="threatCount">0</div>
              <div class="card-meta">Detected this hour</div>
            </div>
            <div class="card">
              <div class="card-title">Flagged Users</div>
              <div class="card-value" id="flaggedCount">0</div>
              <div class="card-meta">Suspicious activity</div>
            </div>
            <div class="card">
              <div class="card-title">Critical Status</div>
              <div class="card-value" id="criticalCount">0</div>
              <div class="card-meta">Require immediate action</div>
            </div>
          </div>

          <h2 style="margin-top: 30px; margin-bottom: 20px; border-bottom: 2px solid #00ff88; padding-bottom: 10px;">
            📊 Server Status
          </h2>
          <table class="servers-table" id="serversTable">
            <thead>
              <tr>
                <th>Server ID</th>
                <th>Threat Level</th>
                <th>Protection</th>
                <th>Lockdown</th>
                <th>Threats</th>
                <th>Last Update</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="serversBody">
              <tr><td colspan="7" style="text-align: center; padding: 20px;">Loading...</td></tr>
            </tbody>
          </table>

          <h2 style="margin-top: 30px; margin-bottom: 20px; border-bottom: 2px solid #00ff88; padding-bottom: 10px;">
            🎮 Quick Controls
          </h2>
          <div class="controls">
            <div class="control-group">
              <label>Set Threat Level</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="threatServerId" placeholder="Server ID" style="flex: 1;">
                <select id="threatLevel" style="flex: 1;">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <button onclick="setThreatLevel()">Apply</button>
              </div>
            </div>
            <div class="control-group">
              <label>Activate Lockdown</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="lockdownServerId" placeholder="Server ID" style="flex: 1;">
                <input type="number" id="lockdownDuration" placeholder="Minutes" value="60" min="1" max="1440" style="flex: 1;">
                <button class="danger" onclick="activateLockdown()">Lockdown</button>
              </div>
            </div>
            <div class="control-group">
              <label>Toggle Protection</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="protectionServerId" placeholder="Server ID" style="flex: 1;">
                <button onclick="toggleProtection(true)" style="flex: 1;">Enable</button>
                <button class="danger" onclick="toggleProtection(false)" style="flex: 1;">Disable</button>
              </div>
            </div>
          </div>

          <h2 style="margin-top: 30px; margin-bottom: 20px; border-bottom: 2px solid #00ff88; padding-bottom: 10px;">
            👁️ Flagged Users
          </h2>
          <div class="flagged-users" id="flaggedUsersContainer">
            <div style="text-align: center; padding: 20px;">Loading...</div>
          </div>

          <div style="margin-top: 40px; padding: 20px; background: #0f1d31; border-radius: 8px; border-left: 4px solid #6a7a8f;">
            <p style="font-size: 12px; color: #6a7a8f;">
              <strong>Last Updated:</strong> <span id="lastUpdate">-</span> | 
              <strong>Auto-refresh:</strong> Every 30 seconds | 
              <a href="/logout" style="color: #00ff88; text-decoration: none;">Logout</a>
            </p>
          </div>
        </div>

        <script>
          let chartThreats = null;

          async function loadData() {
            try {
              const res = await fetch('/api/guard/status');
              const data = await res.json();

              document.getElementById('globalThreat').innerHTML = data.globalThreatLevel.toUpperCase();
              document.getElementById('globalThreat').className = 'global-threat threat-' + data.globalThreatLevel;
              document.getElementById('serverCount').textContent = data.servers.length;
              document.getElementById('threatCount').textContent = data.servers.reduce((sum, s) => sum + (s.threatCount || 0), 0);
              document.getElementById('flaggedCount').textContent = data.flaggedUsers.length;
              document.getElementById('criticalCount').textContent = data.servers.filter(s => s.threatLevel === 'critical').length;
              document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();

              // Render servers table
              const tbody = document.getElementById('serversBody');
              tbody.innerHTML = data.servers.map(s => \`
                <tr>
                  <td style="font-family: monospace; font-size: 11px;">\${s.serverId.substring(0, 12)}...</td>
                  <td><span class="status-badge status-\${s.threatLevel}">\${s.threatLevel.toUpperCase()}</span></td>
                  <td>\${s.protectionEnabled ? '✓ Active' : '✗ Inactive'}</td>
                  <td>\${s.lockdownActive ? '🔐 Active' : '🔓 Inactive'}</td>
                  <td>\${s.threatCount}</td>
                  <td style="font-size: 11px;">\${new Date(s.lastUpdate).toLocaleString()}</td>
                  <td><button onclick="editServer('\${s.serverId}')" style="padding: 4px 8px; font-size: 11px;">Edit</button></td>
                </tr>
              \`).join('');

              // Render flagged users
              const flaggedContainer = document.getElementById('flaggedUsersContainer');
              if (data.flaggedUsers.length > 0) {
                flaggedContainer.innerHTML = data.flaggedUsers.map(u => \`
                  <div class="user-entry">
                    <div>
                      <strong style="color: #00ff88;">User ID:</strong> \${u.userId}
                      <br>
                      <span style="color: #ffaa00;">Threat Score: \${u.score}</span>
                    </div>
                    <button class="danger" onclick="clearUserFlag('\${u.userId}')" style="padding: 6px 12px;">Clear Flag</button>
                  </div>
                \`).join('');
              } else {
                flaggedContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #6a7a8f;">No flagged users</div>';
              }
            } catch (err) {
              console.error('Error loading data:', err);
            }
          }

          async function setThreatLevel() {
            const serverId = document.getElementById('threatServerId').value;
            const level = document.getElementById('threatLevel').value;
            if (!serverId) { alert('Enter server ID'); return; }

            try {
              const res = await fetch('/api/guard/threat-level', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId, level, reason: 'Web panel update' })
              });
              const data = await res.json();
              alert(data.message || data.error);
              loadData();
            } catch (err) {
              alert('Error: ' + err.message);
            }
          }

          async function activateLockdown() {
            const serverId = document.getElementById('lockdownServerId').value;
            const duration = parseInt(document.getElementById('lockdownDuration').value);
            if (!serverId) { alert('Enter server ID'); return; }

            if (!confirm('Activate LOCKDOWN? This restricts all access.')) return;

            try {
              const res = await fetch('/api/guard/lockdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId, duration })
              });
              const data = await res.json();
              alert(data.message || data.error);
              loadData();
            } catch (err) {
              alert('Error: ' + err.message);
            }
          }

          async function toggleProtection(enabled) {
            const serverId = document.getElementById('protectionServerId').value;
            if (!serverId) { alert('Enter server ID'); return; }

            try {
              const res = await fetch('/api/guard/protection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId, enabled })
              });
              const data = await res.json();
              alert(data.message || data.error);
              loadData();
            } catch (err) {
              alert('Error: ' + err.message);
            }
          }

          async function clearUserFlag(userId) {
            try {
              const res = await fetch('/api/guard/user/clear-flag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
              });
              const data = await res.json();
              alert(data.message || data.error);
              loadData();
            } catch (err) {
              alert('Error: ' + err.message);
            }
          }

          function editServer(serverId) {
            alert('Edit server: ' + serverId + '\\n\\nUse the Quick Controls to modify this server.');
          }

          loadData();
          setInterval(loadData, 30000); // Auto-refresh every 30 seconds
        </script>
      </body>
      </html>
    `;
    res.send(html);
  });
}

/**
 * MIDDLEWARE
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  // Check if user is admin (you can add more sophisticated auth here)
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = {
  setupRoutes
};
