/**
 * JobFill Pro v2 — Database Queries
 * All SQLite operations wrapped in clean functions.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── DB Initialization ──────────────────────────────────────────────────────

const DB_DIR = process.env.VERCEL 
  ? '/tmp' 
  : path.join(os.homedir(), '.jobfill-pro');
const DB_PATH = path.join(DB_DIR, 'jobs.db');

let db;

function initDB() {
  // Ensure directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8'
  );
  db.exec(schema);

  // Initialize default settings
  const initSettings = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  );
  initSettings.run('outreach_paused', 'false');

  // Safely run migrations
  try { db.exec(`ALTER TABLE jobs ADD COLUMN recruiter_name TEXT`); } catch (e) { /* ignore if exists */ }
  try { db.exec(`ALTER TABLE jobs ADD COLUMN recruiter_title TEXT`); } catch (e) { /* ignore if exists */ }

  console.log('[JobFill DB] Initialized at', DB_PATH);
  return db;
}

function getDB() {
  if (!db) initDB();
  return db;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

function insertJob(payload) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT INTO jobs (
      job_title, company, location, job_url, job_description,
      platform, extraction_method, employment_type, experience_required,
      skills_found, salary_range, company_domain,
      recruiter_name, recruiter_title,
      recommendation, extracted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `);

  const info = stmt.run(
    payload.jobTitle,
    payload.company,
    payload.location || null,
    payload.jobUrl,
    payload.jobDescription,
    payload.platform || 'UNKNOWN',
    payload.extractionMethod || 'DOM',
    payload.employmentType || null,
    payload.experienceRequired || null,
    JSON.stringify(payload.skills || []),
    payload.salaryRange || null,
    payload.companyDomain || null,
    payload.recruiterName || null,
    payload.recruiterTitle || null,
    payload.extractedAt || new Date().toISOString()
  );

  return info.lastInsertRowid;
}

function getJobByUrl(url) {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM jobs WHERE job_url = ?
  `).get(url);
}

function getRecentJobByUrl(url, days = 7) {
  const d = getDB();
  return d.prepare(`
    SELECT id FROM jobs
    WHERE job_url = ? AND extracted_at > datetime('now', ?)
  `).get(url, `-${days} days`);
}

function updateJobAnalysis(jobId, analysis) {
  const d = getDB();
  d.prepare(`
    UPDATE jobs SET
      match_score = ?,
      recommendation = ?,
      rationale = ?,
      strengths = ?,
      gaps = ?,
      suggested_tone = ?,
      analyzed_at = datetime('now')
    WHERE id = ?
  `).run(
    analysis.matchScore,
    analysis.recommendation,
    analysis.rationale,
    JSON.stringify(analysis.strengths || []),
    JSON.stringify(analysis.gaps || []),
    analysis.suggestedTone,
    jobId
  );
}

function markJobFailed(jobId, status = 'ANALYSIS_FAILED') {
  const d = getDB();
  d.prepare(`
    UPDATE jobs SET recommendation = ?, analyzed_at = datetime('now')
    WHERE id = ?
  `).run(status, jobId);
}

function getRecentJobs(limit = 20) {
  const d = getDB();
  return d.prepare(`
    SELECT id, job_title, company, location, job_url, platform,
           match_score, recommendation, extracted_at, analyzed_at
    FROM jobs
    ORDER BY extracted_at DESC
    LIMIT ?
  `).all(limit);
}

function getFailedJobs() {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM jobs
    WHERE recommendation IN ('ANALYSIS_FAILED', 'ANALYSIS_TIMEOUT')
    ORDER BY extracted_at DESC
  `).all();
}

function getJobById(jobId) {
  const d = getDB();
  return d.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
}

// ─── Contacts ────────────────────────────────────────────────────────────────

function insertContact(contact) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT INTO contacts (job_id, name, email, title, confidence, source, found_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  return stmt.run(
    contact.jobId,
    contact.name,
    contact.email,
    contact.title,
    contact.confidence,
    contact.source
  );
}

function getContactsByJobId(jobId) {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM contacts
    WHERE job_id = ?
    ORDER BY confidence DESC
  `).all(jobId);
}

// ─── Outreach Log ────────────────────────────────────────────────────────────

function insertOutreachLog(log) {
  const d = getDB();
  return d.prepare(`
    INSERT INTO outreach_log (
      job_id, contact_email, contact_name, subject,
      body_text, body_html, sent_at, message_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
  `).run(
    log.jobId,
    log.contactEmail,
    log.contactName,
    log.subject,
    log.bodyText,
    log.bodyHtml,
    log.messageId,
    log.status || 'sent'
  );
}

function getOutreachByCompany(company, days = 30) {
  const d = getDB();
  return d.prepare(`
    SELECT ol.* FROM outreach_log ol
    JOIN jobs j ON ol.job_id = j.id
    WHERE j.company = ? AND ol.sent_at > datetime('now', ?)
    AND ol.status != 'draft_review_required'
  `).all(company, `-${days} days`);
}

