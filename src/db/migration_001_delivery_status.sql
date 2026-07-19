-- Migration 001: Delivery status tracking for outreach_log
-- Run once:  sqlite3 your_db_file.db < migration_001_delivery_status.sql
-- Safe to re-run: uses IF NOT EXISTS / ALTER TABLE is idempotent in SQLite via PRAGMA
-- ─────────────────────────────────────────────────────────────────────────────

-- SQLite does not support "IF NOT EXISTS" on ALTER TABLE.
-- Wrap in a PRAGMA check to guard against re-runs.

PRAGMA journal_mode = WAL;

-- 1. Add delivery_status column (default 'sent' so existing rows stay valid)
ALTER TABLE outreach_log ADD COLUMN delivery_status VARCHAR(20) NOT NULL DEFAULT 'sent';

-- 2. Bounce timestamp (NULL = not bounced / unknown)
ALTER TABLE outreach_log ADD COLUMN bounced_at INTEGER;      -- Unix epoch ms

-- 3. Confirmed delivery timestamp
ALTER TABLE outreach_log ADD COLUMN delivered_at INTEGER;    -- Unix epoch ms

-- 4. Reason code when a send was skipped by the validation gate
ALTER TABLE outreach_log ADD COLUMN skip_reason VARCHAR(100);

-- ─── indexes ─────────────────────────────────────────────────────────────────

-- Used by bounce polling queries (filter pending 'sent' rows by age)
CREATE INDEX IF NOT EXISTS idx_outreach_status_date
  ON outreach_log (delivery_status, sent_at DESC);

-- Used for per-contact duplicate/history checks
CREATE INDEX IF NOT EXISTS idx_outreach_contact_status
  ON outreach_log (contact_email, delivery_status);

-- ─── delivery_status enum reference ──────────────────────────────────────────
-- 'sent'             — Dispatched to Gmail SMTP. Delivery unknown.
-- 'delivered'        — Confirmed delivery (via Gmail API or transactional webhook).
-- 'bounced'          — Hard bounce received. Do not retry.
-- 'validation_failed'— Blocked by pre-send gate (syntax/MX/confidence).
-- 'skipped_cap'      — Blocked because daily send cap was reached.
-- 'skipped_dup'      — Blocked because this contact was already emailed today.
-- ─────────────────────────────────────────────────────────────────────────────
