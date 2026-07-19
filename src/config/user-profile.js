/**
 * JobFill Pro v2 — User Profile Configuration
 * Auto-migrated from v1 config.js. Edit this file to change your outreach profile.
 */

module.exports = {
  // ─── Identity ───────────────────────────────────────────────────────────────
  name: 'Arpit Patidar',
  email: 'arpitpatidarappi01@gmail.com',
  currentTitle: 'Software Engineer – Full-Stack',
  yearsExperience: 2,

  // ─── Skills (used in Gemini analysis prompt) ────────────────────────────────
  skills: [
    'JavaScript', 'TypeScript', 'React.js', 'Next.js', 'Redux',
    'Context API', 'MUI', 'ShadCn', 'Node.js', 'Express.js',
    'REST', 'WebSocket', 'GraphQL', 'MVC', 'MongoDB', 'Supabase',
    'AWS EC2', 'S3', 'Nx Monorepo', 'Git', 'GitHub',
    'Stripe', 'RazorPay', 'NodeMailer', 'SendGrid',
    'npm', 'Yarn', 'pnpm', 'Postman', 'JWT', 'OAuth',
    'Session Auth', 'Web3', 'Wallet Integration', 'Bridge APIs',
    'DeFi', 'Smart Contract Interaction',
  ],

  // ─── Summary (used in email generation) ─────────────────────────────────────
  summary:
    'Full-Stack Software Engineer with 2+ years of experience building and shipping production-grade Web2 and Web3 systems. Specialised in scalable backend architecture, cross-chain payment infrastructure, and real-time event-driven applications using Node.js, Next.js, and TypeScript. Proven track record of independently owning projects end-to-end — from system design through deployment — in fast-paced startup environments.',

  // ─── Recent Work (fed into Gemini prompts) ──────────────────────────────────
  recentWork: [
    {
      company: 'Metaverse Ventures Pvt. Ltd.',
      title: 'Software Engineer – Full-Stack',
      bullets: [
        'Owned end-to-end delivery of 10+ production-grade products, independently leading 4+ projects from product research to deployment',
        'Built and scaled a cross-chain payments & treasury platform handling multi-chain transactions and fund flows',
        'Reduced system latency by 40–50% through optimized routing, caching strategies, and targeted infrastructure decisions',
        'Designed real-time, event-driven systems with secure wallet/auth flows and automated transaction lifecycle management',
      ],
    },
    {
      company: 'Amenses Innovation Pvt Ltd',
      title: 'Associate Software Developer',
      bullets: [
        'Delivered 5+ client projects across international and domestic clients, handling end-to-end development',
        'Led development of 2 projects as Lead Developer, driving architecture, task distribution, and delivery',
        'Built reusable component libraries and internal tooling, reducing cross-project setup time by ~30%',
      ],
    },
  ],

  // ─── Best Metric (cited in outreach emails) ────────────────────────────────
  bestMetric:
    'Built and scaled a cross-chain payments platform handling multi-chain transactions, reducing system latency by 40-50% through optimized routing and caching',

  // ─── Preferences ────────────────────────────────────────────────────────────
  outreachThreshold: 70,   // Minimum matchScore to trigger outreach
  dailyEmailLimit: 20,     // Soft limit
  companyEmailLimit: 3,    // Hard limit per company
  cooldownDays: 30,        // Cooldown between emails to same company

  // ─── Targeting ──────────────────────────────────────────────────────────────
  targetRoles: [
    'Software Engineer',
    'Full-Stack Engineer',
    'Full Stack Developer',
    'Backend Engineer',
    'Node.js Developer',
    'TypeScript Engineer',
    'Web3 Developer',
    'MERN Stack Developer',
    'React Developer',
    'Frontend Engineer',
  ],
  excludeCompanies: [],    // Companies to never contact
  remoteOnly: false,
};
