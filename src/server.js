/**
 * JobFill Pro v2 — Express Server
 * Local backend for AI recruiter outreach pipeline.
 * Runs on localhost:7823 (hardcoded — extension manifest depends on this port).
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDB } = require("./db/queries");
const { initGemini } = require("./services/gemini");
const { initMailer } = require("./services/mailer");
const { logger } = require("./services/logger");

const app = express();
const PORT = process.env.PORT || 7823;

// ─── Middleware ──────────────────────────────────────────────────────────────

// CORS: allow requests from all origins since content scripts run on job boards (e.g. linkedin.com)
app.use(cors());

app.use(express.json({ limit: "1mb" }));

// Serve static test page
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
  logger.info("server", `${req.method} ${req.path}`, {
    body:
      req.method === "POST" ? { keys: Object.keys(req.body || {}) } : undefined,
  });
  next();
});

// ─── Routes ─────────────────────────────────────────────────────────────────

app.use("/api/analyze", require("./routes/analyze"));
app.use("/api/discover", require("./routes/discover"));
app.use("/api/outreach", require("./routes/outreach"));
app.use("/api/jobs", require("./routes/jobs"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    version: "2.0.0",
    uptime: Math.round(process.uptime()),
    geminiReady:
      !!process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== "your_gemini_api_key_here",
    mailerReady: require("./services/mailer").isMailerReady(),
  });
});

// ─── Error Handler ──────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  logger.error("server", "Unhandled error", {
    error: err,
    meta: { path: req.path, method: req.method },
  });
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ──────────────────────────────────────────────────────────────────

async function start() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║        JobFill Pro v2 — Backend Server       ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Initialize database
  try {
    initDB();
    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ Database initialization failed:", err.message);
    process.exit(1);
  }

  // Initialize Gemini
  const geminiReady = initGemini();
  console.log(
    geminiReady
      ? "✅ Gemini AI ready"
      : "⚠️  Gemini AI not configured (add GEMINI_API_KEY to .env)",
  );

  // Initialize Mailer
  const mailerReady = initMailer();
  console.log(
    mailerReady
      ? "✅ Email sender ready"
      : "⚠️  Email sender not configured (add Gmail OAuth2 to .env)",
  );

  // Start server
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Dashboard API: http://localhost:${PORT}/api/jobs/stats`);
      console.log(`❤️  Health check:  http://localhost:${PORT}/api/health\n`);
    });
  } else {
    console.log("⚡ Running in Vercel Serverless environment");
  }
}

// Only start when executing directly or not in Vercel
start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

module.exports = app;
