/**
 * JobFill Pro v2 — Recruiter Discovery Service
 * 4-tier strategy: pattern generation → careers page scraping → Gemini AI → fallback
 */

const { logger } = require('./logger');
const { tier1Search } = require('./discovery-tier1');

// ─── Tier 1: Email Pattern Generation ────────────────────────────────────────

/**
 * Generate common recruiter email patterns for a domain, prioritizing name if available
 * @returns {RecruiterContact[]}
 */
function generateEmailPatterns(domain, recruiterName) {
  if (!domain) return [];

  const patterns = [];

  // Generate name permutations if we have a recruiter name
  if (recruiterName) {
    const cleanName = recruiterName.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const parts = cleanName.split(' ').filter(Boolean);
    
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const fi = first[0];
      const li = last[0];
      
      patterns.push(
        { local: `${first}.${last}`, confidence: 85, name: recruiterName },
        { local: `${first}${last}`, confidence: 80, name: recruiterName },
        { local: `${first}`, confidence: 75, name: recruiterName },
        { local: `${fi}${last}`, confidence: 75, name: recruiterName },
        { local: `${first}.${li}`, confidence: 70, name: recruiterName }
      );
    } else if (parts.length === 1) {
      patterns.push({ local: parts[0], confidence: 75, name: recruiterName });
    }
  }

  // Generic Fallbacks (lowered confidence to prefer named contacts)
  const genericPatterns = [
    { local: 'talent', confidence: 45 },
    { local: 'recruitment', confidence: 45 },
    { local: 'careers', confidence: 40 },
    { local: 'jobs', confidence: 40 },
    { local: 'recruiting', confidence: 40 },
    { local: 'hr', confidence: 30 },
  ];
  
  patterns.push(...genericPatterns);

  return patterns.map((p) => ({
    name: p.name || null,
    email: `${p.local}@${domain}`,
    title: null,
    confidence: p.confidence,
    source: 'pattern',
  }));
}

// ─── Tier 2: Careers Page Scraping ───────────────────────────────────────────

/**
 * Scrape company careers/about/team pages for recruiter contacts using Puppeteer
 * @returns {Promise<RecruiterContact[]>}
 */
