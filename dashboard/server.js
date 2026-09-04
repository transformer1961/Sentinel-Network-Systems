/**
 * SENTINEL NETWORK — Advanced Dashboard v4
 *
 * Features:
 * - Password-protected dashboard with session auth and IP lockout
 * - Live overview widgets for profiles, cases, watchlist, blacklist, and servers
 * - Search, filters, CSV/JSON export, and trend charts
 * - Dashboard actions for reopen/close case, manage watchlist, and blacklist control
 * - Improved security headers and secure cookie handling
 */

const http   = require('http');
const url    = require('url');
const crypto = require('crypto');
const db     = require('../modules/database');
const auth   = require('../modules/dashboardAuth');
const config = require('../modules/config');
const logger = require('../modules/logger');

// ⚠️ SECURITY: Read PORT from environment (Railway requirement)
const PORT     = process.env.PORT || config.dashboardPort || 3000;
const PASSWORD = config.dashboardPassword;

// SECURITY: Strict password validation
const weakPasswords = ['sentinel', 'admin', 'password', 'changeme', '123456', 'password123'];
const isWeakPassword = !PASSWORD || weakPasswords.includes(String(PASSWORD).toLowerCase());

// SECURITY: Enforce production requirements
if (process.env.NODE_ENV === 'production' && isWeakPassword) {
  logger.critical('dashboard', '❌ PRODUCTION MODE: DASHBOARD_PASSWORD must be set to a strong password (min 16 chars, mixed case + numbers + symbols)');
  process.exit(1);
}

if (isWeakPassword) {
  logger.warn('dashboard', '⚠️  SECURITY: Dashboard password is insecure or default. Set DASHBOARD_PASSWORD in config/environment.');
}

// ⚠️ SECURITY: Request size limit (prevent DoS)
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const REQUEST_TIMEOUT = 30 * 1000; // 30 seconds

// SECURITY: CSRF token management
const csrfTokens = new Map();
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createCSRFToken(sessionId) {
  const token = generateCSRFToken();
  csrfTokens.set(sessionId, token);
  // Token expires after 1 hour
  setTimeout(() => csrfTokens.delete(sessionId), 60 * 60 * 1000);
  return token;
}

function validateCSRFToken(sessionId, token) {
  const storedToken = csrfTokens.get(sessionId);
  if (!storedToken) return false;
  if (storedToken !== token) {
    logger.warn('dashboard', '🔴 CSRF token validation failed', { sessionId });
    return false;
  }
  csrfTokens.delete(sessionId); // One-time use
  return true;
}

function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
}

