/**
 * SENTINEL NETWORK — Web Dashboard
 * A lightweight Express server providing a live status page.
 * Access at: http://localhost:3000
 *
 * Run separately with: node dashboard/server.js
 * (The main bot index.js also starts this automatically if DASHBOARD=true in config)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const db  = require('../modules/database');
const inv = require('../modules/investigation');
const surv = require('../modules/surveillance');
const config = require('../config.json');

const PORT = config.dashboardPort || 3000;

const RISK_COLORS_HEX = {
  NONE: '#00ff88', LOW: '#aaffaa', MEDIUM: '#ffaa00', HIGH: '#ff5500', CRITICAL: '#ff0022'
};

function buildDashboardHTML() {
  const profiles  = Object.values(db.getAllProfiles());
  const cases     = Object.values(inv.getAllCases());
  const watchlist = surv.getWatchlist();

  const riskOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

  const totalProfiles   = profiles.length;
  const flaggedProfiles = profiles.filter(p => p.riskLevel !== 'NONE').length;
  const openCases       = cases.filter(c => c.status === 'OPEN').length;
  const reviewCases     = cases.filter(c => c.status === 'UNDER REVIEW').length;

  const topThreats = profiles
    .filter(p => p.riskLevel !== 'NONE')
    .sort((a, b) => (riskOrder[b.riskLevel] || 0) - (riskOrder[a.riskLevel] || 0))
    .slice(0, 10);

  const activeCases = cases.filter(c => c.status !== 'CLOSED').slice(-10);

  const threatRows = topThreats.map(p => `
    <tr>
      <td>${p.username}</td>
      <td><span class="badge" style="background:${RISK_COLORS_HEX[p.riskLevel]};color:#000">${p.riskLevel}</span></td>
      <td>${p.watchlisted ? '⚠️ YES' : 'NO'}</td>
      <td>${p.flags.length}</td>
      <td>${p.notes.length}</td>
    </tr>
  `).join('');

  const caseRows = activeCases.map(c => `
    <tr>
      <td>${c.caseId}</td>
      <td>${c.title.substring(0, 40)}</td>
      <td><span class="badge status-${c.status.replace(' ', '-').toLowerCase()}">${c.status}</span></td>
      <td>${c.evidence.length}</td>
      <td>${c.assignedAgents.length}</td>
    </tr>
  `).join('');

  const watchRows = watchlist.slice(0, 10).map(w => {
    const profile = db.getProfile(w.userId);
    return `<tr>
      <td>${profile ? profile.username : w.userId}</td>
      <td>${new Date(w.watchlistedAt).toISOString().split('T')[0]}</td>
      <td>${w.eventCount}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Sentinel Network — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #050810;
      color: #c0d0e0;
      font-family: 'Courier New', monospace;
      padding: 20px;
    }
    header {
      border-bottom: 1px solid #00ff8844;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    header h1 {
      color: #00ff88;
      font-size: 22px;
      letter-spacing: 4px;
    }
    header p { color: #556; font-size: 12px; margin-top: 4px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .stat-box {
      background: #0a0f1e;
      border: 1px solid #00ff8822;
      border-radius: 6px;
      padding: 16px;
      text-align: center;
    }
    .stat-box .num { font-size: 36px; color: #00ff88; font-weight: bold; }
    .stat-box .lbl { font-size: 11px; color: #556; margin-top: 4px; letter-spacing: 1px; }
    .section { margin-bottom: 28px; }
    .section h2 {
      color: #00ff88;
      font-size: 13px;
      letter-spacing: 2px;
      border-left: 3px solid #00ff88;
      padding-left: 10px;
      margin-bottom: 12px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      background: #0a0f1e;
      color: #00ff88;
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      letter-spacing: 1px;
    }
    td { padding: 7px 12px; border-bottom: 1px solid #0d1525; }
    tr:hover td { background: #0d1525; }
    .badge {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
    }
    .status-open          { background: #00ff8833; color: #00ff88; }
    .status-under-review  { background: #ffaa0033; color: #ffaa00; }
    .footer { color: #334; font-size: 11px; margin-top: 20px; text-align: center; }
  </style>
</head>
<body>
  <header>
    <h1>⬡ SENTINEL NETWORK</h1>
    <p>LIVE DASHBOARD — Auto-refreshes every 30s — ${new Date().toUTCString()}</p>
  </header>

  <div class="stats">
    <div class="stat-box"><div class="num">${totalProfiles}</div><div class="lbl">SUBJECTS</div></div>
    <div class="stat-box"><div class="num">${flaggedProfiles}</div><div class="lbl">FLAGGED</div></div>
    <div class="stat-box"><div class="num">${watchlist.length}</div><div class="lbl">WATCHED</div></div>
    <div class="stat-box"><div class="num">${openCases}</div><div class="lbl">OPEN CASES</div></div>
    <div class="stat-box"><div class="num">${reviewCases}</div><div class="lbl">UNDER REVIEW</div></div>
    <div class="stat-box"><div class="num">${cases.length}</div><div class="lbl">TOTAL CASES</div></div>
  </div>

  <div class="section">
    <h2>🚨 TOP RISK SUBJECTS</h2>
    <table>
      <thead><tr><th>USERNAME</th><th>RISK</th><th>WATCHED</th><th>FLAGS</th><th>NOTES</th></tr></thead>
      <tbody>${threatRows || '<tr><td colspan="5">No flagged subjects</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>📁 ACTIVE CASES</h2>
    <table>
      <thead><tr><th>CASE ID</th><th>TITLE</th><th>STATUS</th><th>EVIDENCE</th><th>AGENTS</th></tr></thead>
      <tbody>${caseRows || '<tr><td colspan="5">No active cases</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>👁 WATCHLIST</h2>
    <table>
      <thead><tr><th>SUBJECT</th><th>SINCE</th><th>EVENTS LOGGED</th></tr></thead>
      <tbody>${watchRows || '<tr><td colspan="3">Watchlist is empty</td></tr>'}</tbody>
    </table>
  </div>

  <div class="footer">SENTINEL NETWORK v${config.version} — CLASSIFIED INTERNAL TOOL</div>
</body>
</html>`;
}

function startDashboard() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      // JSON API endpoint for external integrations
      const profiles  = Object.values(db.getAllProfiles());
      const cases     = Object.values(inv.getAllCases());
      const watchlist = surv.getWatchlist();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        profiles: profiles.length,
        flagged:  profiles.filter(p => p.riskLevel !== 'NONE').length,
        watched:  watchlist.length,
        cases:    { total: cases.length, open: cases.filter(c => c.status === 'OPEN').length }
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildDashboardHTML());
  });

  server.listen(PORT, () => {
    console.log(`[DASHBOARD] Live at http://localhost:${PORT}`);
  });

  return server;
}

module.exports = { startDashboard };

// If run directly
if (require.main === module) {
  startDashboard();
}