async function tier2PuppeteerScrape(domains, providedUrls = []) {
  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const results = [];

  const urlsToCheck = providedUrls.length > 0
    ? providedUrls
    : domains.flatMap(d => [
        `https://${d}/careers`,
        `https://${d}/about/team`,
        `https://${d}/contact`,
      ]);

  let browser;
  try {
    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    for (const url of urlsToCheck.slice(0, 6)) { // cap — don't scrape indefinitely
      let page;
      try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (compatible; JobFillPro/2.0)');
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

        // Get fully rendered text (post-JS execution)
        const bodyText = await page.evaluate(() => document.body.innerText);
        const found = [...new Set(bodyText.match(EMAIL_REGEX) || [])];

        for (const email of found) {
          // Filter out placeholder/noreply addresses
          if (/example|placeholder|noreply|no-reply/i.test(email)) continue;
          results.push({ email: email.toLowerCase(), source: 'puppeteer_scrape', url, confidence: 65 });
        }
      } catch (err) {
        logger.debug('recruiter', `Puppeteer skipped ${url}: ${err.message}`);
      } finally {
        if (page && !page.isClosed()) await page.close().catch(() => {});
      }
    }
  } catch (err) {
    logger.warn('recruiter', `Puppeteer launch failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

/**
 * Assign confidence score based on email local part
 */
function getEmailConfidence(email) {
  const local = email.split('@')[0].toLowerCase();

  if (/recruit/i.test(local) || /talent/i.test(local)) return 90;
  if (/hiring/i.test(local) || /people/i.test(local)) return 85;
  if (/careers/i.test(local) || /jobs/i.test(local)) return 65;
  if (/hr/i.test(local)) return 55;

  return 40;
}

/**
 * Try to find a person's name near an email element
 */
function findAdjacentName($, el) {
  const parent = $(el).closest('div, li, td, section');
  const text = parent.text().trim();
  // Look for capitalized name patterns
  const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
  return nameMatch ? nameMatch[1] : null;
}

/**
 * Try to find a job title near an email element
 */
function findAdjacentTitle($, el) {
  const parent = $(el).closest('div, li, td, section');
  const text = parent.text().toLowerCase();
  const titles = [
    'recruiter', 'talent acquisition', 'people operations',
    'hiring manager', 'hr manager', 'talent partner',
    'recruitment lead', 'engineering manager',
  ];
  for (const title of titles) {
    if (text.includes(title)) return title;
  }
  return null;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Discover recruiter contacts using the improved 4-tier strategy:
 * Tier 0 — Extract email directly from the Job Description (highest trust)
 * Tier 1 — Use Gemini AI + Google Search to find real recruiter email by name + company
 * Tier 2 — Scrape company careers/contact pages for visible emails
 * Tier 3 — Generic fallback: hr@domain, careers@domain (low confidence, flagged as unverified)
 *
 * @returns {DiscoverResponse}
 */
async function discoverRecruiters(company, companyDomain, jobTitle, recruiterName, jobDescription) {
  const allContacts = [];
  const careersPages = [];
  let domainUsed = companyDomain;

  // Infer domain from company name if not provided
  if (!domainUsed) {
    domainUsed = inferDomain(company);
  }

  logger.info('recruiter', `Starting discovery for ${company}`, { domain: domainUsed, recruiterName });

  // ─── Tier 0: Job Description Email Extraction ────────────────────────
  if (jobDescription) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const foundEmails = jobDescription.match(emailRegex);
    if (foundEmails && foundEmails.length > 0) {
      // Filter out noreply/support/info addresses
      const validEmails = foundEmails.filter(
        (e) => !/noreply|no-reply|support|info@|admin@|press|media|legal|sales|donotreply/i.test(e)
      );
      if (validEmails.length > 0) {
        const primaryEmail = validEmails[0].toLowerCase();
        logger.info('recruiter', `Tier 0: Found email in JD: ${primaryEmail}`);
        allContacts.push({
          name: recruiterName || null,
          email: primaryEmail,
          title: null,
          confidence: 95,
          source: 'jd_extraction',
          verified: true,
        });
        return buildResponse(allContacts, careersPages, domainUsed || 'unknown');
      }
    }
  }

  // ─── Tier 1: Hunter.io Search (by recruiter name + company) ────────────
  if (recruiterName || domainUsed) {
    try {
      const hunterContacts = await tier1Search({ recruiterName, companyDomain: domainUsed });
      if (hunterContacts.length > 0) {
        allContacts.push(...hunterContacts);
        const topContact = hunterContacts[0];
        logger.info('recruiter', `Tier 1 Hunter: Found ${topContact.email} (confidence: ${topContact.confidence})`);
        
        if (topContact.confidence >= 70) {
          return buildResponse(allContacts, careersPages, domainUsed || 'unknown');
        }
      } else {
        logger.info('recruiter', 'Tier 1 Hunter: No result or API key missing');
      }
    } catch (err) {
      logger.warn('recruiter', 'Tier 1 Hunter discovery failed', { error: err.message });
    }
  }

  // ─── Tier 2: Careers page scraping ─────────────────────────────────
  if (domainUsed) {
    try {
      const scrapeResult = await scrapeCareersPages(domainUsed);
      allContacts.push(...scrapeResult.contacts);
      careersPages.push(...scrapeResult.careersPages);
      logger.info('recruiter', `Tier 2: Found ${scrapeResult.contacts.length} contacts from ${scrapeResult.careersPages.length} pages`);

      const highConf = scrapeResult.contacts.find((c) => c.confidence >= 60);
      if (highConf) {
        logger.info('recruiter', `Tier 2 sufficient — top: ${highConf.email} (${highConf.confidence})`);
        return buildResponse(allContacts, careersPages, domainUsed);
      }
    } catch (err) {
      logger.warn('recruiter', 'Tier 2 scraping failed', { error: err.message });
    }
  }

  // ─── Tier 3: Generic Fallback (hr@, careers@, jobs@) ───────────────
  // These are low-confidence guesses — flagged as unverified for user review
  if (domainUsed) {
    const genericAddresses = [
      { local: 'hr', confidence: 40 },
      { local: 'careers', confidence: 40 },
      { local: 'jobs', confidence: 35 },
      { local: 'recruiting', confidence: 35 },
      { local: 'talent', confidence: 35 },
      { local: 'recruitment', confidence: 35 },
    ];

    for (const g of genericAddresses) {
      allContacts.push({
        name: null,
        email: `${g.local}@${domainUsed}`,
        title: null,
        confidence: g.confidence,
        source: 'generic_fallback',
        verified: false,
      });
    }
    logger.info('recruiter', `Tier 3: Added ${genericAddresses.length} generic fallback emails`);
  }

  // Collect careers pages if we haven't found any yet
  if (domainUsed && careersPages.length === 0) {
    const fallbackPaths = ['/careers', '/jobs'];
    for (const p of fallbackPaths) {
      const url = `https://${domainUsed}${p}`;
      try {
        const resp = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) careersPages.push(url);
      } catch (e) {
        // ignore
      }
    }
  }

  logger.info('recruiter', `Discovery complete: ${allContacts.length} contacts, ${careersPages.length} careers pages`);
  return buildResponse(allContacts, careersPages, domainUsed || 'unknown');
}