function responseHeaders(req, contentType = 'text/html') {
  const headers = {
    'Content-Type': contentType,
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(),camera=(),microphone=()'
  };

  if (isSecureRequest(req)) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  return headers;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    
    // ⚠️ SECURITY: Prevent DoS via huge payloads
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        logger.warn('dashboard', `🔴 Request size exceeded: ${size} bytes`, { remoteAddr: req.socket.remoteAddress });
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    
    // ⚠️ SECURITY: Request timeout
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
      req.destroy();
    }, REQUEST_TIMEOUT);
    
    req.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getAllData() {
  const profiles   = db.getAllProfiles();
  const cases      = db.getAllCases();
  const blacklist  = db.getBlacklist();
  const watchlist  = db.getWatchlist();
  const logs       = db.loadData('logs');
  const servers    = db.loadData('serverConfig');

  const profileArr   = Object.values(profiles);
  const caseArr      = Object.values(cases);
  const blacklistArr = Object.values(blacklist);

  const agents = profileArr.filter(p => (p.clearance || 1) > 1)
    .sort((a, b) => (b.clearance || 1) - (a.clearance || 1));

  const recentEvents = [];
  for (const [uid, log] of Object.entries(logs)) {
    const profile = profiles[uid];
    for (const ev of (log.events || [])) {
      recentEvents.push({ ...ev, userId: uid, username: profile?.username || uid });
    }
  }
  recentEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const serverStats = {};
  for (const p of profileArr) {
    for (const sid of (p.servers || [])) {
      if (!serverStats[sid]) serverStats[sid] = { serverId: sid, name: servers[sid]?.serverName || sid, subjects: 0, flagged: 0, cases: 0 };
      serverStats[sid].subjects++;
      if (p.riskLevel > 0) serverStats[sid].flagged++;
    }
  }
  for (const c of caseArr) {
    if (c.serverId) {
      if (!serverStats[c.serverId]) serverStats[c.serverId] = { serverId: c.serverId, name: servers[c.serverId]?.serverName || c.serverId, subjects: 0, flagged: 0, cases: 0 };
      serverStats[c.serverId].cases = (serverStats[c.serverId].cases || 0) + 1;
    }
  }

  const riskDist = [0, 1, 2, 3, 4, 5].map(l => ({ level: l, label: ['None', 'Low', 'Medium', 'High', 'Critical', 'Extreme'][l], count: profileArr.filter(p => p.riskLevel === l).length }));
  const caseDist = [
    { status: 'OPEN', count: caseArr.filter(c => c.status === 'OPEN').length },
    { status: 'UNDER REVIEW', count: caseArr.filter(c => c.status === 'UNDER REVIEW').length },
    { status: 'CLOSED', count: caseArr.filter(c => c.status === 'CLOSED').length }
  ];

  const trend = {};
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().split('T')[0];
    trend[d] = 0;
  }
  for (const c of caseArr) {
    const d = new Date(c.createdAt).toISOString().split('T')[0];
    if (trend[d] !== undefined) trend[d]++;
  }

  return {
    profiles: profileArr,
    cases: caseArr,
    blacklist: blacklistArr,
    watchlist,
    agents,
    recentEvents: recentEvents.slice(0, 100),
    serverStats: Object.values(serverStats),
    securityStates: db.loadData('serverSecurity'),
    riskDist,
    caseDist,
    trend,
    stats: {
      totalProfiles: profileArr.length,
      flagged: profileArr.filter(p => p.riskLevel > 0).length,
      blacklisted: blacklistArr.length,
      watched: watchlist.length,
      totalCases: caseArr.length,
      openCases: caseArr.filter(c => c.status === 'OPEN').length,
      reviewCases: caseArr.filter(c => c.status === 'UNDER REVIEW').length,
      agents: agents.length
    }
  };
}

