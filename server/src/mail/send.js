import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { Profile } from '../models/Profile.js';
import { PROVIDERS } from './providers.js';
import { httpError } from '../utils/httpError.js';

// Each user sends from their own Gmail or Yahoo Mail (their "apply email", Settings > Sending email): replies land in their inbox
// and recipients see their real address. Login is a Gmail "app password" (Google Account > Security >
// 2-Step Verification > App passwords), stored encrypted with MAIL_SECRET_KEY and never sent back to the browser.
// shortcut: app passwords are the simple route; Google sign-in (OAuth) needs Google's review for gmail.send.

// MAIL_DRY_RUN=1 builds every email (with its attachment) but sends nothing: for tests and for rehearsing the flow.
const dryRun = () => process.env.MAIL_DRY_RUN === '1';

function key() {
  const secret = process.env.MAIL_SECRET_KEY;
  if (!secret || secret.length < 32) throw httpError(500, 'The server needs MAIL_SECRET_KEY (32+ random characters) in server/.env to store email passwords');
  return crypto.createHash('sha256').update(secret).digest();
}
// AES-256-GCM: "iv.tag.data", all base64. GCM also detects a tampered or wrong-key value.
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function decrypt(value) {
  const [iv, tag, data] = value.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const smtp = ({ provider = 'gmail', user, pass }) => nodemailer.createTransport({ host: PROVIDERS[provider].smtp, port: 465, secure: true, auth: { user, pass } });
export const cleanPassword = (pass) => String(pass ?? '').replace(/\s/g, ''); // shown as "abcd efgh ijkl mnop"

// Logs in to the provider without sending anything: a wrong address or password is caught before it's saved.
export async function verifyMail(account) {
  if (dryRun()) return;
  const { name } = PROVIDERS[account.provider];
  await smtp(account)
    .verify()
    .catch((err) => {
      throw httpError(
        400,
        /auth|credentials|username|password|535|534/i.test(err.message)
          ? `${name} refused this address and app password. Check the address, and copy all 16 letters of a new app password (your normal password won't work).`
          : `Couldn't reach ${name}: ${err.message}`,
      );
    });
}

// { provider, user, pass, verifiedAt } of this user's apply email, or null when not connected.
// Accounts saved before providers existed are Gmail.
export async function mailAccountOf(userId) {
  // not 'mailAccount' itself: that path collides with its own secret
  const p = await Profile.findOne({ userId }, '+mailAccount.secret mailAccount.user mailAccount.provider mailAccount.verifiedAt');
  const m = p?.mailAccount;
  if (!m?.user || !m.secret) return null;
  try {
    return { provider: m.provider ?? 'gmail', user: m.user, pass: decrypt(m.secret), verifiedAt: m.verifiedAt };
  } catch {
    return null; // MAIL_SECRET_KEY changed: the user connects again
  }
}

export const gmailReady = async (userId) => dryRun() || Boolean(await mailAccountOf(userId));
export const NOT_CONNECTED = 'Connect your apply email first: Settings > Sending email';

export async function sendEmail({ userId, fromName, to, subject, text, html, attachments }) {
  const account = dryRun() ? { user: 'dry-run@localhost' } : await mailAccountOf(userId);
  if (!account) throw httpError(400, NOT_CONNECTED);
  const transport = dryRun() ? nodemailer.createTransport({ jsonTransport: true }) : smtp(account);
  const from = fromName ? `"${fromName.replace(/["\\\r\n]/g, '')}" <${account.user}>` : account.user;
  const info = await transport.sendMail({ from, to, subject, text, html, attachments });
  return info.messageId;
}