/**
 * Build the standardized response, sorted by confidence
 */
function buildResponse(contacts, careersPages, domainUsed) {
  // Deduplicate by email
  const seen = new Set();
  const unique = contacts.filter((c) => {
    if (seen.has(c.email)) return false;
    seen.add(c.email);
    return true;
  });

  // Sort by confidence descending
  unique.sort((a, b) => b.confidence - a.confidence);

  return {
    contacts: unique,
    careersPages: [...new Set(careersPages)],
    domainUsed,
  };
}

/**
 * Infer company domain from name (best-effort)
 */
function inferDomain(company) {
  if (!company) return null;

  // Static mapping for well-known companies
  const knownDomains = {
    google: 'google.com',
    microsoft: 'microsoft.com',
    apple: 'apple.com',
    amazon: 'amazon.com',
    meta: 'meta.com',
    facebook: 'meta.com',
    netflix: 'netflix.com',
    stripe: 'stripe.com',
    uber: 'uber.com',
    airbnb: 'airbnb.com',
    twitter: 'x.com',
    x: 'x.com',
    spotify: 'spotify.com',
    slack: 'slack.com',
    salesforce: 'salesforce.com',
    oracle: 'oracle.com',
    adobe: 'adobe.com',
    atlassian: 'atlassian.com',
    shopify: 'shopify.com',
    github: 'github.com',
    gitlab: 'gitlab.com',
    cloudflare: 'cloudflare.com',
    datadog: 'datadoghq.com',
    figma: 'figma.com',
    notion: 'notion.so',
    vercel: 'vercel.com',
    coinbase: 'coinbase.com',
    binance: 'binance.com',
    razorpay: 'razorpay.com',
    flipkart: 'flipkart.com',
    swiggy: 'swiggy.com',
    zomato: 'zomato.com',
    zerodha: 'zerodha.com',
    cred: 'cred.club',
    phonepe: 'phonepe.com',
    paytm: 'paytm.com',
    infosys: 'infosys.com',
    tcs: 'tcs.com',
    wipro: 'wipro.com',
  };

  const normalized = company.toLowerCase()
    .replace(/\s*(pvt\.?|private|ltd\.?|limited|inc\.?|corp\.?|llc|co\.?)\s*/gi, '')
    .trim();

  if (knownDomains[normalized]) {
    return knownDomains[normalized];
  }

  // Best-effort: company name → .com
  const slug = normalized.replace(/[^a-z0-9]/g, '');
  return slug ? `${slug}.com` : null;
}

module.exports = {
  discoverRecruiters,
  generateEmailPatterns,
  tier2PuppeteerScrape,
  inferDomain,
};
