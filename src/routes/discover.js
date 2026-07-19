/**
 * JobFill Pro v2 — Discover Route
 * POST /api/discover — Recruiter contact discovery
 */

const express = require('express');
const router = express.Router();
const db = require('../db/queries');
const recruiterService = require('../services/recruiter');
const { logger, ErrorCodes } = require('../services/logger');

/**
 * POST /api/discover
 * Discovers recruiter contacts for a given company
 */
router.post('/', async (req, res) => {
  const { company, companyDomain, jobTitle, jobUrl, jobId, recruiterName, jobDescription } = req.body;

  if (!company || !jobTitle) {
    return res.status(400).json({
      error: 'Missing required fields: company, jobTitle',
    });
  }

  try {
    // Run 4-tier discovery
    const result = await recruiterService.discoverRecruiters(
      company,
      companyDomain,
      jobTitle,
      recruiterName,
      jobDescription
    );

    // Store contacts in DB if we have a jobId
    const resolvedJobId = jobId || (jobUrl ? db.getJobByUrl(jobUrl)?.id : null);

    if (resolvedJobId) {
      for (const contact of result.contacts) {
        try {
          db.insertContact({
            jobId: resolvedJobId,
            name: contact.name,
            email: contact.email,
            title: contact.title,
            confidence: contact.confidence,
            source: contact.source,
          });
        } catch (e) {
          // Ignore duplicate inserts
        }
      }

      // Store careers pages
      for (const url of result.careersPages) {
        try {
          const pageType = url.includes('/careers')
            ? 'careers'
            : url.includes('/contact')
              ? 'contact'
              : url.includes('/team')
                ? 'team'
                : 'careers';
          db.insertCareersPage({
            jobId: resolvedJobId,
            url,
            pageType,
          });
        } catch (e) {
          // Ignore duplicates
        }
      }
    }

    // Filter to only contacts with confidence >= 60 for the response
    const viableContacts = result.contacts.filter((c) => c.confidence >= 60);

    if (viableContacts.length === 0) {
      logger.info('discover', `No viable contacts for ${company}`, {
        totalFound: result.contacts.length,
        careersPages: result.careersPages.length,
      });
    } else {
      logger.info('discover', `Found ${viableContacts.length} viable contacts for ${company}`, {
        topContact: viableContacts[0].email,
        topConfidence: viableContacts[0].confidence,
      });
    }

    res.json({
      contacts: result.contacts,
      viableContacts,
      careersPages: result.careersPages,
      domainUsed: result.domainUsed,
    });
  } catch (err) {
    logger.error('discover', 'Recruiter discovery failed', {
      errorCode: ErrorCodes.NO_RECRUITER_FOUND,
      error: err,
    });
    res.status(500).json({ error: 'Discovery failed' });
  }
});

module.exports = router;
