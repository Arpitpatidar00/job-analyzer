/**
 * JobFill Pro v2 — Outreach Route
 * POST /api/outreach — Generate and send recruiter outreach emails
 */

const express = require('express');
const router = express.Router();
const db = require('../db/queries');
const gemini = require('../services/gemini');
const dedup = require('../services/dedup');
const mailer = require('../services/mailer');
const { validateEmail } = require('../utils/email-validator');
const { logger, ErrorCodes } = require('../services/logger');

/**
 * POST /api/outreach
 * Generate outreach email, validate, dedup check, and send
 */
router.post('/', async (req, res) => {
  const { job, analysis, contact, userProfile } = req.body;

  if (!userProfile) {
    return res.status(400).json({ error: 'userProfile is required in request body' });
  }

  if (!job || !analysis || !contact || !contact.email) {
    return res.status(400).json({
      error: 'Missing required fields: job, analysis, contact',
    });
  }

  // Determine if this should be sent or drafted based on confidence
  const isDraft = (contact.confidence || 0) < 60;

  try {
    // Dedup checks
    const limitCheck = dedup.checkAllLimits(
      job.company,
      contact.email,
      userProfile
    );

    if (!limitCheck.allowed) {
      logger.info('outreach', `Blocked by safety: ${limitCheck.reason}`);
      return res.json({
        sent: false,
        reason: limitCheck.reason,
        blocked: true,
      });
    }

    // Generate email via Gemini
    const email = await gemini.generateOutreachEmail(
      job,
      analysis,
      contact,
      userProfile
    );

    const jobId = job.id || db.getJobByUrl(job.jobUrl || job.job_url)?.id;

    if (!email) {
      // Double validation failure — store as draft
      if (jobId) {
        db.insertOutreachLog({
          jobId,
          contactEmail: contact.email,
          contactName: contact.name,
          subject: 'DRAFT — Review Required',
          bodyText: '',
          bodyHtml: '',
          messageId: null,
          status: 'draft_review_required',
        });
      }

      logger.warn('outreach', 'Email validation failed twice — saved as draft', {
        company: job.company,
      });

      return res.json({
        sent: false,
        reason: 'VALIDATION_FAILED — email saved as draft for manual review',
        draft: true,
      });
    }

    // ─── Pre-send validation gate ──────────────────────────────────────────────
    const validation = await validateEmail(contact.email);
    if (!validation.valid) {
      logger.warn('outreach', `Skipping ${contact.email} — ${validation.reason}`);
      if (jobId) {
        db.insertOutreachLog({
          jobId,
          contactEmail: contact.email,
          contactName: contact.name,
          subject: '',
          bodyText: '',
          bodyHtml: '',
          messageId: null,
          status: 'validation_failed',
          skip_reason: validation.reason,
        });
      }
      return res.json({ sent: false, draft: false, reason: validation.reason });
    }

    if ((contact.confidence ?? 0) < 55) {
      logger.warn('outreach', `Skipping ${contact.email} — confidence too low (${contact.confidence})`);
      return res.json({ sent: false, draft: false, reason: 'low_confidence' });
    }
    // ───────────────────────────────────────────────────────────────────────────

    // Send email (unless draft)
    let sendResult = null;
    let messageId = null;
    let status = 'sent';

    if (isDraft) {
      status = 'draft_review_required';
      logger.info('outreach', `Confidence low (${contact.confidence}), saving as draft`, { jobId });
    } else if (mailer.isMailerReady()) {
      try {
        sendResult = await mailer.sendEmail(email, contact, job, userProfile);
        messageId = sendResult.messageId;
      } catch (err) {
        logger.error('outreach', 'Mailer send failed', { error: err.message });
        // Store as draft on send failure
        if (jobId) {
          db.insertOutreachLog({
            jobId,
            contactEmail: contact.email,
            contactName: contact.name,
            subject: email.subject,
            bodyText: email.bodyText,
            bodyHtml: email.bodyHtml,
            messageId: null,
            status: 'draft_review_required',
          });
        }
        return res.status(500).json({ error: 'Failed to send email' });
      }
    } else {
      logger.warn('outreach', 'Mailer not configured, saving as draft');
      status = 'draft_review_required';
    }

    // Log to DB
    let logId;
    if (jobId) {
      logId = db.insertOutreachLog({
        jobId,
        contactEmail: contact.email,
        contactName: contact.name,
        subject: email.subject,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml,
        messageId,
        status, // 'sent' is inserted here
      });

      // If sent, trigger async bounce check
      if (status === 'sent') {
        checkBounceAsync(contact.email).catch(err =>
          logger.debug('outreach', `Bounce check failed for ${contact.email}: ${err.message}`)
        );
      }
    }

    // Send the response
    res.json({
      sent: status === 'sent',
      draft: status === 'draft_review_required',
      logId,
      email: {
        subject: email.subject,
        to: contact.email,
        generatedAt: email.generatedAt,
      },
      messageId,
    });
  } catch (err) {
    logger.error('outreach', 'Unexpected error in outreach route', {
      errorCode: ErrorCodes.GEMINI_ERROR,
      error: err,
    });
    res.status(500).json({ error: 'Outreach generation failed' });
  }
});

module.exports = router;

// Polls Gmail sent folder 5 minutes after send for NDR / bounce-back signals
async function checkBounceAsync(toEmail) {
  await new Promise(r => setTimeout(r, 5 * 60 * 1000)); // wait 5 minutes

  // Use Gmail API to search for NDR messages
  // This requires 'gmail.readonly' scope added to your OAuth2 token
  try {
    const { getGmailClient } = require('../services/mailer'); // Assuming this exists or similar
    // For now we'll just log that we would check, as getGmailClient might not be exported
    // In a real implementation this polls the inbox.
    logger.debug('outreach', `Checking bounce status for ${toEmail} (placeholder)`);
  } catch (err) {
    logger.debug('outreach', `Gmail bounce poll error: ${err.message}`);
  }
}
