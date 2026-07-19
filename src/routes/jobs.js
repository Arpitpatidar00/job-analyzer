/**
 * JobFill Pro v2 — Jobs Route
 * GET/POST /api/jobs — Job listing, stats, retry, and export
 */

const express = require('express');
const router = express.Router();
const db = require('../db/queries');
const gemini = require('../services/gemini');
const userProfile = require('../config/user-profile');
const { logger, ErrorCodes } = require('../services/logger');

/**
 * GET /api/jobs
 * Returns recent jobs with optional limit
 */
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const jobs = db.getRecentJobs(limit);
  res.json({ jobs });
});

/**
 * GET /api/jobs/stats
 * Returns dashboard statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = db.getDashboardStats(userProfile.outreachThreshold || 70);
    const outreachPaused = db.isOutreachPaused();
    res.json({ ...stats, outreachPaused });
  } catch (err) {
    logger.error('jobs', 'Failed to get dashboard stats', {
      errorCode: ErrorCodes.DB_ERROR,
      error: err,
    });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/jobs/outreach
 * Returns recent outreach log
 */
router.get('/outreach', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const outreach = db.getRecentOutreach(limit);
  res.json({ outreach });
});

/**
 * POST /api/jobs/retry
 * Re-run analysis on failed jobs
 */
router.post('/retry', async (req, res) => {
  try {
    const failedJobs = db.getFailedJobs();
    const results = [];

    for (const job of failedJobs) {
      try {
        const analysis = await gemini.analyzeJobFit(
          {
            jobTitle: job.job_title,
            company: job.company,
            location: job.location,
            jobDescription: job.job_description,
          },
          userProfile
        );

        db.updateJobAnalysis(job.id, analysis);
        results.push({
          jobId: job.id,
          status: 'success',
          matchScore: analysis.matchScore,
        });

        logger.info('jobs', `Retry succeeded for job ${job.id}: score ${analysis.matchScore}`);
      } catch (err) {
        results.push({ jobId: job.id, status: 'failed', error: err.message });
        logger.warn('jobs', `Retry failed for job ${job.id}`, { error: err.message });
      }

      // Rate limit: 1 second between API calls
      await new Promise((r) => setTimeout(r, 1000));
    }

    res.json({
      retried: failedJobs.length,
      results,
    });
  } catch (err) {
    logger.error('jobs', 'Retry failed jobs error', {
      errorCode: ErrorCodes.GEMINI_ERROR,
      error: err,
    });
    res.status(500).json({ error: 'Retry failed' });
  }
});

/**
 * POST /api/outreach/toggle
 * Pause or resume global outreach
 */
router.post('/outreach/toggle', (req, res) => {
  const current = db.isOutreachPaused();
  const newState = !current;
  db.setSetting('outreach_paused', String(newState));

  logger.info('jobs', `Outreach ${newState ? 'paused' : 'resumed'}`);

  res.json({
    outreachPaused: newState,
    message: newState ? 'Outreach paused' : 'Outreach resumed',
  });
});

/**
 * GET /api/jobs/export
 * Export all database data as JSON
 */
router.get('/export', (req, res) => {
  try {
    const data = db.exportAllData();
    res.json(data);
  } catch (err) {
    logger.error('jobs', 'Export failed', {
      errorCode: ErrorCodes.DB_ERROR,
      error: err,
    });
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
