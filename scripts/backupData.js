const { backupAllData } = require('../modules/backup');

try {
  const backups = backupAllData();
  if (backups.length) {
    console.log(`Created ${backups.length} data backup(s).`);
  } else {
    console.log('No backup files created.');
  }
  process.exit(0);
} catch (err) {
  console.error('Backup script failed:', err.message);
  process.exit(1);
}
