// Sends email through SMTP when it is configured in .env.
// Without SMTP settings (local development) the message is printed in the console instead.
const nodemailer = require('nodemailer');
const { config } = require('../config');

// Filled only while running tests, so tests can read the reset link.
const testOutbox = [];

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function sendMail({ to, subject, text }) {
  if (config.isTest) {
    testOutbox.push({ to, subject, text });
    return;
  }

  if (!config.smtp.host) {
    console.log('\n----- Email not sent (SMTP is not set up). Message below -----');
    console.log(`To: ${to}\nSubject: ${subject}\n\n${text}`);
    console.log('---------------------------------------------------------------\n');
    return;
  }

  await getTransporter().sendMail({ from: config.smtp.from, to, subject, text });
}

function sendPasswordResetEmail(admin, resetLink) {
  return sendMail({
    to: admin.email,
    subject: 'Reset your AcadSync password',
    text: [
      `Hello ${admin.full_name},`,
      '',
      'Open this link to choose a new password for your AcadSync account:',
      resetLink,
      '',
      `The link works once and expires in ${config.resetTokenMinutes} minutes.`,
      'If you did not ask for this, you can ignore this email.',
    ].join('\n'),
  });
}

module.exports = { sendPasswordResetEmail, testOutbox };
