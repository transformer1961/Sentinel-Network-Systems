const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const BACKUP_DIR = path.resolve(__dirname, '..', String(config.backupDirectory || 'backups'));
const RETENTION = Number(config.backupRetention) || 10;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function listBackupFiles() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, path: path.join(BACKUP_DIR, name), time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
}

function rotateBackups() {
  const backups = listBackupFiles();
  if (backups.length <= RETENTION) return;

  const toDelete = backups.slice(RETENTION);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.path);
      logger.info('backup', `Removed old backup ${file.name}`);
    } catch (err) {
      logger.warn('backup', `Failed to remove old backup ${file.name}`, err);
    }
  }
}

function backupAllData() {
  ensureDir(DATA_DIR);
  ensureDir(BACKUP_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const files = fs.readdirSync(DATA_DIR).filter(file => file.endsWith('.json'));
  if (!files.length) {
    logger.warn('backup', 'No data files found to back up');
    return [];
  }

  const backups = [];
  for (const file of files) {
    const source = path.join(DATA_DIR, file);
    const destination = path.join(BACKUP_DIR, `${file.replace('.json', '')}-${timestamp}.backup.json`);
    try {
      fs.copyFileSync(source, destination);
      backups.push(destination);
      logger.info('backup', `Created backup: ${destination}`);
    } catch (err) {
      logger.warn('backup', `Failed to back up ${file}`, err);
    }
  }

  rotateBackups();
  return backups;
}

module.exports = {
  backupAllData,
  listBackupFiles,
  rotateBackups
};
