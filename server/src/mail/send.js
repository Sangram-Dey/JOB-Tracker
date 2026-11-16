import nodemailer from 'nodemailer';
import { httpError } from '../utils/httpError.js';

// Sends from your own Gmail, so replies land in your inbox and recipients see your real address.
// Uses a Gmail "app password" (Google Account > Security > 2-Step Verification > App passwords), kept in server/.env.
// shortcut: SMTP with an app password is the simple single-user setup; switch to Google sign-in (OAuth) for many users.
let transport;

// MAIL_DRY_RUN=1 builds every email (with its attachment) but sends nothing: for tests and for rehearsing the flow.
const dryRun = () => process.env.MAIL_DRY_RUN === '1';
export const gmailReady = () => dryRun() || Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

export async function sendEmail({ fromName, to, subject, text, html, attachments }) {
  if (!gmailReady()) throw httpError(400, 'Add GMAIL_USER and GMAIL_APP_PASSWORD to server/.env to send emails');
  transport ??= dryRun()
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
      });
  const address = process.env.GMAIL_USER || 'dry-run@localhost';
  const from = fromName ? `"${fromName.replace(/["\\\r\n]/g, '')}" <${address}>` : address;
  const info = await transport.sendMail({ from, to, subject, text, html, attachments });
  return info.messageId;
}
