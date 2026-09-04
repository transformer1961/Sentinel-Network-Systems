# 🔐 Sentinel Bot — Comprehensive Security Audit Report

**Date:** 2026-04-30
**Status:** ✅ Stabilized with active hardening recommendations
**Reviewer:** Automated Security Review

---

## Executive Summary

The Sentinel Network bot has a mature command structure and a tightly scoped permission model. Recent fixes have corrected the highest-risk runtime issues:
- dashboard auth now uses a secure session module,
- config loading is centralized through `modules/config.js`,
- dashboard cookies and headers are hardened,
- a new lockdown and threat level system was added for HQ/local containment,
- the broken logger import was fixed.

This audit documents every command surface, data flow, and security control, and it highlights the remaining hardening items needed before production deployment.

---

## Scope

Audit scope includes:
- `index.js`
- runtime modules in `modules/`
- slash command definitions in `commands/`
- event processing in `events/`
- dashboard server in `dashboard/server.js`
- persistent JSON storage in `data/`
- security documentation in `audits/`
- setup automation in `scripts/`

---

## Security Hardening Completed

### Configuration
- Replaced raw runtime `require('./config.json')` usage with `require('./modules/config')` across the bot.
- `modules/config.js` now supports environment overrides for all critical values.
- `config.json` remains a local template file only.

### Dashboard authentication
- `dashboard/server.js` now delegates auth to `modules/dashboardAuth.js`.
- Session tokens use `crypto.randomBytes(32).toString('hex')` and are stored in `data/sessions.json`.
- Logout cleans the session and expires the cookie.

