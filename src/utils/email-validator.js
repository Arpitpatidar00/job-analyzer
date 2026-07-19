'use strict';

const dns = require('dns').promises;

// RFC-5321 compliant regex (covers 99.9% of real addresses)
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// Known throwaway/burner email providers — block these silently
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'throwaway.email',
  'tempmail.com',
  'yopmail.com',
  'sharklasers.com',
  'trashmail.com',
  'getairmail.com',
]);

/**
 * Full pre-send validation gate.
 *
 * Steps:
 *   1. Input type check
 *   2. RFC-5321 syntax check
 *   3. Disposable domain block
 *   4. DNS MX record lookup (confirms the domain accepts mail)
 *
 * Returns { valid: true, normalized } on pass
 * Returns { valid: false, reason: string } on fail
 *
 * reason values:
 *   missing_email | invalid_syntax | disposable_domain |
 *   no_mx_record  | domain_not_resolvable
 */
async function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'missing_email' };
  }

  const normalized = email.trim().toLowerCase();

  // 1 — Syntax
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, reason: 'invalid_syntax' };
  }

  const domain = normalized.split('@')[1];

  // 2 — Disposable
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: 'disposable_domain' };
  }

  // 3 — MX record (proves the domain can receive mail)
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return { valid: false, reason: 'no_mx_record' };
    }
  } catch {
    return { valid: false, reason: 'domain_not_resolvable' };
  }

  return { valid: true, normalized };
}

/**
 * Synchronous syntax-only check.
 * Use when you need a fast check without async (e.g. input validation in routes).
 */
function validateEmailSyntax(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

module.exports = { validateEmail, validateEmailSyntax };
