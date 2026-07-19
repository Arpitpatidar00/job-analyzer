/**
 * JobFill Pro v2 — Email Sending Service
 * Nodemailer wrapper with Gmail OAuth2 transport.
 */

const nodemailer = require('nodemailer');
const { logger, ErrorCodes } = require('./logger');

let transporter;

/**
 * Initialize Nodemailer with Gmail OAuth2
 * @returns {boolean} true if initialized successfully
 */
function initMailer() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (
    !clientId || clientId === 'your_client_id_here' ||
    !clientSecret || clientSecret === 'your_client_secret_here' ||
    !refreshToken || refreshToken === 'your_refresh_token_here'
  ) {
    logger.warn('mailer', 'Gmail OAuth2 credentials not configured — email sending disabled');
    return false;
  }

  try {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.GMAIL_USER || require('../config/user-profile').email,
        clientId,
        clientSecret,
        refreshToken,
      },
    });

    logger.info('mailer', 'Nodemailer initialized with Gmail OAuth2');
    return true;
  } catch (err) {
    logger.error('mailer', 'Failed to initialize Nodemailer', {
      errorCode: ErrorCodes.SEND_FAILED,
      error: err,
    });
    return false;
  }
}

/**
 * Send an outreach email
 * @param {OutreachEmail} email - Generated email content
 * @param {RecruiterContact} contact - Recipient info
 * @param {object} job - Job data (for tracking headers)
 * @param {object} userProfile - Sender info
 * @returns {object} Nodemailer send result
 */
async function sendEmail(email, contact, job, userProfile = {}) {
  if (!transporter) {
    throw new Error('Mailer not initialized — check Gmail OAuth2 credentials');
  }

  // The safety redirect has been removed. Emails will now be sent directly to the recruiter.
  logger.info('mailer', `Sending live email to recruiter: ${contact.email}`);

  const attachments = [];
  if (userProfile.resumeBase64) {
    attachments.push({
      filename: userProfile.resumeFilename || 'resume.pdf',
      content: Buffer.from(userProfile.resumeBase64, 'base64'),
      contentType: 'application/pdf',
    });
  }

  const mailOptions = {
    from: `"${userProfile.name}" <${userProfile.email}>`,
    to: contact.email,
    subject: email.subject,
    text: email.bodyText,
    html: email.bodyHtml,
    headers: {
      'X-JobFill-Version': '2.0',
      'X-JobFill-JobUrl': job.jobUrl || job.job_url,
    },
    attachments,
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    logger.info('mailer', `Email successfully sent to ${contact.email}`, {
      messageId: result.messageId,
      subject: email.subject,
    });
    return result;
  } catch (err) {
    logger.error('mailer', `Failed to send email to ${contact.email}`, {
      errorCode: ErrorCodes.SEND_FAILED,
      error: err,
    });
    throw err;
  }
}

/**
 * Check if the mailer is ready
 */
function isMailerReady() {
  return !!transporter;
}

module.exports = {
  initMailer,
  sendEmail,
  isMailerReady,
};
