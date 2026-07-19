-- JobFill Pro v2 — Database Schema
-- SQLite tables for job tracking, contacts, outreach, and careers pages.

-- All jobs detected, regardless of outcome
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_title     TEXT NOT NULL,
  company       TEXT NOT NULL,
  location      TEXT,
  job_url       TEXT NOT NULL UNIQUE,
  job_description TEXT,
  platform      TEXT NOT NULL,
  extraction_method TEXT,
  employment_type TEXT,
  experience_required TEXT,
  skills_found  TEXT,           -- JSON array
  salary_range  TEXT,
  company_domain TEXT,
  match_score   INTEGER,
  recommendation TEXT,          -- 'CONTACT' | 'SKIP' | 'ANALYSIS_FAILED' | 'ANALYSIS_TIMEOUT' | 'PENDING'
  rationale     TEXT,
  strengths     TEXT,           -- JSON array
  gaps          TEXT,           -- JSON array
  suggested_tone TEXT,
  extracted_at  TEXT NOT NULL,
  analyzed_at   TEXT
);

-- Recruiter contacts found (even if not emailed)
CREATE TABLE IF NOT EXISTS contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  name          TEXT,
  email         TEXT NOT NULL,
  title         TEXT,
  confidence    INTEGER NOT NULL,
  source        TEXT NOT NULL,
  found_at      TEXT NOT NULL
);

-- Every email sent
CREATE TABLE IF NOT EXISTS outreach_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  contact_email TEXT NOT NULL,
  contact_name  TEXT,
  subject       TEXT NOT NULL,
  body_text     TEXT,
  body_html     TEXT,
  sent_at       TEXT NOT NULL,
  message_id    TEXT,           -- Gmail message ID for tracking
  response_at   TEXT,           -- Populated if reply is detected (future feature)
  status        TEXT DEFAULT 'sent'  -- 'sent' | 'bounced' | 'replied' | 'interview_scheduled' | 'draft_review_required'
);

-- Careers pages saved for manual follow-up
CREATE TABLE IF NOT EXISTS careers_pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  url           TEXT NOT NULL,
  page_type     TEXT,           -- 'careers' | 'contact' | 'team'
  saved_at      TEXT NOT NULL
);

-- Settings table for outreach toggle
CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(job_url);
CREATE INDEX IF NOT EXISTS idx_jobs_extracted ON jobs(extracted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_recommendation ON jobs(recommendation);
CREATE INDEX IF NOT EXISTS idx_contacts_job ON contacts(job_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_outreach_company ON outreach_log(contact_email);
CREATE INDEX IF NOT EXISTS idx_outreach_sent ON outreach_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_outreach_job ON outreach_log(job_id);
