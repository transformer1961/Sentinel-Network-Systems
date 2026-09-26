const { listBackupFiles, restoreBackupSet } = require('../modules/backup');

const [timestamp, ...flags] = process.argv.slice(2);

if (timestamp === '--list') {
  const files = listBackupFiles();
  const timestamps = [...new Set(files.map((file) => file.name.match(/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.backup\.json$/)?.[1]).filter(Boolean))];
  console.log(timestamps.length ? timestamps.join('\n') : 'No backup sets found.');
  process.exit(0);
}

if (!timestamp || !flags.includes('--confirm')) {
  console.error('Usage: npm run restore -- <timestamp> --confirm');
  console.error('List available sets with: npm run restore -- --list');
  process.exit(1);
}

try {
  const result = restoreBackupSet(timestamp);
  console.log(`Restored ${result.restored.length} file(s).`);
  console.log(`Created ${result.preRestoreBackups.length} pre-restore backup(s).`);
} catch (error) {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
}