const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeIncidentStatus,
  buildIncidentPayload,
  getIncidentApiConfig,
  createSignedRequestPayload,
} = require('../modules/incidentClient');

test('incident status values normalize to the SNS lifecycle', () => {
  assert.equal(normalizeIncidentStatus('OPEN'), 'open');
  assert.equal(normalizeIncidentStatus('Assigned'), 'assigned');
  assert.equal(normalizeIncidentStatus('unknown'), 'open');
});

test('incident payloads include the core fields and severity', () => {
  const payload = buildIncidentPayload({
    title: 'Webhook spike',
    severity: 'high',
    reason: 'Repeated failed sign-ins',
    owner: 'ops-team',
    guildId: 'guild-42',
  });

  assert.deepEqual(payload, {
    title: 'Webhook spike',
    severity: 'high',
    reason: 'Repeated failed sign-ins',
    owner: 'ops-team',
    guildId: 'guild-42',
    status: 'open',
  });
});

test('incident API config is only considered configured when all required values are present', () => {
  const previous = process.env.SNS_CORE_API_URL;
  const previousBotId = process.env.SENTINEL_SNS_BOT_ID;
  const previousToken = process.env.SENTINEL_SNS_BOT_TOKEN;
  const previousSecret = process.env.BOT_WEBHOOK_SECRET;

  delete process.env.SNS_CORE_API_URL;
  delete process.env.SENTINEL_SNS_BOT_ID;
  delete process.env.SENTINEL_SNS_BOT_TOKEN;
  delete process.env.BOT_WEBHOOK_SECRET;
  assert.equal(getIncidentApiConfig().configured, false);

  process.env.SNS_CORE_API_URL = 'https://core.example';
  process.env.SENTINEL_SNS_BOT_ID = 'bot-123';
  process.env.SENTINEL_SNS_BOT_TOKEN = 'token-123';
  process.env.BOT_WEBHOOK_SECRET = 'secret-123';
  assert.equal(getIncidentApiConfig().configured, true);

  if (previous === undefined) delete process.env.SNS_CORE_API_URL; else process.env.SNS_CORE_API_URL = previous;
  if (previousBotId === undefined) delete process.env.SENTINEL_SNS_BOT_ID; else process.env.SENTINEL_SNS_BOT_ID = previousBotId;
  if (previousToken === undefined) delete process.env.SENTINEL_SNS_BOT_TOKEN; else process.env.SENTINEL_SNS_BOT_TOKEN = previousToken;
  if (previousSecret === undefined) delete process.env.BOT_WEBHOOK_SECRET; else process.env.BOT_WEBHOOK_SECRET = previousSecret;
});

test('signed incident requests include replay-resistant metadata', () => {
  const request = createSignedRequestPayload({ incidentId: 'INC-1' }, 'test-secret');
  assert.match(request.headers['x-sns-request-id'], /^[0-9a-f-]{36}$/);
  assert.match(request.headers['x-sns-timestamp'], /^\d+$/);
  assert.equal(request.body, '{"incidentId":"INC-1"}');
  assert.match(request.headers['x-sns-signature'], /^[0-9a-f]{64}$/);
});
