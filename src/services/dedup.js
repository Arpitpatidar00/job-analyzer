/**
 * JobFill Pro v2 — Deduplication Service
 * Prevents sending duplicate or excessive outreach emails.
 */

const db = require('../db/queries');
const { logger } = require('./logger');

/**
 * Check if we can send an email to a specific company
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canSendToCompany(company, companyEmailLimit, cooldownDays) {
  const recentOutreach = db.getOutreachByCompany(company, cooldownDays);

  if (recentOutreach.length >= companyEmailLimit) {
    return {
      allowed: false,
      reason: `COMPANY_LIMIT_REACHED: ${recentOutreach.length}/${companyEmailLimit} emails sent to ${company} in last ${cooldownDays} days`,
    };
  }

  return { allowed: true };
}

/**
 * Check if we've ever sent to this email address
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canSendToRecipient(email) {
  const existing = db.getOutreachByEmail(email);

  if (existing.length > 0) {
    return {
      allowed: false,
      reason: `DUPLICATE_RECIPIENT: Already sent to ${email} on ${existing[0].sent_at}`,
    };
  }

  return { allowed: true };
}

/**
 * Check daily send limit
 * @returns {{ allowed: boolean, reason?: string, count: number }}
 */
function checkDailyLimit(dailyEmailLimit) {
  const count = db.getDailySendCount();

  if (count >= dailyEmailLimit) {
    return {
      allowed: false,
      reason: `EMAIL_LIMIT_REACHED: ${count}/${dailyEmailLimit} emails sent today`,
      count,
    };
  }

  // Soft warning at 80% of limit
  if (count >= dailyEmailLimit * 0.8) {
    logger.warn('dedup', `Approaching daily email limit: ${count}/${dailyEmailLimit}`);
  }

  return { allowed: true, count };
}

/**
 * Check if outreach is globally paused
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkOutreachPaused() {
  if (db.isOutreachPaused()) {
    return {
      allowed: false,
      reason: 'OUTREACH_PAUSED: Outreach is globally paused by user',
    };
  }
  return { allowed: true };
}

/**
 * Run ALL dedup and safety checks before sending
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkAllLimits(company, email, userProfile) {
  // Check global pause
  const pauseCheck = checkOutreachPaused();
  if (!pauseCheck.allowed) return pauseCheck;

  // Check company limit
  const companyCheck = canSendToCompany(
    company,
    userProfile.companyEmailLimit || 3,
    userProfile.cooldownDays || 30
  );
  if (!companyCheck.allowed) return companyCheck;

  // Check recipient duplicates
  const recipientCheck = canSendToRecipient(email);
  if (!recipientCheck.allowed) return recipientCheck;

  // Check daily limit
  const dailyCheck = checkDailyLimit(userProfile.dailyEmailLimit || 20);
  if (!dailyCheck.allowed) return dailyCheck;

  return { allowed: true };
}

module.exports = {
  canSendToCompany,
  canSendToRecipient,
  checkDailyLimit,
  checkOutreachPaused,
  checkAllLimits,
};
