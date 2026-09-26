const crypto = require('crypto');

const INCIDENT_STATUS_MAP = {
  open: 'open',
  assigned: 'assigned',
  investigating: 'investigating',
  monitoring: 'monitoring',
  resolved: 'resolved',
  closed: 'closed',
};

function normalizeIncidentStatus(value) {
  const state = String(value ?? '').trim().toLowerCase();
  if (INCIDENT_STATUS_MAP[state]) return INCIDENT_STATUS_MAP[state];
  if (state === 'acknowledged') return 'assigned';
  if (state === 'active') return 'open';
  if (state === 'done') return 'resolved';
  return 'open';
}

function buildIncidentPayload({ title, severity, reason, owner, guildId, status = 'open' }) {
  return {
    title,
    severity: severity || 'medium',
    reason,
    owner,
    guildId,
    status: normalizeIncidentStatus(status),
  };
}

function getIncidentApiConfig() {
  const config = {
    url: process.env.SNS_CORE_API_URL,
    botId: process.env.SENTINEL_SNS_BOT_ID,
    botToken: process.env.SENTINEL_SNS_BOT_TOKEN,
    secret: process.env.BOT_WEBHOOK_SECRET,
  };

  const configured = Boolean(config.url && config.botId && config.botToken && config.secret);
  return { ...config, configured };
}

function createSignedRequestPayload(body, secret) {
  const raw = JSON.stringify(body);
  const requestId = crypto.randomUUID();
  const timestamp = String(Date.now());
  const signedMessage = `${timestamp}.${requestId}.${raw}`;
  return {
    raw,
    headers: {
      'Content-Type': 'application/json',
      'x-sns-bot-id': process.env.SENTINEL_SNS_BOT_ID,
      'x-sns-bot-token': process.env.SENTINEL_SNS_BOT_TOKEN,
      'x-sns-request-id': requestId,
      'x-sns-timestamp': timestamp,
      'x-sns-signature': crypto.createHmac('sha256', secret).update(signedMessage).digest('hex'),
    },
    body: raw,
  };
}

module.exports = {
  INCIDENT_STATUS_MAP,
  normalizeIncidentStatus,
  buildIncidentPayload,
  getIncidentApiConfig,
  createSignedRequestPayload,
};
