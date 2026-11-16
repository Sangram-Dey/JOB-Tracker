import { Application } from '../models/Application.js';
import { Contact } from '../models/Contact.js';
import { Profile } from '../models/Profile.js';
import { readPdf } from '../resume/storage.js';
import { sendEmail } from './send.js';
import { toHtml, toText } from './format.js';

// Approved emails you clicked Send on go out one at a time, spaced apart, at most DAILY_LIMIT in 24 hours.
// Spacing and a cap keep your Gmail from looking like a spammer, which protects your inbox and your replies.
export const DAILY_LIMIT = Number(process.env.DAILY_EMAIL_LIMIT) || 20;
export const REPEAT_DAYS = 14; // never email the same address again within this many days
const GAP_MS = Number(process.env.EMAIL_GAP_MS) || 45_000;
const running = new Set(); // userIds whose queue is being worked
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sentInLastDay = (userId) => Application.countDocuments({ userId, status: 'sent', sentAt: { $gt: new Date(Date.now() - 86_400_000) } });

async function sendOne(app, profile) {
  try {
    const pdfId = profile?.resumePdf?.id;
    if (!pdfId) throw new Error('Upload your resume PDF on the Profile page, then send again');
    const fromName = profile.data?.contact?.name;
    const filename = `${(fromName || 'Resume').replace(/[^\w .-]+/g, '')} - Resume.pdf`;
    app.messageId = await sendEmail({
      fromName,
      to: app.to,
      subject: app.subject,
      text: toText(app.body, profile.data),
      html: toHtml(app.body, profile.data),
      attachments: [{ filename, content: await readPdf(pdfId) }],
    });
    app.status = 'sent';
    app.sentAt = new Date();
    app.error = undefined;
    if (app.contactId) await Contact.updateOne({ _id: app.contactId }, { lastContactedAt: app.sentAt });
  } catch (err) {
    app.status = 'failed';
    app.error = err.message?.slice(0, 300) ?? 'Sending failed';
  }
  await app.save();
}

// Works through one user's queue in the background. Safe to call often: one worker per user.
export async function processQueue(userId) {
  if (running.has(userId)) return;
  running.add(userId);
  try {
    for (;;) {
      if ((await sentInLastDay(userId)) >= DAILY_LIMIT) break; // the rest stay queued and go out later
      const next = await Application.findOne({ userId, status: 'queued' }).sort({ updatedAt: 1 });
      if (!next) break;
      // read each time, so a PDF you replace mid-queue is the one that goes out
      await sendOne(next, await Profile.findOne({ userId }, 'data.contact resumePdf'));
      if (await Application.exists({ userId, status: 'queued' })) await sleep(GAP_MS);
    }
  } finally {
    running.delete(userId);
  }
}

// After a restart, or once the daily cap frees up: pick up anything still queued.
export async function resumeQueues() {
  for (const userId of await Application.distinct('userId', { status: 'queued' })) processQueue(userId).catch(console.error);
}
