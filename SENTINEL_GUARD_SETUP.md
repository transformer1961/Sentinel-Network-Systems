# 🛡️ SENTINEL GUARD - IMPLEMENTATION GUIDE

**Status**: Complete Implementation Ready  
**Version**: 4.0 (Website-Integrated)  
**Date**: 2026-09-01

---

## 🎯 WHAT YOU NOW HAVE

### ✅ New Files Created:
1. **`modules/sentinelGuard.js`** - Core guard module with threat detection
2. **`commands/admin/sentinel-guard.js`** - Discord slash command interface
3. **`dashboard/guardRoutes.js`** - API endpoints for website integration

### 🎨 Features Implemented:
- ✓ Real-time threat detection & analysis
- ✓ Raid detection system
- ✓ Suspicious user flagging
- ✓ Auto-protection with escalation
- ✓ Emergency lockdown capability
- ✓ Security policy management
- ✓ Web control panel dashboard
- ✓ REST API for website integration
- ✓ Global threat level tracking
- ✓ Detailed security reports

---

## 📋 INTEGRATION STEPS

### STEP 1: Enable the Sentinel Guard Module in index.js

Add this line near the top of `index.js` (after other requires):

```javascript
const sentinelGuard = require('./modules/sentinelGuard');
```

### STEP 2: Initialize Guard on Guild Join

Find the `guildCreate` event handler or add this in `index.js`:

```javascript
// When bot joins a new server
client.on('guildCreate', guild => {
  sentinelGuard.initializeServer(guild.id);
  logger.info('boot', `🛡️ Initialized Sentinel Guard for server: ${guild.id}`);
});
```

### STEP 3: Integrate with Message Event Handler

Modify `events/messageCreate.js` to track suspicious activity:

```javascript
// Add near the top of the message handler
const sentinelGuard = require('../modules/sentinelGuard');

// Add this in the message processing logic:
// Analyze user for suspicious patterns
const analysis = sentinelGuard.analyzeUserThreat(
  message.author.id, 
  'message_sent',
  { serverId: message.guildId, content: message.content }
);

// If user flagged as high threat, log it
if (analysis.flagged) {
  logger.warn('security', `🚨 User ${message.author.id} flagged (score: ${analysis.score})`);
}
```

### STEP 4: Integrate with Member Add Event

Modify `events/guildMemberAdd.js` to detect raids:

```javascript
// Add near the top
const sentinelGuard = require('../modules/sentinelGuard');

// Add this in the member join handler:
// Detect raid patterns
const raidCheck = sentinelGuard.detectRaid(
  interaction.guildId,
  member.user.id,
  'join'
);

if (raidCheck.detected) {
  logger.critical('security', `🚨 RAID DETECTED: ${raidCheck.joinCount} joins in ${raidCheck.duration}s`);
  sentinelGuard.setThreatLevel(member.guild.id, 'high', 'Raid detected');
  // Send alert to HQ channel
}
```

### STEP 5: Integrate Dashboard with Guard Routes

Modify `dashboard/server.js` to add guard routes (add this after existing route definitions):

```javascript
// Add at the top of dashboard/server.js
const guardRoutes = require('./guardRoutes');

// Add this after other route definitions (around line 200):
// Setup Sentinel Guard API routes
guardRoutes.setupRoutes(app, config);

logger.info('dashboard', '✓ Sentinel Guard API routes loaded');
```

### STEP 6: Enable Commands in index.js

The command will auto-load if your command loader includes all files. Verify by checking that the `/commands` folder recursion includes:
```
/commands/admin/sentinel-guard.js
```

This should auto-load with your existing command system.

---

## 🚀 USAGE GUIDE

### Discord Bot Commands

#### View Status:
```
/sentinel-guard status
```
Shows current threat level and security metrics for the server.

#### Generate Report:
```
/sentinel-guard report
```
Detailed security report with threat history and suspicious users.

#### Enable/Disable Protection:
```
/sentinel-guard protect enabled:true
/sentinel-guard protect enabled:false
```

#### Set Threat Level:
```
/sentinel-guard threat level:critical reason:"Detected raid activity"
```

#### Activate Lockdown:
```
/sentinel-guard lockdown duration:30
```
Emergency lockdown for 30 minutes (max 1440 minutes = 24 hours).

