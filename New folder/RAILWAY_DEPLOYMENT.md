# Railway Deployment Guide - Sentinel Bot

**Status**: ✅ Ready for deployment with security hardening complete

---

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Railway account at https://railway.app
- Git repository with this code
- Environment variables prepared

### Step 1: Connect Repository
```bash
# Login to Railway CLI
npm install -g @railway/cli
railway login

# Initialize project in your repo directory
cd sentinel-bot
railway init

# Link to existing Railway project (if you have one)
railway link
```

### Step 2: Configure Secrets in Railway Dashboard
Railway automatically detects and uses `railway.yaml` and `Dockerfile`.

**Navigate to**: Railway Dashboard → Your Project → Variables

Add these secrets:
```
DISCORD_TOKEN          = <your-rotated-bot-token>
CLIENT_ID              = 1489700810924494999
GUILD_ID               = 1458586026699132971
SN_SERVER_ID           = 1458586026699132971
SN_ALERT_CHANNEL_ID    = 1490087293006905435
SN_AUDIT_CHANNEL_ID    = 1490087447902556410
SYSTEM_OWNER_ID        = 1449460736802689034
DASHBOARD_PASSWORD     = <strong-random-16+-char-password>
NODE_ENV               = production
LOG_LEVEL              = info
```

### Step 3: Configure Volume
Railway automatically maps volumes defined in `railway.yaml`.

The `/app/data` directory is automatically persisted across container restarts.

### Step 4: Deploy
```bash
# Deploy to Railway
railway up

# View logs
railway logs

# Check deployment status
railway status
```

---

## ✅ Pre-Deployment Checklist

- [ ] **Rotate Discord Token**
  - Delete old token in Discord Developer Portal
  - Create new bot token
  - Store in Railway Secrets (not in code)

- [ ] **Set Strong Dashboard Password**
  - Minimum 16 characters
  - Mix of: UPPERCASE, lowercase, numbers, symbols
  - NO dictionary words, usernames, or project names
  - Example: `Pr0t3ct3d!S3nt1n3l#2024`

- [ ] **Review Secrets**
  - All Discord IDs correct
  - SYSTEM_OWNER_ID set
  - No .env file committed to Git

- [ ] **Test Locally (Optional)**
  ```bash
  # Build and test Docker image locally
  docker build -t sentinel-bot:test .
  docker run --env-file=.env --mount type=volume,source=test-data,target=/app/data sentinel-bot:test
  ```

---

## 🔐 Security After Deployment

### 1. Set Custom Domain (HTTPS)
Railway provides free SSL/TLS. Configure custom domain:
- Railway Dashboard → Project → Environment → Domains
- Add your custom domain (e.g., `sentinel.your-domain.com`)
- SSL certificate auto-provisioned

### 2. Configure Firewall (Optional)
- Only expose dashboard through your domain
- Disable direct IP access if possible

### 3. Monitor Health
- Railway Dashboard shows:
  - CPU/Memory usage
  - Deployment status
  - Error rate
  - Response times
- Health check endpoint: `GET /health`

### 4. Configure Alerts
Set up Railway email alerts for:
- Deployment failures
- High resource usage
- Crashes

---

## 📊 Monitoring & Logs

### View Logs
```bash
# Using Railway CLI
railway logs                    # Real-time logs
railway logs --follow          # Stream mode

# Or in Railway Dashboard: Environment → Logs tab
```

### Key Log Markers (Search in logs)
- `🚀 Dashboard server started` — Dashboard is running
- `Connecting to Discord` — Bot connecting
- `Commands registered globally` — Commands deployed
- `🔴 CSRF token validation failed` — Security issue detected
- `❌ PRODUCTION MODE: DASHBOARD_PASSWORD` — Password not set

### Health Check
```bash
# Test health endpoint (replace with your Railway domain)
curl https://sentinel.your-domain.com/health

# Response (if healthy):
{
  "status": "ok",
  "uptime": 3600.23,
  "timestamp": "2026-06-23T12:00:00Z",
  "environment": "production"
}
```

---

## 🔧 Troubleshooting

### Bot Won't Start
**Error**: `DISCORD_TOKEN not found`
```
Fix: Add DISCORD_TOKEN to Railway Secrets
```

