/**
 * LOGGER MODULE
 * Writes errors to /logs/errors.log
 * Prints debug messages when DEBUG=true in config
 */

const fs   = require('fs');
const path = require('path');

const config   = require('./config');
const LOG_DIR  = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'errors.log');
const EVT_FILE = path.join(LOG_DIR, 'events.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp() {
  return new Date().toISOString();
}

function format(level, scope, message, data) {
  const meta = data ? ' | ' + JSON.stringify(data) : '';
  return `[${timestamp()}] [${level}] [${scope}] ${message}${meta}`;
}

function writeToFile(file, line) {
  try {
    fs.appendFileSync(file, line + '\n', 'utf8');
    // Rotate if > 5MB
    const size = fs.statSync(file).size;
    if (size > 5 * 1024 * 1024) {
      const backup = file.replace('.log', `-${Date.now()}.log`);
      fs.renameSync(file, backup);
    }
  } catch { /* silent — don't crash bot on log failure */ }
}

const logger = {
  /**
   * Debug — only prints if DEBUG=true in config
   */
  debug(scope, message, data) {
    if (!config.debug) return;
    const line = format('DEBUG', scope, message, data);
    console.log('\x1b[36m' + line + '\x1b[0m'); // cyan
  },

  /**
   * Info — always prints, not written to error log
   */
  info(scope, message, data) {
    const line = format('INFO', scope, message, data);
    console.log('\x1b[32m' + line + '\x1b[0m'); // green
    writeToFile(EVT_FILE, line);
  },

  /**
   * Warn — prints in yellow
   */
  warn(scope, message, data) {
    const line = format('WARN', scope, message, data);
    console.warn('\x1b[33m' + line + '\x1b[0m'); // yellow
    writeToFile(LOG_FILE, line);
  },

  /**
   * Error — prints in red, always written to errors.log
   */
  error(scope, message, err) {
    const data = err ? { message: err.message, stack: err.stack?.split('\n')[1]?.trim() } : undefined;
    const line = format('ERROR', scope, message, data);
    console.error('\x1b[31m' + line + '\x1b[0m'); // red
    writeToFile(LOG_FILE, line);
  },

  /**
   * Critical — prints in bright red, written to log
   */
  critical(scope, message, err) {
    const data = err ? { message: err.message } : undefined;
    const line = format('CRITICAL', scope, message, data);
    console.error('\x1b[41m\x1b[37m' + line + '\x1b[0m'); // white on red
    writeToFile(LOG_FILE, line);
  },

  /**
   * Event — lightweight event trace for audit trail
   */
  event(scope, message, data) {
    const line = format('EVENT', scope, message, data);
    writeToFile(EVT_FILE, line);
    if (config.debug) console.log('\x1b[35m' + line + '\x1b[0m'); // magenta
  }
};

module.exports = logger;
