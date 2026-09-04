const crypto = require('crypto');
const logger = require('./logger');

function getConfig() {
  const url = process.env.SNS_CORE_WEBHOOK_URL;
  const botId = process.env.SENTINEL_SNS_BOT_ID;
  const botToken = process.env.SENTINEL_SNS_BOT_TOKEN;
  const secret = process.env.BOT_WEBHOOK_SECRET;

  if (!url || !botId || !botToken || !secret) return null;
  return { url, botId, botToken, secret };
}

async function publishBlacklistUpdate(update) {
  const config = getConfig();
  if (!config) return { configured: false, ok: false };

  const payload = JSON.stringify({
    type: 'blacklist_update',
    source: 'sentinel-bot',
    ...update
  });

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sns-bot-id': config.botId,
        'x-sns-bot-token': config.botToken,
        'x-sns-signature': crypto.createHmac('sha256', config.secret).update(payload).digest('hex')
      },
      body: payload,
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`SNS webhook returned ${response.status}`);
    }

    return { configured: true, ok: true };
  } catch (error) {
    logger.warn('snsSync', `Blacklist sync failed: ${error.message}`);
    return { configured: true, ok: false };
  }
}

module.exports = { publishBlacklistUpdate };