### Web security headers
- Added `Content-Security-Policy` locking down scripts, styles, images, and framing.
- Added `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, and `Permissions-Policy`.
- `Strict-Transport-Security` is applied when TLS is detected.

### Cookie hardening
- Auth cookies use `HttpOnly` and `SameSite=Strict`.
- `Secure` is added when the request is delivered over HTTPS or a proxy indicates TLS.

### Operational safety
- Startup now warns if the dashboard password is default or empty.
- Logger rotation and directory creation are enforced.
- All modified files pass `node --check` syntax validation.

---

## Command Inventory

### `/help`
- Shows all available commands and clearance requirements.

### `/setup`
- `alert_channel` — register this server's alert channel
- `hq_sync` — enable Sentinel HQ sync
- `audit_channel` — optional audit log channel

### `/report`
- `generate` — create a full intelligence report for a subject
- `summary` — generate a network-wide threat summary

### `/profile`
- `create` — create a subject profile
- `view` — view a subject dossier
- `add-note` — add a note to a profile
- `remove-note` — remove a note from a profile
- `flag` — flag a subject with severity
- `severity` — check a subject's risk level
- `escalate` — escalate a subject's severity (Director+ only)
- `search` — search profiles by filter

### `/case`
- `open` — open a new investigation case
- `view` — view case details
- `list` — list cases with optional status filter
- `add-evidence` — attach evidence to a case
- `assign` — assign an agent to a case
- `close` — close a case (Operations Lead+ only)

### `/watch`
- `add` — add a subject to the watchlist
- `remove` — remove a subject from the watchlist
- `log` — view surveillance activity for a subject
- `list` — list watched subjects
- `notify` — enable join notifications for a subject in this server

### `/admin`
- `promote` — promote an agent clearance level
- `demote` — demote an agent clearance level
- `audit` — view the system audit report
- `blacklist` — global user blacklist (Director+)
- `unblacklist` — remove a user from global blacklist (Director+)
- `setup` — configure this server's alert channel

### `/servers`
- `blacklist` — blacklist a Discord server (High Staff only)
- `lift` — lift a server blacklist restriction (High Staff only)
- `info` — view a server blacklist entry
- `list` — list blacklisted servers by status
- `appeal` — add an appeal note to a server entry
- `check` — check current server blacklist status

### `/lockdown`
- `enable` — activate local server lockdown
- `disable` — clear local lockdown
- `status` — inspect local lockdown status

### `/tls`
- `set` — assign a local threat level
- `view` — inspect local threat status

### `/hq`
- `lockdown force` — force an HQ lockdown on any server
- `lockdown clear` — clear an HQ lockdown
- `lockdown status` — view HQ lockdown state for a server
- `tls set` — set HQ threat level for a server
- `tls view` — inspect HQ threat status for a server
- `tls list` — list active HQ security state entries

---

## Threat Level Classes (TLC)

The Sentinel security model now supports a new classification layer for incidents alongside the existing threat severity system.

- **TLC-A** — Administrative
- **TLC-B** — Security
- **TLC-C** — Cyber
- **TLC-D** — Infrastructure
- **TLC-E** — Insider
- **TLC-F** — Intelligence
- **TLC-K** — Kepler-Class

This layer is intended to answer **"What type of incident is this?"** while Threat Levels continue to answer **"How severe is this incident?"**

---

## Kepler Protocol

Kepler Protocol is Sentinel's highest-level emergency response and infrastructure protection system. It is designed to protect Sentinel itself during catastrophic incidents that threaten the integrity, availability, or security of the platform.

**Kepler exists independently of Threat Levels, TLCs, and Lockdowns.**

### Purpose
- Prevent further compromise of Sentinel systems
- Preserve evidence for investigation
- Maintain infrastructure integrity
- Isolate affected components
- Coordinate recovery operations
- Restore services safely after verification

### Activation Requirements

**Manual Activation:**
- System Owner authorization
- Emergency Owner authorization (if delegated)

**Automatic Activation Indicators:**
- Confirmed bot token compromise
- Simultaneous compromise of multiple HQ systems
- Integrity verification failure of core binaries
- Critical configuration tampering
- Multiple independent TLC-K incidents
- Catastrophic infrastructure failure
- Widespread compromise across multiple servers

### Eight Phases

| Phase | Purpose | Key Actions |
|-------|---------|------------|
| **I — Alert** | Notify all systems and emergency personnel | Generate alerts, notify directors, record activation |
| **II — Isolation** | Prevent spread of compromise | Suspend sync, isolate services, restrict integrations |
| **III — Containment** | Stop potentially malicious activity | Freeze commands, restrict admin, lock operations |
| **IV — Lockdown** | Secure infrastructure | Disable dashboards, restrict HQ, suspend interfaces |
| **V — Preservation** | Protect evidence | Create forensic snapshots, secure logs, archive records |
| **VI — Verification** | Determine system integrity | Validate files, verify configs, check logs, confirm threat removal |
| **VII — Recovery** | Safely restore operations | Restore services, re-enable sync, reopen dashboards |
| **VIII — Stand Down** | Return to normal operation | Clear emergency, publish summary, archive reports |

### Kepler Commands

```
/kepler activate [reason]          — Activate Kepler Protocol (System Owner only)
/kepler deactivate [reason]        — Deactivate Kepler Protocol (System Owner only)
/kepler status                     — View current Kepler status
/kepler phase                      — Display current Kepler phase
/kepler advance [target]           — Advance to next phase (Director+ only)
/kepler snapshot [label]           — Create forensic snapshot (Director+ only)
/kepler diagnostics                — Run system diagnostics
/kepler simulate                   — Run training simulation (Director+ only)
```

### Authority Structure

- **System Owner** — Ultimate authority; can activate/deactivate Kepler and approve recovery
- **Emergency Owner** — Backup authority; assumes command if System Owner unavailable
- **HQ Director** — Coordinates HQ operations; can recommend activation but cannot execute it
- **Security Director** — Leads investigations; conducts forensic analysis; verifies compromise
- **Infrastructure Director** — Maintains stability; coordinates restoration and backups

### Recovery Requirements

Recovery should only begin when all of the following are true:
1. Threat has been contained
2. Integrity has been verified
3. Evidence has been preserved
4. Security Director has completed review
5. Infrastructure Director has validated systems
6. System Owner has approved restoration

### Implementation

- **Module:** `modules/kelplerProtocol.js`
- **Command:** `commands/kepler/index.js`
- **State File:** `data/kelplerState.json`
- **Audit Trail:** All Kepler events logged to `data/logs.json`

### Operational Principle

Kepler Protocol is intended for rare, high-impact events that threaten Sentinel itself. When active, security takes precedence over availability until verification and recovery are complete.

---

## Findings by Severity

### Critical

#### 1. Config module now centralized
- All runtime modules use `modules/config.js`.
- No runtime direct `config.json` imports remain.

#### 2. Secure dashboard session management
- `dashboard/server.js` uses the secure auth module.
- Session lifecycle is now managed in a dedicated module.

#### 3. Protected dashboard headers and cookie handling
- Browser and API responses now emit strong security headers.
- Cookie flags are hardened and TLS-aware.

### High

#### 4. Sensitive local config remains
- `config.json` is still required locally, but should never be committed.
- Secret material should be moved to environment variables.

#### 5. Data storage requires OS hardening
- `data/` contains profiles, cases, blacklist, watchlist, sessions, and server configs.
- Production must enforce filesystem permissions and encrypted backups.

#### 6. Dashboard auth remains password-based
- Single-factor password auth is a viable stopgap.
- Multi-factor or Discord-based auth should be considered next.

### Medium

#### 7. Session storage is plaintext JSON
- `data/sessions.json` persists session tokens in clear text.
- This is acceptable for a local deployment, but file permissions must be strict.

#### 8. Local lockdown/TLS status is stored in plaintext JSON
- `data/serverSecurity.json` now persists effective lockdown and threat level metadata.
- This state must remain protected and audited alongside other sensitive files.

#### 9. `data/` is the main sensitive persistence surface
- The simple JSON store is easy to inspect and modify.
- Hard access control and backups are mandatory.

---

## Hardening Recommendations

1. Deploy the dashboard behind HTTPS or a secure reverse proxy.
2. Move all secrets out of `config.json` into environment variables.
3. Restrict `data/` and `logs/` to the bot process user only.
4. Rotate the dashboard password frequently and avoid default values.
5. Add monitoring for failed dashboard login attempts and session anomalies.
6. Consider adding a secondary dashboard authentication factor.
7. Verify `config.example.json` only contains non-sensitive placeholder values.

---

## Observations and Next Actions

- The bot's command model is structurally sound and access-controlled.
- The dashboard is now much safer, but the platform remains operationally sensitive.
- The most important next step is environment-based secret delivery and encrypted storage hardening.

**Final verdict:** the application is functionally secure at the code level after the recent fixes, but it still needs deployment hardening around secrets, TLS, and JSON persistence.
