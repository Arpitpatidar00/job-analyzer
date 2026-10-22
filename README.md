# JobFill Pro — Job Analyzer

Local backend that turns job postings into qualified, personalised recruiter outreach. It scores how well a job fits your profile with Gemini, finds the right recruiter contact, validates the address and sends the email — while keeping a full delivery log.

**Stack:** Node.js · Express · Google Gemini · SQLite (better-sqlite3) · Playwright / Puppeteer · Cheerio · Nodemailer (Gmail OAuth2)

## How it works

1. **Analyze** — `POST /api/analyze` receives a job payload, skips duplicates and recently analysed jobs, and asks Gemini for a candidate-fit score against `src/config/user-profile.js`.
2. **Discover** — `POST /api/discover` finds a recruiter address with a tiered strategy: GitHub API lookups and SMTP-verified email patterns first, then careers-page scraping, then Gemini, then a fallback.
3. **Validate** — addresses are checked before anything is sent.
4. **Outreach** — `POST /api/outreach` sends the message via Gmail OAuth2; failures can be retried.
5. **Track** — `GET /api/jobs`, `/api/jobs/stats`, `/api/jobs/outreach`, `/api/jobs/export` expose history and delivery status.

## Run locally

```bash
cp .env.example .env   # GEMINI_API_KEY, GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN
npm install
npm run dev            # node --watch src/server.js
```

Edit `src/config/user-profile.js` with your own profile before analysing jobs. Requires Node.js ≥ 18.
