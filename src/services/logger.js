/**
 * JobFill Pro v2 — Logger
 * Structured error logging to ~/.jobfill-pro/error.log
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(__dirname, '../../');
const LOG_PATH = path.join(LOG_DIR, 'error.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED = 3;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Error codes shown to users (never raw Error.message)
 */
const ErrorCodes = {
  ANALYSIS_FAILED: 'ANALYSIS_FAILED',
  ANALYSIS_TIMEOUT: 'ANALYSIS_TIMEOUT',
  NO_RECRUITER_FOUND: 'NO_RECRUITER_FOUND',
  EMAIL_LIMIT_REACHED: 'EMAIL_LIMIT_REACHED',
  SEND_FAILED: 'SEND_FAILED',
  COMPANY_LIMIT_REACHED: 'COMPANY_LIMIT_REACHED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DB_ERROR: 'DB_ERROR',
  GEMINI_ERROR: 'GEMINI_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
};

/**
 * Rotate log files if current log exceeds MAX_LOG_SIZE
 */
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const stats = fs.statSync(LOG_PATH);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate existing files
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const from = `${LOG_PATH}.${i}`;
      const to = `${LOG_PATH}.${i + 1}`;
      if (fs.existsSync(from)) {
        fs.renameSync(from, to);
      }
    }

    // Move current log to .1
    fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
  } catch (e) {
    // Silent fail on rotation errors
  }
}

/**
 * Write a structured log entry
 */
function logEntry(level, feature, message, data = {}) {
  rotateIfNeeded();

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    feature,
    message,
    ...(data.errorCode && { errorCode: data.errorCode }),
    ...(data.jobId && { jobId: data.jobId }),
    ...(data.stack && { stack: data.stack }),
    ...(data.meta && { meta: data.meta }),
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    if (!process.env.VERCEL) {
      fs.appendFileSync(LOG_PATH, line);
    }
  } catch (e) {
    console.error('[JobFill Logger] Failed to write log:', e.message);
  }

  // Also log to console in development
  if (level === 'error') {
    console.error(`[JobFill:${feature}]`, message, data.meta || '');
  } else if (level === 'warn') {
    console.warn(`[JobFill:${feature}]`, message, data.meta || '');
  } else {
    console.log(`[JobFill:${feature}]`, message, data.meta || '');
  }
}

const logger = {
  info: (feature, message, meta) => logEntry('info', feature, message, { meta }),
  warn: (feature, message, meta) => logEntry('warn', feature, message, { meta }),

  error: (feature, message, { errorCode, jobId, error, meta } = {}) => {
    logEntry('error', feature, message, {
      errorCode,
      jobId,
      stack: error?.stack,
      meta,
    });
  },
};

module.exports = { logger, ErrorCodes };
