/**
 * JobFill Pro v2 — Gemini AI Service
 * All Gemini API calls: job analysis, email generation, recruiter discovery.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logger, ErrorCodes } = require("./logger");

let genAI;
let model;

function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    logger.warn(
      "gemini",
      "No valid GEMINI_API_KEY found in .env — AI features disabled",
    );
    return false;
  }
  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
  logger.info("gemini", "Gemini AI initialized with gemini-3.1-flash-lite");
  return true;
}

/**
 * Parse a JSON response from Gemini, handling markdown fences and preamble
 */
function parseJSONResponse(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON object from response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Failed to parse JSON from Gemini response");
  }
}

/**
 * Call Gemini with retry logic
 */
async function callGemini(prompt, { timeoutMs = 3000, retries = 1 } = {}) {
  if (!model) {
    throw new Error("Gemini not initialized");
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const result = await model.generateContent(prompt);
      clearTimeout(timeout);

      const text = result.response.text();
      return text;
    } catch (err) {
      if (attempt < retries) {
        const delay = (attempt + 1) * 2000;
        logger.warn(
          "gemini",
          `Attempt ${attempt + 1} failed, retrying in ${delay}ms`,
          {
            error: err.message,
          },
        );
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Call Gemini and enforce valid JSON response with retries
 */
async function callGeminiJSON(prompt, options = {}) {
  let text = await callGemini(prompt, options);
  for (let i = 0; i < 2; i++) {
    try {
      return parseJSONResponse(text);
    } catch (e) {
      logger.warn("gemini", `JSON parse failed (attempt ${i+1}), asking model to fix.`);
      text = await callGemini(`The following text is NOT valid JSON. Fix it and return ONLY valid JSON.\n\n${text}`, options);
    }
  }
  return parseJSONResponse(text); // Final attempt throws if fails
}

// ─── Job Analysis ────────────────────────────────────────────────────────────

/**
 * Analyze job-candidate fit using Gemini
 * @returns {AnalysisResult}
 */
async function analyzeJobFit(jobPayload, userProfile) {
  const prompt = `SYSTEM:
You are an expert technical recruiter evaluating candidate-job fit.
You must return ONLY valid JSON matching the AnalysisResult schema.
No preamble. No markdown. No explanation outside the JSON.

USER:
Evaluate this candidate's fit for the following job posting.

--- JOB POSTING ---
Title: ${jobPayload.jobTitle}
Company: ${jobPayload.company}
Location: ${jobPayload.location || "Not specified"}
Description:
${(jobPayload.jobDescription || "").slice(0, 4000)}

--- CANDIDATE PROFILE ---
Name: ${userProfile.name}
Current Title: ${userProfile.currentTitle}
Years of Experience: ${userProfile.yearsExperience}
Skills: ${userProfile.skills.join(", ")}
Summary: ${userProfile.summary}
Recent Work:
${userProfile.recentWork
  .map((w) => `- ${w.title} at ${w.company}: ${w.bullets.join("; ")}`)
  .join("\n")}

--- SCORING CRITERIA ---
- Technical skill overlap (40% of score)
- Experience level match (25% of score)
- Domain/industry relevance (20% of score)
- Location compatibility (15% of score)

Return JSON exactly:
{
  "matchScore": <integer 0-100>,
  "recommendation": <"CONTACT" if matchScore >= ${userProfile.outreachThreshold || 70}, else "SKIP">,
  "rationale": "<1-2 sentences>",
  "strengths": ["<skill>", ...],
  "gaps": ["<skill>", ...],
  "suggestedTone": "<enthusiastic|professional|technical>"
}`;

  const parsed = await callGeminiJSON(prompt, { timeoutMs: 8000, retries: 1 });

  // Validate and clamp
  parsed.matchScore = Math.round(Number(parsed.matchScore) || 0);
  parsed.matchScore = Math.max(0, Math.min(100, parsed.matchScore));

  // Enforce threshold logic
  const threshold = userProfile.outreachThreshold || 75;
  if (parsed.matchScore >= threshold) {
    parsed.recommendation = "CONTACT";
  } else {
    parsed.recommendation = "SKIP";
  }

  parsed.strengths = parsed.strengths || [];
  parsed.gaps = parsed.gaps || [];
  parsed.suggestedTone = parsed.suggestedTone || "professional";

  return parsed;
}

// ─── Email Generation ────────────────────────────────────────────────────────

/**
 * Generate a recruiter outreach email
 * @returns {OutreachEmail}
 */
async function generateOutreachEmail(job, analysis, contact, userProfile) {
  const prompt = `SYSTEM:
You are generating an outreach email on behalf of a job applicant.
Rules:
1. You MUST use the exact template provided below. Do not change the intro, middle, or sign-off.
2. The ONLY thing you should generate is 1-2 sentences in the middle that tie the candidate's skills to the specific job applied for.
3. The subject line must be under 60 characters and name the job title.
4. Return ONLY valid JSON. No markdown. No preamble.

EMAIL TEMPLATE:
Hi [Recruiter Name / Hiring Team],

I’m a Full-Stack MERN developer with 2+ years of experience building scalable production-grade applications using Next.js, TypeScript, Node.js, MongoDB, and AWS.

I’ve worked on 15+ projects, including 5+ end-to-end applications independently owned and developed by me — from system design to deployment. My experience includes real-time systems, multi-tenant SaaS dashboards, e-commerce platforms, and event-driven backend architectures.

[GENERATE 1-2 SENTENCES HERE: Mention why the candidate is a fit for ${job.jobTitle} at ${job.company} by referencing these strengths: ${(analysis.strengths || []).join(", ")}. Keep the tone ${analysis.suggestedTone || "professional"}.]

Currently looking for strong Software Engineer / Full-Stack opportunities where I can contribute to high-impact products.

Would love to connect and explore relevant opportunities.

– Arpit Patidar
– Portfolio: portfolio-v1-arpit-patidars-projects-8854eb72.vercel.app
GitHub: https://github.com/arpitpatidar01
LinkedIn: https://www.linkedin.com/in/arpit-patidar-92154a20b/

USER:
Generate the recruiter outreach email using the template above.

Candidate: ${userProfile.name}
Role applied for: ${job.jobTitle} at ${job.company}
Recruiter name: ${job.recruiterName || contact.name || "Hiring Team"}
${job.recruiterName ? `CRITICAL RULE: You MUST start the email with "Hi ${job.recruiterName}," instead of "Hi Hiring Team,".` : 'CRITICAL RULE: Start the email with "Hi Hiring Team,".'}

Return JSON:
{
  "subject": "<string under 60 chars>",
  "bodyHtml": "<full HTML email body>",
  "bodyText": "<plain text version>"
}`;

  let email = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = await callGeminiJSON(prompt, { timeoutMs: 8000, retries: 0 });

    parsed.generatedAt = new Date().toISOString();
    const validation = validateEmail(parsed);

    if (validation.valid) {
      email = parsed;
      break;
    }

    logger.warn("gemini", `Email validation failed (attempt ${attempt + 1})`, {
      issues: validation.issues,
    });

    if (attempt === 0) {
      // Retry once
      continue;
    }
  }

  return email;
}

/**
 * Validate outreach email before sending
 */
function validateEmail(email) {
  const issues = [];
  const body = email.bodyText || "";

  const wordCount = body.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 120 || wordCount > 220) {
    issues.push(`word_count_out_of_range (${wordCount})`);
  }

  const forbidden = [
    "I am writing to",
    "I came across",
    "great fit",
    "find attached",
  ];
  forbidden.forEach((phrase) => {
    if (body.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push(`forbidden_phrase: ${phrase}`);
    }
  });

  if ((email.subject || "").length > 60) {
    issues.push("subject_too_long");
  }

  return { valid: issues.length === 0, issues };
}

// ─── Recruiter Discovery (Tier 3 — AI-assisted) ─────────────────────────────

/**
 * Use Gemini to discover recruiter contact info
 */
async function discoverRecruiterViaAI(company, jobTitle, recruiterName, domain) {
  // Build a targeted prompt based on what info we have
  let searchTarget;
  if (recruiterName) {
    searchTarget = `Find the real, verified work email address for "${recruiterName}" who works at ${company}. This person is likely a recruiter, hiring manager, or part of the talent/HR team.`;
  } else {
    searchTarget = `Find the real email address of the recruiter, hiring manager, or talent acquisition person at ${company} who would handle hiring for a "${jobTitle}" role.`;
  }

  const prompt = `SYSTEM: You are a professional email research assistant. Your job is to find REAL, DELIVERABLE email addresses — not guessed or fabricated ones.

TASK:
${searchTarget}

RULES:
1. Only return an email you are confident actually exists. Do NOT fabricate or guess emails.
2. If you know the company's email format (e.g., firstname.lastname@company.com) AND you know the person's real name from a verifiable source, you may construct the email — but state confidence accordingly.
3. If ${domain ? `the company domain is ${domain}` : 'you can infer the company domain'}, the email should ideally match that domain.
4. If you cannot find a specific person's email, look for the company's general HR/recruiting email (e.g., careers@company.com, hr@company.com, talent@company.com).
5. Search for: "${recruiterName || ''} ${company} email", "${company} recruiter email", "${company} careers contact email".

Return ONLY valid JSON. No preamble. No markdown.

If found with confidence:
{
  "found": true,
  "name": "<full name or null>",
  "email": "<email address>",
  "title": "<job title or null>",
  "confidence": <integer 0-100>,
  "reasoning": "<brief explanation of how you found this>"
}

If not found:
{ "found": false, "reasoning": "<why not found>" }`;

  try {
    const parsed = await callGeminiJSON(prompt, { timeoutMs: 8000, retries: 1 });

    if (parsed.found && parsed.email) {
      const email = parsed.email.toLowerCase().trim();
      
      // Validate: reject obviously fake patterns
      if (/example\.com|test\.com|placeholder/i.test(email)) {
        logger.warn('gemini', `AI returned fake email: ${email}`);
        return null;
      }

      // Boost confidence if the email domain matches the company domain
      let adjustedConfidence = Math.min(parsed.confidence || 50, 85);
      if (domain && email.endsWith(`@${domain}`)) {
        adjustedConfidence = Math.min(adjustedConfidence + 10, 90);
      }

      logger.info('gemini', `AI reasoning: ${parsed.reasoning || 'none'}`);

      return {
        name: parsed.name || recruiterName || null,
        email,
        title: parsed.title || null,
        confidence: adjustedConfidence,
        source: 'ai_search',
        verified: false,
      };
    }
    return null;
  } catch (err) {
    logger.warn('gemini', 'AI recruiter discovery failed', {
      error: err.message,
    });
    return null;
  }
}

module.exports = {
  initGemini,
  analyzeJobFit,
  generateOutreachEmail,
  validateEmail,
  discoverRecruiterViaAI,
};
