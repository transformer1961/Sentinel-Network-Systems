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

function listBackupFiles(options = {}) {
  const backupDir = options.backupDir || BACKUP_DIR;
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, path: path.join(backupDir, name), time: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
}

function rotateBackups(options = {}) {
  const backups = listBackupFiles(options);
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

function backupAllData(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const backupDir = options.backupDir || BACKUP_DIR;
  ensureDir(dataDir);
  ensureDir(backupDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
  if (!files.length) {
    logger.warn('backup', 'No data files found to back up');
    return [];
  }

  const backups = [];
  for (const file of files) {
    const source = path.join(dataDir, file);
    const destination = path.join(backupDir, `${file.replace('.json', '')}-${timestamp}.backup.json`);
    try {
      fs.copyFileSync(source, destination);
      backups.push(destination);
      logger.info('backup', `Created backup: ${destination}`);
    } catch (err) {
      logger.warn('backup', `Failed to back up ${file}`, err);
    }
  }

  rotateBackups({ backupDir });
  return backups;
}

function restoreBackupSet(timestamp, options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const backupDir = options.backupDir || BACKUP_DIR;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z$/.test(timestamp || '')) {
    throw new Error('Invalid backup timestamp');
  }

  const files = listBackupFiles({ backupDir }).filter(file => file.name.endsWith(`-${timestamp}.backup.json`));
  if (!files.length) throw new Error(`No backup files found for ${timestamp}`);
  ensureDir(dataDir);

  const preRestoreBackups = backupAllData({ dataDir, backupDir });
  const restored = [];
  for (const file of files) {
    const targetName = file.name.slice(0, -`-${timestamp}.backup.json`.length) + '.json';
    const target = path.join(dataDir, targetName);
    if (path.basename(target) !== targetName) throw new Error('Invalid backup file name');
    fs.copyFileSync(file.path, target);
    restored.push(target);
  }

  return { preRestoreBackups, restored };
}

module.exports = {
  backupAllData,
  listBackupFiles,
  restoreBackupSet,
  rotateBackups
};