#### Manage Policies:
```
/sentinel-guard policy policy:"Raid Threshold" value:5
```

#### Monitor Suspicious Users:
```
/sentinel-guard monitor limit:10
```

#### Access Control Panel:
```
/sentinel-guard control-panel
```
Get link to web-based management dashboard.

---

### Web Control Panel

#### Access:
```
http://localhost:3000/control-panel
```
(or your production domain)

#### Features:
- 📊 Real-time threat overview
- 🖥️ Server status table with quick controls
- 🎮 Threat level management
- 🔐 Emergency lockdown activation
- 🚫 Flagged users management
- 📈 Threat statistics and graphs
- 🔄 Auto-refresh every 30 seconds

---

### API Endpoints (For Website Integration)

All endpoints require authentication (session/token).

#### Get Global Status:
```
GET /api/guard/status
```
Returns threat levels for all servers and flagged users.

#### Get Server Status:
```
GET /api/guard/server/:serverId
```
Detailed report for specific server.

#### List All Servers:
```
GET /api/guard/servers
```
Quick status of all protected servers.

#### Get Threat Summary:
```
GET /api/guard/threats
```
Current threats across network.

#### List Flagged Users:
```
GET /api/guard/flagged-users?limit=50
```

#### Set Threat Level:
```
POST /api/guard/threat-level
Body: {
  "serverId": "123456789",
  "level": "critical",
  "reason": "Raid detected"
}
```

#### Toggle Protection:
```
POST /api/guard/protection
Body: {
  "serverId": "123456789",
  "enabled": true
}
```

#### Activate Lockdown:
```
POST /api/guard/lockdown
Body: {
  "serverId": "123456789",
  "duration": 3600  // seconds
}
```

#### Cancel Lockdown:
```
POST /api/guard/lockdown/cancel
Body: {
  "serverId": "123456789"
}
```

#### Update Policy:
```
POST /api/guard/policy
Body: {
  "serverId": "123456789",
  "policyName": "raidThreshold",
  "value": 5
}
```

#### Clear User Flag:
```
POST /api/guard/user/clear-flag
Body: {
  "userId": "987654321"
}
```

---

## 📊 DATA STRUCTURES

### Threat Analysis Results:
```javascript
{
  threat: "low|medium|high",      // Threat level
  score: 0-100,                    // Threat score
  flagged: true/false              // If user is flagged
}
```

### Security Report:
```javascript
{
  serverId: "123456789",
  threatLevel: "medium",
  protectionEnabled: true,
  lockdownActive: false,
  policies: {
    raidThreshold: 5,
    suspiciousJoinThreshold: 3,
    maxFailedLogins: 5,
    requireVerification: false
  },
  stats: {
    totalThreats: 42,
    recentThreats: 3,
    flaggedUsers: 2,
    raidDetected: false,
    raidJoinCount: 0
  },
  lastUpdate: "2026-09-01T12:00:00Z"
}
```

### Threat Actions:
- `'new_account'` - 10 points
- `'mass_joins'` - 20 points
- `'permission_escalation_attempt'` - 30 points
- `'blacklist_bypass_attempt'` - 25 points
- And more (see sentinelGuard.js for full list)

---

## 🔧 CONFIGURATION

### Policy Settings (in sentinelGuard module):

```javascript
policies: {
  raidThreshold: 5,                // users joining per minute
  suspiciousJoinThreshold: 3,      // suspicious joins in 5 min
  maxFailedLogins: 5,              // before lockout
  requireVerification: false,      // for new members
  verificationLevel: 1             // 0=none, 1=email, 2=phone, 3=id
}
```

### Customize via Command:
```
/sentinel-guard policy policy:"Raid Threshold" value:10
```

---

## ⚡ AUTO-PROTECTION ACTIONS

When threat level escalates, automatic actions trigger:

### Medium Threat:
- ✓ Increase monitoring
- ⚠️ Alert staff to suspicious activity

### High Threat:
- ⚠️ Alert staff to potential threat
- 🔒 Require verification for new users
- 🚫 Disable public commands

### Critical Threat:
- 🔐 Activate emergency lockdown
- 🚫 Restrict all non-staff access
- 🚨 Alert HQ immediately
- 💾 Archive all activity logs

---

## 📱 WEBSITE INTEGRATION EXAMPLE

### Connect to Your Website Backend:

```javascript
// Your website backend (Node.js example)
const axios = require('axios');

// Get guard status
async function getGuardStatus() {
  const response = await axios.get('http://bot-domain:3000/api/guard/status', {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Cookie': 'session=YOUR_SESSION'
    }
  });
  return response.data;
}

// Set threat level
async function setServerThreat(serverId, level) {
  const response = await axios.post('http://bot-domain:3000/api/guard/threat-level', {
    serverId,
    level,
    reason: 'Updated via website'
  }, {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Cookie': 'session=YOUR_SESSION'
    }
  });
  return response.data;
}
```

### Embed Control Panel in Website:

```html
<!-- Embed control panel in iframe -->
<iframe 
  src="http://bot-domain:3000/control-panel"
  width="100%" 
  height="800px"
  style="border: none; border-radius: 8px;"
></iframe>
```

---

## 🧪 TESTING

### Test Threat Detection:
```javascript
const sentinelGuard = require('./modules/sentinelGuard');

// Analyze user behavior
const result = sentinelGuard.analyzeUserThreat(
  'userId123',
  'mass_joins',
  { serverId: 'server123' }
);

console.log(result); // { threat: 'medium', score: 20, flagged: false }
```

### Test Raid Detection:
```javascript
// Simulate raid
for (let i = 0; i < 6; i++) {
  const raid = sentinelGuard.detectRaid('server123', `user${i}`, 'join');
  console.log(raid);
  // Should detect after 5+ joins
}
```

### Test API Endpoint:
```bash
curl http://localhost:3000/api/guard/status \
  -H "Cookie: session=your_session_id"
```

---

## 🐛 TROUBLESHOOTING

### Guard module not loading:
- Verify `modules/sentinelGuard.js` exists
- Check require path is correct
- Look for errors in bot startup logs

### Commands not appearing:
- Restart bot with `/` to re-register commands
- Check command file is in `/commands/admin/`
- Verify command structure follows Discord.js standards

### API returning 401:
- Ensure you're authenticated to dashboard first
- Check session cookie is being sent
- Verify dashboard password is set

### Control panel not loading:
- Check `/api/guard/status` endpoint works
- Verify guard routes initialized in dashboard
- Check browser console for JavaScript errors

---

## 📈 MONITORING

### Check Guard Status Programmatically:
```javascript
const status = sentinelGuard.getAllServersStatus();
console.log(status);
// [{serverId, threatLevel, protectionEnabled, ...}, ...]
```

### Export Guard Data:
```javascript
const data = sentinelGuard.exportGuardData();
// Export for analytics/logging/archival
```

### Calculate Global Threat:
```javascript
const globalThreat = sentinelGuard.calculateGlobalThreat();
// Returns: 'low', 'medium', 'high', or 'critical'
```

---

## 🔐 SECURITY NOTES

1. **Authentication**: All API endpoints require dashboard login
2. **CSRF Protection**: Control panel uses CSRF tokens (in dashboard)
3. **Rate Limiting**: Implement rate limiting on API endpoints
4. **Lockdown**: Only admins can activate emergency lockdown
5. **Data**: Threat data is stored in-memory (cleared on restart)
   - For persistence, modify `sentinelGuard.js` to use database.js

---

## 🚀 NEXT STEPS

1. **Run Integration**:
   ```bash
   npm start
   ```

2. **Test Discord Command**:
   ```
   /sentinel-guard status
   ```

3. **Access Control Panel**:
   ```
   /sentinel-guard control-panel
   → Click link to open dashboard
   ```

4. **Monitor Events**:
   - Watch logs for guard activity
   - Check dashboard for real-time updates

5. **Configure Policies**:
   - Adjust thresholds for your servers
   - Test threat escalation

6. **Website Integration**:
   - Connect your website to API endpoints
   - Embed control panel iframe
   - Build custom dashboard

---

## 📞 SUPPORT

For issues or questions:
1. Check troubleshooting section above
2. Review integration steps
3. Check console logs for errors
4. Verify all files created correctly

---

**Sentinel Guard is now ready for deployment! 🛡️**

You now have a complete server protection system with:
- ✅ Real-time threat monitoring
- ✅ Automatic raid detection
- ✅ Web-based control panel
- ✅ Website API integration
- ✅ Emergency lockdown capability
- ✅ Centralized management

All accessible from Discord commands, web dashboard, and REST API!

