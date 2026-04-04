# 🛰️ SENTINEL NETWORK — Discord Bot

A production-ready Discord bot simulating a federal investigation and surveillance system.

---

## 📦 SETUP INSTRUCTIONS

### 1. Prerequisites
- Node.js **v18 or higher** — https://nodejs.org
- A Discord account with Developer Mode enabled

### 2. Create Your Discord Application
"token": "
1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "Sentinel Network"
3. Go to **Bot** tab → click **Add Bot** → confirm
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Click **Reset Token** → copy the token

### 3. Get Your IDs

**Client ID:**
- Developer Portal → your app → **General Information** → Application ID

**Guild ID (Server ID):**
- In Discord, right-click your server → **Copy Server ID**
- (Enable Developer Mode: User Settings → Advanced → Developer Mode)

### 4. Configure the Bot

Edit `config.json`:

```json
{
  "token": "YOUR_BOT_TOKEN_HERE",
  "clientId": "YOUR_CLIENT_ID_HERE",
  "guildId": "YOUR_GUILD_ID_HERE",
  ...
}
```

### 5. Invite the Bot to Your Server

Go to:
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=277025392640
```
Replace `YOUR_CLIENT_ID` with your actual client ID.

Required permissions:
- Read Messages / View Channels
- Send Messages
- Embed Links
- Read Message History
- Use Slash Commands

### 6. Install Dependencies

```bash
npm install
```

### 7. Run the Bot

```bash
npm start
```

Or for auto-restart on file changes (Node 18+):
```bash
npm run dev
```

---

## 🎮 COMMAND REFERENCE

### 👤 Profile System `/profile`

| Command | Clearance | Description |
|---------|-----------|-------------|
| `/profile create [user]` | Level 1 | Create a new subject profile |
| `/profile view [user]` | Level 1 | View a subject's dossier |
| `/profile add-note [user] [text]` | Level 2 | Append an intelligence note |
| `/profile flag [user] [level]` | Level 3 | Apply a threat flag |

**Flag levels:** `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`

---

### 📁 Case System `/case`

| Command | Clearance | Description |
|---------|-----------|-------------|
| `/case open [title]` | Level 2 | Open a new investigation |
| `/case add-evidence [caseId] [text]` | Level 2 | File evidence to a case |
| `/case assign [caseId] [user]` | Level 3 | Assign an agent to a case |
| `/case close [caseId]` | Level 3 | Close an investigation |

Case IDs are auto-generated: `CASE-0001`, `CASE-0002`, etc.

---

### 📡 Surveillance System `/watch`

| Command | Clearance | Description |
|---------|-----------|-------------|
| `/watch add [user]` | Level 3 | Place a user under surveillance |
| `/watch remove [user]` | Level 3 | Lift surveillance |
| `/watch log [user] [limit]` | Level 2 | View activity log |

Watched users have their messages, joins, and leaves automatically logged.

---

### 🔐 Admin System `/admin`

| Command | Clearance | Description |
|---------|-----------|-------------|
| `/admin promote [user] [level]` | Level 4 | Set clearance level |
| `/admin audit` | Level 3 | Full system audit report |

---

## 🔐 CLEARANCE LEVELS

| Level | Title |
|-------|-------|
| 1 | Basic |
| 1.5 | Trainee Agent |
| 2 | Agent |
| 2.5 | Special Agent |
| 3 | Senior Agent |
| 3.5 | Assistant Supervisor |
| 4 | Supervisor |
| 4.5 | Deputy Director |
| 5 | Director |
| 6 | System Owner |

All new profiles start at **Level 1**. Use `/admin promote` to elevate agents.

> ⚠️ You cannot promote someone to a level equal to or higher than your own (unless you are Level 6).

---

## 📂 FILE STRUCTURE

```
/sentinel-bot
├── index.js              ← Main bot entry, command loader, event listeners
├── config.json           ← Bot token, IDs, theme colors
├── package.json
├── /commands
│   ├── /profile
│   │   └── index.js      ← /profile command group
│   ├── /case
│   │   └── index.js      ← /case command group
│   ├── /watch
│   │   └── index.js      ← /watch command group
│   └── /admin
│       └── index.js      ← /admin command group
├── /modules
│   ├── database.js       ← JSON read/write, profile CRUD
│   ├── investigation.js  ← Case management logic
│   ├── surveillance.js   ← Watchlist and event logging
│   └── permissions.js    ← Clearance checking middleware
└── /data
    ├── profiles.json     ← Subject profiles
    ├── cases.json        ← Investigation cases
    └── logs.json         ← Surveillance logs
```

---

## 📖 EXAMPLE WORKFLOW

```
1. /profile create @SuspectUser
   → Creates a profile for the target

2. /case open "Operation Nightfall"
   → Opens CASE-0001

3. /case add-evidence CASE-0001 "Subject was seen near the reactor at 0200 hrs"
   → Files evidence, status moves to UNDER REVIEW

4. /watch add @SuspectUser
   → All their messages, joins, and leaves are now logged

5. /profile flag @SuspectUser HIGH reason:"Spotted near restricted area"
   → Flags the subject, auto-updates their risk level

6. /watch log @SuspectUser limit:15
   → Shows last 15 surveillance events

7. /admin audit
   → Full system report: subjects, cases, watchlist, clearance distribution

8. /case close CASE-0001
   → Archives the investigation
```

---

## 🛠️ EXTENDING THE BOT

To add a new command group:
1. Create `/commands/yourgroup/index.js`
2. Export `{ data: SlashCommandBuilder, execute: async (interaction) => {} }`
3. Add clearance requirements to `modules/permissions.js → COMMAND_CLEARANCE`
4. Restart the bot — it auto-loads all command folders

---

## ⚠️ NOTES

- Data is stored as JSON files in `/data`. For production scale, swap `database.js` with a proper DB (SQLite, PostgreSQL, etc.)
- Slash commands are registered per-guild (instant). Global registration takes up to 1 hour.
- The `MessageContent` intent requires verification if your bot is in 100+ servers.