**Error**: `DASHBOARD_PASSWORD must be set`
```
Fix: Add strong DASHBOARD_PASSWORD in Railway Secrets
```

### Data Lost After Restart
**Cause**: Volume not properly configured
```
Fix: Check railway.yaml - /app/data volume must be defined
```

### Dashboard Not Accessible
**Check**:
1. Health endpoint: `GET /health` returns 200
2. Custom domain configured
3. SSL certificate active (check Railway dashboard)
4. DASHBOARD_PASSWORD set in secrets

---

## 🆘 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| `Error: listen EADDRINUSE` | Port 3000 already in use | Railway auto-assigns, shouldn't happen |
| `Cannot find module 'discord.js'` | Dependencies not installed | `npm ci` runs automatically in Docker |
| `ENOSPC: no space left on device` | Out of disk space | Check Railway storage, clear logs if needed |
| `Bot not responding to commands` | Discord token expired | Rotate token in Developer Portal, update Railway Secrets |
| `Dashboard login fails` | Wrong password in secrets | Verify `DASHBOARD_PASSWORD` value |

---

## 📈 Performance Optimization

Railway automatically scales, but for best performance:

### Memory Limits
Default: 512MB (sufficient for small to medium workloads)
- Increase to 1GB for 100k+ profiles: Railway dashboard → Plan

### CPU
Default: Shared (sufficient)
- Upgrade to dedicated CPU if needed

### Database Optimization
- Keep JSON files backed up (don't rely on Railway storage alone)
- Archive old logs monthly
- Implement retention policy (90 days default)

---

## 🔄 Updates & Maintenance

### Deploy New Version
```bash
# After code changes
git add .
git commit -m "Security: Add CSRF protection and request limits"
git push origin main

# Railway auto-deploys on push (if connected via GitHub)
# Or manually:
railway up
```

### Backup Before Update
```bash
# Download current data
railway exec -- cp -r /app/data ./data-backup-$(date +%s)
```

### Rollback
Railway keeps deployment history:
- Railway Dashboard → Deployments → Previous versions
- Click to rollback instantly

---

## 📝 Environment Variables Reference

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `DISCORD_TOKEN` | Yes | `MTQ4OTc...` | Rotated token, 72+ chars |
| `CLIENT_ID` | Yes | `1489700810924494999` | From Discord Developer Portal |
| `GUILD_ID` | Yes | `1458586026699132971` | Main server ID |
| `SN_SERVER_ID` | Yes | `1458586026699132971` | Same as GUILD_ID usually |
| `SN_ALERT_CHANNEL_ID` | Yes | `1490087293006905435` | For alerts |
| `SN_AUDIT_CHANNEL_ID` | Yes | `1490087447902556410` | For audit logs |
| `SYSTEM_OWNER_ID` | Yes | `1449460736802689034` | Your Discord user ID |
| `DASHBOARD_PASSWORD` | Yes | `Pr0t3ct3d!...` | 16+ chars, strong |
| `NODE_ENV` | No | `production` | Recommended: `production` |
| `LOG_LEVEL` | No | `info` | Options: debug, info, warn, error |

---

## 🎯 Next Steps After Deployment

1. **Test Dashboard Login**
   - Navigate to your custom domain
   - Login with dashboard password
   - Verify CSRF protection working (no "CSRF failed" errors in logs)

2. **Verify Discord Connection**
   - Bot should be online in Discord
   - Test a command: `/help`
   - Check audit channel for alerts

3. **Monitor First 24 Hours**
   - Watch logs for errors
   - Verify data persistence (restart container, data remains)
   - Check resource usage (CPU < 50%, Memory < 200MB)

4. **Schedule Regular Backups**
   - Download `/data` daily
   - Store in secure location
   - Test restore procedure monthly

---

## 📞 Support Resources

- **Railway Docs**: https://docs.railway.app/
- **Discord.js Guide**: https://discordjs.guide/
- **Node.js Alpine**: https://hub.docker.com/r/library/node/
- **Security Issues**: Review `SECURITY_AUDIT_FULL.md`

---

**Last Updated**: 2026-06-23  
**Version**: 1.0 (Initial Railway Support)  
**Status**: ✅ Production-Ready
