/**
 * JobFill Pro v2 — Analyze Route
 * POST /api/analyze — AI-powered job-candidate fit analysis
 */

const express = require('express');
const router = express.Router();
const db = require('../db/queries');
const gemini = require('../services/gemini');
const userProfile = require('../config/user-profile');
const { logger, ErrorCodes } = require('../services/logger');

/**
 * POST /api/analyze
 * Receives a JobPayload, analyzes fit with Gemini, stores result
 */
router.post('/', async (req, res) => {
  const job = req.body.job;

  if (!job || !job.jobTitle || !job.company || !job.jobUrl || !job.jobDescription) {
    logger.warn('analyze', 'Validation failed: Missing required fields', { jobKeys: job ? Object.keys(job) : null });
    return res.status(400).json({
      error: 'Invalid JobPayload — missing required fields (jobTitle, company, jobUrl, jobDescription)',
    });
  }

  // Short description guard
  if ((job.jobDescription || '').length < 100) {
    logger.warn('analyze', 'Validation failed: Job description too short', { length: job.jobDescription ? job.jobDescription.length : 0 });
    return res.status(400).json({
      error: 'Job description too short (< 100 chars) — aborting analysis',
    });
  }

  try {
    // Check if job already exists and was recently analyzed
    const existing = db.getRecentJobByUrl(job.jobUrl, 7);
    if (existing) {
      const fullJob = db.getJobById(existing.id);
      return res.json({
        jobId: existing.id,
        alreadyAnalyzed: true,
        matchScore: fullJob.match_score,
        recommendation: fullJob.recommendation,
        rationale: fullJob.rationale,
        strengths: JSON.parse(fullJob.strengths || '[]'),
        gaps: JSON.parse(fullJob.gaps || '[]'),
        suggestedTone: fullJob.suggested_tone,
      });
    }

    // Insert job into DB
    const jobId = db.insertJob({
      ...job,
      extractedAt: job.extractedAt || new Date().toISOString(),
    });

    logger.info('analyze', `Job inserted: ${job.jobTitle} at ${job.company}`, { jobId });

    // Run Gemini analysis
    let analysis;
    try {
      analysis = await gemini.analyzeJobFit(job, userProfile);
    } catch (err) {
      // First retry
      try {
        await new Promise((r) => setTimeout(r, 2000));
        analysis = await gemini.analyzeJobFit(job, userProfile);
      } catch (retryErr) {
        db.markJobFailed(jobId, 'ANALYSIS_FAILED');
        logger.error('analyze', 'Analysis failed after retry', {
          errorCode: ErrorCodes.ANALYSIS_FAILED,
          jobId,
          error: retryErr,
        });
        return res.status(500).json({
          error: ErrorCodes.ANALYSIS_FAILED,
          jobId,
          message: 'AI analysis failed — job saved for retry',
        });
      }
    }

    // Store analysis result
    db.updateJobAnalysis(jobId, analysis);

    // Log based on score
    const threshold = userProfile.outreachThreshold || 70;
    if (analysis.matchScore < 50) {
      logger.info('analyze', `Low match (${analysis.matchScore}) — silent skip`, { jobId });
    } else if (analysis.matchScore < threshold) {
      logger.info('analyze', `Medium match (${analysis.matchScore}) — skip, reason: ${analysis.rationale}`, { jobId });
    } else {
      logger.info('analyze', `High match (${analysis.matchScore}) — CONTACT recommended`, { jobId });
    }

    res.json({
      jobId,
      alreadyAnalyzed: false,
      matchScore: analysis.matchScore,
      recommendation: analysis.recommendation,
      rationale: analysis.rationale,
      strengths: analysis.strengths,
      gaps: analysis.gaps,
      suggestedTone: analysis.suggestedTone,
    });
  } catch (err) {
    logger.error('analyze', 'Unexpected error in analyze route', {
      errorCode: ErrorCodes.GEMINI_ERROR,
      error: err,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