function getOutreachByEmail(email) {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM outreach_log
    WHERE contact_email = ?
    AND status != 'draft_review_required'
  `).all(email);
}

function getDailySendCount() {
  const d = getDB();
  const row = d.prepare(`
    SELECT COUNT(*) as count FROM outreach_log
    WHERE sent_at > datetime('now', '-1 day')
    AND status = 'sent'
  `).get();
  return row.count;
}

function getRecentOutreach(limit = 20) {
  const d = getDB();
  return d.prepare(`
    SELECT ol.*, j.job_title, j.company, j.job_url
    FROM outreach_log ol
    JOIN jobs j ON ol.job_id = j.id
    ORDER BY ol.sent_at DESC
    LIMIT ?
  `).all(limit);
}

// ─── Careers Pages ───────────────────────────────────────────────────────────

function insertCareersPage(page) {
  const d = getDB();
  return d.prepare(`
    INSERT INTO careers_pages (job_id, url, page_type, saved_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(page.jobId, page.url, page.pageType);
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

function getDashboardStats(threshold = 75) {
  const d = getDB();

  const jobsDetected = d.prepare(`SELECT COUNT(*) as c FROM jobs`).get().c;
  const jobsAnalyzed = d.prepare(`SELECT COUNT(*) as c FROM jobs WHERE recommendation IS NOT NULL AND recommendation != 'PENDING'`).get().c;
  const highMatchJobs = d.prepare(`SELECT COUNT(*) as c FROM jobs WHERE match_score >= ?`).get(threshold).c;
  const recruitersFound = d.prepare(`SELECT COUNT(*) as c FROM contacts WHERE confidence >= 60`).get().c;
  const emailsSent = d.prepare(`SELECT COUNT(*) as c FROM outreach_log WHERE status = 'sent'`).get().c;
  const emailsSentThisWeek = d.prepare(`SELECT COUNT(*) as c FROM outreach_log WHERE sent_at > datetime('now', '-7 days') AND status = 'sent'`).get().c;
  const responsesReceived = d.prepare(`SELECT COUNT(*) as c FROM outreach_log WHERE status = 'replied'`).get().c;
  const interviewsScheduled = d.prepare(`SELECT COUNT(*) as c FROM outreach_log WHERE status = 'interview_scheduled'`).get().c;
  const companiesOnCooldown = d.prepare(`
    SELECT COUNT(DISTINCT j.company) as c
    FROM outreach_log ol
    JOIN jobs j ON ol.job_id = j.id
    WHERE ol.sent_at > datetime('now', '-30 days')
    AND ol.status = 'sent'
  `).get().c;

  return {
    jobsDetected,
    jobsAnalyzed,
    highMatchJobs,
    recruitersFound,
    emailsSent,
    emailsSentThisWeek,
    responsesReceived,
    interviewsScheduled,
    companiesOnCooldown,
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getSetting(key) {
  const d = getDB();
  const row = d.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const d = getDB();
  d.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

function isOutreachPaused() {
  return getSetting('outreach_paused') === 'true';
}

// ─── Export ──────────────────────────────────────────────────────────────────

function exportAllData() {
  const d = getDB();
  return {
    jobs: d.prepare(`SELECT * FROM jobs ORDER BY extracted_at DESC`).all(),
    contacts: d.prepare(`SELECT * FROM contacts ORDER BY found_at DESC`).all(),
    outreach: d.prepare(`SELECT * FROM outreach_log ORDER BY sent_at DESC`).all(),
    careersPages: d.prepare(`SELECT * FROM careers_pages ORDER BY saved_at DESC`).all(),
    exportedAt: new Date().toISOString(),
  };
}

function updateOutreachDeliveryStatus(contactEmail, status, extra = {}) {
  const d = getDB();
  const now = new Date().toISOString();
  const updates = ['delivery_status = ?'];
  const params = [status];

  if (status === 'bounced') {
    updates.push('bounced_at = ?');
    params.push(now);
  }
  if (status === 'delivered') {
    updates.push('delivered_at = ?');
    params.push(now);
  }
  if (extra.skipReason) {
    updates.push('skip_reason = ?');
    params.push(extra.skipReason);
  }

  params.push(contactEmail);
  d.prepare(
    `UPDATE outreach_log SET ${updates.join(', ')} WHERE contact_email = ? AND (delivery_status = 'sent' OR delivery_status IS NULL)`
  ).run(...params);
}

module.exports = {
  initDB,
  getDB,
  // Jobs
  insertJob,
  getJobByUrl,
  getRecentJobByUrl,
  updateJobAnalysis,
  markJobFailed,
  getRecentJobs,
  getFailedJobs,
  getJobById,
  // Contacts
  insertContact,
  getContactsByJobId,
  // Outreach
  insertOutreachLog,
  updateOutreachDeliveryStatus,
  getOutreachByCompany,
  getOutreachByEmail,
  getDailySendCount,
  getRecentOutreach,
  // Careers pages
  insertCareersPage,
  // Stats
  getDashboardStats,
  // Settings
  getSetting,
  setSetting,
  isOutreachPaused,
  // Export
  exportAllData,
};
