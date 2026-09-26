const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { backupAllData, restoreBackupSet } = require('../modules/backup');

test('restoreBackupSet snapshots current data before restoring a backup set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-backup-test-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'profiles.json'), '{"version":1}', 'utf8');

  const created = backupAllData({ dataDir, backupDir });
  const timestamp = path.basename(created[0]).replace(/^profiles-/, '').replace(/\.backup\.json$/, '');
  fs.writeFileSync(path.join(dataDir, 'profiles.json'), '{"version":2}', 'utf8');

  const result = restoreBackupSet(timestamp, { dataDir, backupDir });

  assert.equal(fs.readFileSync(path.join(dataDir, 'profiles.json'), 'utf8'), '{"version":1}');
  assert.ok(result.preRestoreBackups.length > 0);
  assert.equal(result.restored.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});