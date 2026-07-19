'use strict';

const logger = require('./logger');
const validator = require('deep-email-validator');

// ─── GitHub API Verification ────────────────────────────────────────────────

async function githubSearch(recruiterName) {
  if (!process.env.GITHUB_TOKEN) {
    logger.debug('discovery-tier1', 'No GITHUB_TOKEN set. Skipping GitHub API.');
    return [];
  }
  if (!recruiterName) return [];

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${process.env.GITHUB_TOKEN}`,
    'User-Agent': 'JobFillPro/2.0'
  };

  const query = encodeURIComponent(recruiterName.trim());
  try {
    const searchRes = await fetch(`https://api.github.com/search/users?q=${query}`, { headers });
    if (!searchRes.ok) return [];
    
    const searchData = await searchRes.json();
    if (!searchData.items || searchData.items.length === 0) return [];

    const topUser = searchData.items[0];
    const userRes = await fetch(`https://api.github.com/users/${topUser.login}`, { headers });
    if (!userRes.ok) return [];

    const userData = await userRes.json();
    if (userData.email) {
      return [{
        email: userData.email.toLowerCase(),
        confidence: 90,
        source: 'github_api_profile',
        name: userData.name || recruiterName
      }];
    }

    // Try finding email from public events if profile email is null
    const eventsRes = await fetch(`https://api.github.com/users/${topUser.login}/events/public`, { headers });
    if (!eventsRes.ok) return [];
    
    const eventsData = await eventsRes.json();
    for (const event of eventsData) {
      if (event.type === 'PushEvent' && event.payload && event.payload.commits) {
        for (const commit of event.payload.commits) {
          if (commit.author && commit.author.email && !commit.author.email.includes('noreply.github.com')) {
            return [{
              email: commit.author.email.toLowerCase(),
              confidence: 85,
              source: 'github_api_commits',
              name: commit.author.name || recruiterName
            }];
          }
        }
      }
    }
  } catch (err) {
    logger.warn('discovery-tier1', `GitHub API search failed: ${err.message}`);
  }

  return [];
}

// ─── SMTP Pattern Verification ──────────────────────────────────────────────

function generatePatterns(firstName, lastName, domain) {
  const f = firstName.toLowerCase().trim();
  const l = (lastName || '').toLowerCase().trim();
  const d = domain.toLowerCase().trim();

  const patterns = [];
  if (f && l) {
    patterns.push(`${f}.${l}@${d}`);
    patterns.push(`${f}${l}@${d}`);
    patterns.push(`${f[0]}${l}@${d}`);
    patterns.push(`${f}_${l}@${d}`);
    patterns.push(`${f}@${d}`);
  } else if (f) {
    patterns.push(`${f}@${d}`);
  }
  return patterns;
}

async function smtpPatternVerify(firstName, lastName, domain) {
  const patterns = generatePatterns(firstName, lastName, domain);
  const results = [];

  for (const email of patterns) {
    try {
      const res = await validator.validate({
        email,
        validateRegex: true,
        validateMx: true,
        validateTypo: false,
        validateDisposable: true,
        validateSMTP: true
      });

      if (res.valid) {
        results.push({
          email,
          confidence: 80, // Verified via SMTP
          source: 'smtp_pattern_verify',
          name: `${firstName} ${lastName || ''}`.trim()
        });
        // Once we find a working pattern, we can stop or keep going. Stopping saves time.
        break;
      }
    } catch (err) {
      logger.debug('discovery-tier1', `SMTP validation error for ${email}: ${err.message}`);
    }
  }

  return results;
}

// ─── Tier 1 Entry Point ─────────────────────────────────────────────────────

async function tier1Search({ recruiterName, companyDomain }) {
  if (!companyDomain) return [];

  const results = [];
  
  if (recruiterName) {
    // 1. Try GitHub API
    const ghResults = await githubSearch(recruiterName);
    if (ghResults.length > 0) {
      logger.info('discovery-tier1', `Found email via GitHub API: ${ghResults[0].email}`);
      results.push(...ghResults);
      return results; // Return early if we have a high confidence github hit
    }

    // 2. Try SMTP Pattern Verify
    const parts = recruiterName.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    const smtpResults = await smtpPatternVerify(firstName, lastName, companyDomain);
    if (smtpResults.length > 0) {
      logger.info('discovery-tier1', `Found email via SMTP verify: ${smtpResults[0].email}`);
      results.push(...smtpResults);
      return results;
    }
  }

  // If no name is provided, we can't do GitHub or Pattern Generation reliably.
  return results;
}

module.exports = { tier1Search };