function toCSV(rows, keys) {
  const header = keys.join(',');
  const lines = rows.map(row => keys.map(key => {
    const value = row[key] ?? '';
    const text = Array.isArray(value) ? value.length : String(value).replace(/"/g, '""');
    return `"${text}"`;
  }).join(','));
  return [header, ...lines].join('\n');
}

function buildLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sentinel Network Dashboard Login</title>
<style>
  body{margin:0;font-family:Inter,system-ui,sans-serif;background:#020714;color:#e3f5ff;display:flex;align-items:center;justify-content:center;height:100vh;background-image:radial-gradient(circle at top,rgba(0,255,136,.12),transparent 35%),radial-gradient(circle at 20% 20%,rgba(0,170,255,.18),transparent 25%);}
  .card{width:100%;max-width:420px;padding:32px;background:rgba(4,11,27,.94);border:1px solid rgba(0,255,136,.16);border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.35);}
  h1{font-size:24px;margin-bottom:8px;color:#6cffb2;letter-spacing:1px;}
  p{color:#8ba8c9;margin-bottom:24px;font-size:14px;}
  input{width:100%;padding:14px 16px;margin:8px 0 16px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:#04111f;color:#f7fbff;outline:none;font-size:14px;}
  input:focus{border-color:#00ff88;box-shadow:0 0 0 4px rgba(0,255,136,.08);}
  button{width:100%;padding:14px 16px;border:none;border-radius:12px;background:#00ff88;color:#03110f;font-weight:700;cursor:pointer;letter-spacing:.7px;transition:transform .15s ease,filter .15s ease;}
  button:hover{transform:translateY(-1px);filter:brightness(1.05);}
  .note{color:#7da4c1;font-size:12px;margin-top:12px;}
  .error{color:#ff5a5a;font-size:13px;min-height:20px;margin-top:8px;}
</style>
</head>
<body>
<div class="card">
  <h1>SENTINEL NETWORK</h1>
  <p>Secure dashboard access — authenticate with the dashboard password.</p>
  <input id="password" type="password" placeholder="Dashboard password" autocomplete="current-password">
  <button onclick="login()">Authenticate</button>
  <div class="error" id="error"></div>
  <div class="note">If this is the default password, update DASHBOARD_PASSWORD immediately.</div>
</div>
<script>
async function login() {
  const pw = document.getElementById('password').value.trim();
  const error = document.getElementById('error');
  error.textContent = '';
  try {
    const res = await fetch('/auth', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pw })
    });
    if (res.ok) return window.location.reload();
    const body = await res.json();
    error.textContent = body.error || 'Authentication failed';
  } catch (err) {
    error.textContent = 'Network error';
  }
}
</script>
</body>
</html>`;
}

function buildDashboardPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sentinel Network Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" integrity="sha512-wI9oWBN2d2cdTZi3nuS576EdmiYd6gFCwN5v1tRFO+a9aSv6c6RdCSQbm2EVVJyeNgI8H6pAVls/gcct5XvgRA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<style>
  :root { --bg:#020714; --surface:#08172f; --surface2:#0f213f; --border:#1c3b61; --text:#e8f6ff; --muted:#7aa5c6; --good:#00ff88; --warn:#ffb76b; --danger:#ff5a5a; }
  *{box-sizing:border-box;}
  body{margin:0;font-family:Inter,system-ui,sans-serif;background:linear-gradient(180deg,#04101f 0%,#020714 100%);color:var(--text);}
  .layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh;}
  nav{background:rgba(4,12,28,.96);border-right:1px solid rgba(0,255,136,.12);padding:24px;display:flex;flex-direction:column;gap:24px;position:sticky;top:0;height:100vh;}
  .logo{font-size:18px;font-weight:800;letter-spacing:2px;color:var(--good);margin-bottom:8px;}
  .nav-desc{font-size:12px;color:var(--muted);line-height:1.5;}
  .nav-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;border:1px solid transparent;color:var(--muted);cursor:pointer;transition:.18s;}
  .nav-item.active, .nav-item:hover{background:rgba(0,255,136,.08);border-color:rgba(0,255,136,.18);color:var(--text);}
  .nav-item span{font-size:14px;}
  .logout{margin-top:auto;padding:12px 14px;background:rgba(255,90,90,.12);border:1px solid rgba(255,90,90,.18);color:var(--danger);border-radius:14px;cursor:pointer;}
  main{padding:28px 32px;}
  .section{display:none;}
  .section.active{display:block;}
  .page-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;}
  .title{font-size:28px;font-weight:800;letter-spacing:1px;}
  .subtitle{color:var(--muted);font-size:14px;}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;}
  .card{background:rgba(8,23,41,.95);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:20px;min-height:120px;}
  .card h3{margin:0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:1px;}
  .card p{margin:12px 0 0;font-size:28px;font-weight:700;}
  .table-wrap{overflow:auto;background:rgba(8,23,41,.95);border:1px solid rgba(255,255,255,.07);border-radius:18px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th,td{padding:14px 16px;text-align:left;border-bottom:1px solid rgba(255,255,255,.05);}
  th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;}
  tr:hover{background:rgba(0,255,136,.05);}
  .badge{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.5px;}
  .badge.green{background:rgba(0,255,136,.12);color:var(--good);}
  .badge.orange{background:rgba(255,183,107,.14);color:var(--warn);}
  .badge.red{background:rgba(255,90,90,.14);color:var(--danger);}
  .toolbar{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px;align-items:center;}
  .toolbar input, .toolbar select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:var(--text);padding:10px 12px;border-radius:12px;outline:none;}
  .toolbar button{background:var(--good);color:#04110d;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;transition:.15s;} 
  .toolbar button:hover{opacity:.94;}
  .panel{background:rgba(8,23,41,.98);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:20px;margin-bottom:24px;}
  .panel h2{margin-top:0;font-size:16px;color:var(--good);}
  .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}
  .form-row input, .form-row select{width:100%;}
  .action-btn{background:rgba(0,255,136,.12);border:1px solid rgba(0,255,136,.18);color:var(--good);font-weight:700;}
  .action-btn.danger{background:rgba(255,90,90,.12);border-color:rgba(255,90,90,.18);color:var(--danger);}
  .status-bar{display:flex;gap:12px;flex-wrap:wrap;}
  .status-chip{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);font-size:13px;}
  .error-text{color:var(--danger);}
  .success-text{color:var(--good);}
  .chart-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;}
  .chart-card{background:rgba(8,23,41,.95);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:18px;}
  .chart-card canvas{width:100%;height:240px;}
  @media(max-width:980px){.layout{grid-template-columns:1fr}nav{position:relative;height:auto;width:100%;}main{padding:20px;} .chart-row{grid-template-columns:1fr;}}
</style>
</head>
<body>
<div class="layout">
  <nav>
    <div>
      <div class="logo">SENTINEL NETWORK</div>
      <div class="nav-desc">Advanced secure dashboard with live analytics and operational controls.</div>
    </div>
    <div class="nav-item active" data-section="overview" onclick="navClick(event)"><span>📊</span><span>Overview</span></div>
    <div class="nav-item" data-section="profiles" onclick="navClick(event)"><span>👥</span><span>Profiles</span></div>
    <div class="nav-item" data-section="cases" onclick="navClick(event)"><span>📁</span><span>Cases</span></div>
    <div class="nav-item" data-section="watchlist" onclick="navClick(event)"><span>👁</span><span>Watchlist</span></div>
    <div class="nav-item" data-section="blacklist" onclick="navClick(event)"><span>⛔</span><span>Blacklist</span></div>
    <div class="nav-item" data-section="servers" onclick="navClick(event)"><span>🌐</span><span>Servers</span></div>
    <div class="nav-item" data-section="actions" onclick="navClick(event)"><span>⚙️</span><span>Actions</span></div>
    <button class="logout" onclick="logout()">LOGOUT</button>
    <div class="status-bar" id="dashboard-status"></div>
  </nav>
  <main>
    <div class="page-head"><div><h1 class="title">Network Dashboard</h1><div class="subtitle">Live insights, exports, and advanced incident controls.</div></div><div><button onclick="refresh()">Refresh</button><button onclick="exportAll()">Export JSON</button></div></div>

    <section class="section active" id="section-overview">
      <div class="cards">
        <div class="card"><h3>Active Subjects</h3><p id="stat-profiles">—</p></div>
        <div class="card"><h3>Flagged Subjects</h3><p id="stat-flagged">—</p></div>
        <div class="card"><h3>Blacklisted</h3><p id="stat-blacklisted">—</p></div>
        <div class="card"><h3>Watchlisted</h3><p id="stat-watched">—</p></div>
        <div class="card"><h3>Total Cases</h3><p id="stat-cases">—</p></div>
        <div class="card"><h3>Open Cases</h3><p id="stat-open">—</p></div>
      </div>
      <div class="chart-row">
        <div class="chart-card"><h2>Risk Distribution</h2><canvas id="riskChart"></canvas></div>
        <div class="chart-card"><h2>Case Status</h2><canvas id="caseChart"></canvas></div>
      </div>
      <div class="chart-card"><h2>Cases Opened — Last 14 Days</h2><canvas id="trendChart"></canvas></div>
    </section>

    <section class="section" id="section-profiles">
      <div class="toolbar"><input id="profile-filter" placeholder="Search profiles..." oninput="renderProfiles()"><button onclick="exportCSV('profiles')">Export CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Risk</th><th>Clearance</th><th>Watchlisted</th><th>Blacklisted</th><th>Servers</th></tr></thead><tbody id="profiles-body"></tbody></table></div>
    </section>

    <section class="section" id="section-cases">
      <div class="toolbar"><input id="case-filter" placeholder="Search cases..." oninput="renderCases()"><button onclick="exportCSV('cases')">Export CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>Case ID</th><th>Title</th><th>Status</th><th>Agents</th><th>Evidence</th><th>Opened</th></tr></thead><tbody id="cases-body"></tbody></table></div>
    </section>

    <section class="section" id="section-watchlist">
      <div class="toolbar"><input id="watch-filter" placeholder="Search watchlist..." oninput="renderWatchlist()"><button onclick="exportCSV('watchlist')">Export CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>User ID</th><th>Added</th><th>Added By</th><th>Events</th></tr></thead><tbody id="watchlist-body"></tbody></table></div>
    </section>

    <section class="section" id="section-blacklist">
      <div class="toolbar"><input id="blacklist-filter" placeholder="Search blacklist..." oninput="renderBlacklist()"><button onclick="exportCSV('blacklist')">Export CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>User ID</th><th>Username</th><th>Reason</th><th>Added By</th><th>Date</th></tr></thead><tbody id="blacklist-body"></tbody></table></div>
    </section>

    <section class="section" id="section-servers">
      <div class="toolbar"><input id="servers-filter" placeholder="Search servers..." oninput="renderServers()"><button onclick="exportCSV('servers')">Export CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>Server</th><th>ID</th><th>Subjects</th><th>Flagged</th><th>Cases</th></tr></thead><tbody id="servers-body"></tbody></table></div>
    </section>

    <section class="section" id="section-actions">
      <div class="panel"><h2>Operational Controls</h2><div class="form-row"><input id="action-case-id" placeholder="Case ID"><select id="action-case-operation"><option value="reopen">Reopen Case</option><option value="close">Close Case</option></select></div><div class="form-row"><button class="action-btn" onclick="submitAction('case')">Execute Case Action</button></div><div id="action-case-result"></div></div>
      <div class="panel"><h2>Watchlist Controls</h2><div class="form-row"><input id="action-user-id" placeholder="User ID"><input id="action-server-id" placeholder="Server ID"></div><div class="form-row"><button class="action-btn" onclick="submitAction('disable-notify')">Disable Notify</button><button class="action-btn danger" onclick="submitAction('remove-watchlist')">Remove Watchlist</button></div><div id="action-watch-result"></div></div>
      <div class="panel"><h2>Blacklist Controls</h2><div class="form-row"><input id="action-blacklist-user" placeholder="User ID"><input id="action-blacklist-reason" placeholder="Reason"></div><div class="form-row"><button class="action-btn" onclick="submitAction('blacklist-user')">Add Blacklist</button><button class="action-btn danger" onclick="submitAction('unblacklist-user')">Remove Blacklist</button></div><div id="action-blacklist-result"></div></div>
    </section>
  </main>
</div>
<script>
let D = null;
let charts = {};

function navClick(event) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  event.currentTarget.classList.add('active');
  const section = event.currentTarget.dataset.section;
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById('section-' + section).classList.add('active');
}

async function fetchData() {
  try {
    const res = await fetch('/api/data');
    if (res.status === 401) return window.location.reload();
    D = await res.json();
    renderAll();
    document.getElementById('dashboard-status').innerHTML = '<span class="status-chip">Updated ' + new Date().toLocaleTimeString() + '</span>';
  } catch (err) {
    console.error(err);
  }
}

function refresh() { fetchData(); }

function renderAll() { renderOverview(); renderProfiles(); renderCases(); renderWatchlist(); renderBlacklist(); renderServers(); renderCharts(); }

function renderOverview() {
  if (!D) return;
  document.getElementById('stat-profiles').textContent = D.stats.totalProfiles;
  document.getElementById('stat-flagged').textContent = D.stats.flagged;
  document.getElementById('stat-blacklisted').textContent = D.stats.blacklisted;
  document.getElementById('stat-watched').textContent = D.stats.watched;
  document.getElementById('stat-cases').textContent = D.stats.totalCases;
  document.getElementById('stat-open').textContent = D.stats.openCases;
}

function renderProfiles() {
  if (!D) return;
  const q = document.getElementById('profile-filter').value.toLowerCase();
  const rows = D.profiles.filter(p => p.username.toLowerCase().includes(q) || p.userId.includes(q));
  document.getElementById('profiles-body').innerHTML = rows.map(p => '<tr><td>' + p.username + '</td><td><span class="badge ' + (p.riskLevel >= 4 ? 'red' : p.riskLevel >= 2 ? 'orange' : 'green') + '">' + p.riskLevel + '</span></td><td>' + (p.clearance || 1) + '</td><td>' + (p.watchlisted ? 'Yes' : 'No') + '</td><td>' + (p.blacklisted ? 'Yes' : 'No') + '</td><td>' + ((p.servers || []).length) + '</td></tr>').join('') || '<tr><td colspan="6" class="error-text">No profiles found</td></tr>';
}

function renderCases() {
  if (!D) return;
  const q = document.getElementById('case-filter').value.toLowerCase();
  const rows = D.cases.filter(c => c.caseId.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
  document.getElementById('cases-body').innerHTML = rows.map(c => '<tr><td>' + c.caseId + '</td><td>' + c.title + '</td><td><span class="badge ' + (c.status === 'OPEN' ? 'green' : c.status === 'CLOSED' ? 'red' : 'orange') + '">' + c.status + '</span></td><td>' + ((c.assignedAgents || []).length) + '</td><td>' + ((c.evidence || []).length) + '</td><td>' + new Date(c.createdAt).toLocaleDateString() + '</td></tr>').join('') || '<tr><td colspan="6" class="error-text">No cases found</td></tr>';
}

function renderWatchlist() {
  if (!D) return;
  const q = document.getElementById('watch-filter').value.toLowerCase();
  const rows = D.watchlist.filter(w => (D.profiles.find(p => p.userId === w.userId)?.username || w.userId).toLowerCase().includes(q));
  document.getElementById('watchlist-body').innerHTML = rows.map(w => {
    const p = D.profiles.find(p => p.userId === w.userId) || {};
    return '<tr><td>' + (p.username || w.userId) + '</td><td>' + w.userId + '</td><td>' + new Date(w.watchlistedAt).toLocaleDateString() + '</td><td>' + (w.watchlistedBy || 'Unknown') + '</td><td>' + w.eventCount + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="error-text">No watchlist entries</td></tr>';
}

function renderBlacklist() {
  if (!D) return;
  const q = document.getElementById('blacklist-filter').value.toLowerCase();
  const rows = D.blacklist.filter(b => b.userId.includes(q) || b.reason.toLowerCase().includes(q) || (D.profiles.find(p => p.userId === b.userId)?.username || '').toLowerCase().includes(q));
  document.getElementById('blacklist-body').innerHTML = rows.map(b => '<tr><td>' + b.userId + '</td><td>' + (D.profiles.find(p => p.userId === b.userId)?.username || 'Unknown') + '</td><td>' + b.reason + '</td><td>' + b.addedBy + '</td><td>' + new Date(b.addedAt).toLocaleDateString() + '</td></tr>').join('') || '<tr><td colspan="5" class="error-text">No blacklist entries</td></tr>';
}

function renderServers() {
  if (!D) return;
  const q = document.getElementById('servers-filter').value.toLowerCase();
  const rows = D.serverStats.filter(s => s.name.toLowerCase().includes(q) || s.serverId.includes(q));
  document.getElementById('servers-body').innerHTML = rows.map(s => '<tr><td>' + s.name + '</td><td>' + s.serverId + '</td><td>' + (s.subjects || 0) + '</td><td>' + (s.flagged || 0) + '</td><td>' + (s.cases || 0) + '</td></tr>').join('') || '<tr><td colspan="5" class="error-text">No servers found</td></tr>';
}

function renderCharts() {
  if (!D) return;
  const riskLabels = D.riskDist.map(r => r.label);
  const riskData = D.riskDist.map(r => r.count);
  const caseLabels = D.caseDist.map(c => c.status);
  const caseData = D.caseDist.map(c => c.count);
  const trendLabels = Object.keys(D.trend);
  const trendData = Object.values(D.trend);

  if (charts.risk) charts.risk.destroy();
  charts.risk = new Chart(document.getElementById('riskChart'), { type:'bar', data:{ labels:riskLabels, datasets:[{label:'Subjects', data:riskData, backgroundColor:'rgba(0,255,136,.24)', borderColor:'#00ff88', borderWidth:1 }]}, options:{responsive:true,plugins:{legend:{display:false},tooltip:{mode:'index'}}}});

  if (charts.case) charts.case.destroy();
  charts.case = new Chart(document.getElementById('caseChart'), { type:'doughnut', data:{ labels:caseLabels, datasets:[{data:caseData, backgroundColor:['#00ff88','#ffaa00','#ff5a5a'], borderColor:'#0f1d31', borderWidth:1}]}, options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:'#c7d8ef'}}}}});

  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(document.getElementById('trendChart'), { type:'line', data:{ labels:trendLabels, datasets:[{label:'Cases opened', data:trendData, backgroundColor:'rgba(0,255,136,.16)', borderColor:'#00ff88', tension:0.35, fill:true, pointRadius:3 }]}, options:{responsive:true,scales:{x:{ticks:{color:'#c7d8ef'},grid:{color:'rgba(255,255,255,.06)'}},y:{ticks:{color:'#c7d8ef'},grid:{color:'rgba(255,255,255,.06)'},beginAtZero:true}}}});
}

function exportCSV(type) {
  if (!D) return;
  const map = {
    profiles: { keys:['userId','username','riskLevel','clearance','watchlisted','blacklisted','createdAt'], rows:D.profiles },
    cases: { keys:['caseId','title','status','createdAt','closedAt'], rows:D.cases },
    watchlist: { keys:['userId','watchlistedAt','watchlistedBy','eventCount'], rows:D.watchlist },
    blacklist: { keys:['userId','reason','addedBy','addedAt'], rows:D.blacklist },
    servers: { keys:['serverId','name','subjects','flagged','cases'], rows:D.serverStats }
  };
  const payload = map[type];
  if (!payload) return;
  const csv = [payload.keys.join(','), ...payload.rows.map(row => payload.keys.map(k => '"' + String(row[k] ?? '').replace(/"/g,'""') + '"').join(','))].join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'sentinel-' + type + '.csv';
  link.click();
}

function exportAll() {
  if (!D) return;
  const blob = new Blob([JSON.stringify(D, null, 2)], { type:'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'sentinel-dashboard-export.json';
  link.click();
}

async function submitAction(type) {
  const resultElement = document.getElementById('action-' + type + '-result') || document.getElementById('action-watch-result');
  const payload = { action:type };
  if (type === 'reopen' || type === 'close') payload.caseId = document.getElementById('action-case-id').value.trim();
  if (type === 'disable-notify') {
    payload.userId = document.getElementById('action-user-id').value.trim();
    payload.serverId = document.getElementById('action-server-id').value.trim();
  }
  if (type === 'remove-watchlist') payload.userId = document.getElementById('action-user-id').value.trim();
  if (type === 'blacklist-user') {
    payload.userId = document.getElementById('action-blacklist-user').value.trim();
    payload.reason = document.getElementById('action-blacklist-reason').value.trim();
  }
  if (type === 'unblacklist-user') payload.userId = document.getElementById('action-blacklist-user').value.trim();

  try {
    const res = await fetch('/api/action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok) {
      resultElement.innerHTML = '<span class="success-text">' + data.message + '</span>';
      fetchData();
    } else {
      resultElement.innerHTML = '<span class="error-text">' + data.error + '</span>';
    }
  } catch (err) {
      resultElement.innerHTML = '<span class="error-text">Network error</span>';
}

async function logout() {
  await fetch('/logout', { method:'POST' });
  window.location.reload();
}

fetchData();
</script>
</body>
</html>`;
}

function buildErrorPage(message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dashboard Error</title></head><body><pre>${message}</pre></body></html>`;
}

async function handleAction(req, res) {
  if (!auth.isAuthenticated(req)) {
    res.writeHead(401, responseHeaders(req, 'application/json'));
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const { action, caseId, userId, serverId, reason, csrfToken } = body;
    
    // ⚠️ SECURITY: Validate CSRF token on all state-changing requests
    const sessionToken = auth.getSessionToken(req);
    if (!sessionToken || !validateCSRFToken(sessionToken, csrfToken)) {
      logger.warn('dashboard-action', '🔴 CSRF token validation failed', { 
        action, 
        ip: auth.getClientIP(req),
        hasToken: !!csrfToken 
      });
      res.writeHead(403, responseHeaders(req, 'application/json'));
      res.end(JSON.stringify({ error: 'CSRF validation failed. Please try again.' }));
      return;
    }
    
    let result = null;

    switch (action) {
      case 'reopen':
        if (!caseId) throw new Error('caseId is required');
        result = db.reopenCase(caseId, 'dashboard');
        if (!result) throw new Error('Case not found');
        if (result.error) throw new Error(result.error === 'NOT_CLOSED' ? 'Case is not closed' : result.error);
        res.writeHead(200, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ message: `Case ${caseId} reopened.` }));
        return;
      case 'close':
        if (!caseId) throw new Error('caseId is required');
        result = db.closeCase(caseId, 'dashboard');
        if (!result) throw new Error('Case not found');
        if (result.error) throw new Error(result.error === 'ALREADY_CLOSED' ? 'Case is already closed' : result.error);
        res.writeHead(200, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ message: `Case ${caseId} closed.` }));
        return;
      case 'disable-notify':
        if (!userId || !serverId) throw new Error('userId and serverId are required');
        result = db.disableNotify(userId, serverId);
        if (result.notEnabled) throw new Error('Notifications are not enabled for this subject/server');
        res.writeHead(200, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ message: `Notifications disabled for user ${userId} on server ${serverId}.` }));
        return;
      case 'remove-watchlist':
        if (!userId) throw new Error('userId is required');
        result = db.removeFromWatchlist(userId);
        if (result.notWatched) throw new Error('Subject is not on the watchlist');
        res.writeHead(200, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ message: `User ${userId} removed from watchlist.` }));
        return;
      case 'blacklist-user':
        if (!userId || !reason) throw new Error('userId and reason are required');
        db.addToBlacklist(userId, reason, 'dashboard');
        res.writeHead(200, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ message: `User ${userId} blacklisted.` }));
        return;
      case 'unblacklist-user':
        if (!userId) throw new Error('userId is required');
        if (!db.removeFromBlacklist(userId)) throw new Error('User is not blacklisted');
        res.writeHead(200, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ message: `User ${userId} removed from blacklist.` }));
        return;
      default:
        throw new Error('Unknown action');
    }
  } catch (err) {
    logger.warn('dashboard-action', '🔴 Action failed', { error: err.message });
    res.writeHead(400, responseHeaders(req, 'application/json'));
    res.end(JSON.stringify({ error: err.message }));
  }
}

function startDashboard() {
  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathName = parsed.pathname;
    const secure = isSecureRequest(req);

    if (pathName === '/auth' && req.method === 'POST') {
      try {
        if (auth.isRateLimited(auth.getClientIP(req))) {
          logger.warn('dashboard-auth', '🔴 Rate limited login attempt from', auth.getClientIP(req));
          res.writeHead(429, responseHeaders(req, 'application/json'));
          res.end(JSON.stringify({ error: 'Too many login attempts, try again later.' }));
          return;
        }

        const { password } = await parseJsonBody(req);
        if (password === PASSWORD) {
          auth.clearAttempts(auth.getClientIP(req));
          const token = auth.createSession();
          const csrfToken = createCSRFToken(token);  // ⚠️ SECURITY: Generate CSRF token
          const cookieParts = [`sn_token=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/'];
          if (secure) cookieParts.push('Secure');
          res.writeHead(200, { ...responseHeaders(req, 'application/json'), 'Set-Cookie': cookieParts.join('; ') });
          res.end(JSON.stringify({ ok: true, csrfToken }));  // ⚠️ SECURITY: Return CSRF token
          logger.info('dashboard-auth', 'Login success from', auth.getClientIP(req));
          return;
        }

        auth.recordFailedAttempt(auth.getClientIP(req));
        logger.warn('dashboard-auth', '🔴 Invalid password attempt from', auth.getClientIP(req));
        res.writeHead(401, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ error: 'Invalid password' }));
      } catch (err) {
        logger.warn('dashboard-auth', '🔴 Malformed auth request', { error: err.message });
        res.writeHead(400, responseHeaders(req, 'application/json'));
        res.end(JSON.stringify({ error: 'Malformed request' }));
      }
      return;
    }

    if (pathName === '/logout' && req.method === 'POST') {
      const token = auth.getSessionToken(req);
      if (token) auth.deleteSession(token);
      const cookieParts = ['sn_token=; Path=/; Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
      if (secure) cookieParts.push('Secure');
      res.writeHead(200, { ...responseHeaders(req, 'application/json'), 'Set-Cookie': cookieParts.join('; ') });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (!auth.isAuthenticated(req)) {
      res.writeHead(200, responseHeaders(req, 'text/html'));
      res.end(buildLoginPage());
      return;
    }

    if (pathName === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      }));
      return;
    }

    if (pathName === '/api/data' && req.method === 'GET') {
      res.writeHead(200, responseHeaders(req, 'application/json'));
      res.end(JSON.stringify(getAllData()));
      return;
    }

    if (pathName === '/api/action' && req.method === 'POST') {
      await handleAction(req, res);
      return;
    }

    if (pathName === '/api/export/json' && req.method === 'GET') {
      const payload = JSON.stringify(getAllData(), null, 2);
      res.writeHead(200, {
        ...responseHeaders(req, 'application/json'),
        'Content-Disposition': 'attachment; filename="sentinel-export.json"'
      });
      res.end(payload);
      return;
    }

    if (pathName === '/' && req.method === 'GET') {
      res.writeHead(200, responseHeaders(req, 'text/html'));
      res.end(buildDashboardPage());
      return;
    }

    res.writeHead(404, responseHeaders(req, 'text/plain'));
    res.end('Not found');
  });

  server.listen(PORT, () => {
    const env = process.env.NODE_ENV || 'development';
    const isProduction = env === 'production';
    const protocol = isProduction ? 'https' : 'http';
    
    logger.info('dashboard', `🚀 Dashboard server started on ${protocol}://localhost:${PORT} (${env})`);
    logger.info('dashboard', `📊 Health check available: GET /health`);
    
    if (!PASSWORD) {
      logger.error('dashboard', '❌ DASHBOARD_PASSWORD not configured - dashboard may be inaccessible');
    }
  });

  return server;
}

module.exports = { startDashboard };
if (require.main === module) startDashboard();
