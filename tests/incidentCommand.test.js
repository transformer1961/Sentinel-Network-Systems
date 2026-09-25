const test = require('node:test');
const assert = require('node:assert/strict');

const incidentCommand = require('../commands/incident');

test('incident command is registered with the expected Discord command shape', () => {
  assert.equal(incidentCommand.data.name, 'incident');
  assert.equal(typeof incidentCommand.execute, 'function');
  assert.ok(Array.isArray(incidentCommand.data.options));
});
