import { Application } from '../models/Application.js';
import { AutoApply } from '../models/AutoApply.js';
import { JobMatch } from '../models/JobMatch.js';
import { Profile } from '../models/Profile.js';
import { Tracked } from '../models/Tracked.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { localDay } from '../mail/prepare.js';
import { sendEmail, mailAccountOf } from '../mail/send.js';

// What's waiting for you today: shown on the Jobs page and emailed to you each morning.
export async function todaySummary(userId) {
  const day = new Date(Date.now() - 86_400_000);
  const [newJobs, emailsReady, appsReady, newReplies, interviews, appliedThisWeek] = await Promise.all([
    JobMatch.countDocuments({ userId, status: 'new', createdAt: { $gt: day } }),
    Application.countDocuments({ userId, status: { $in: ['draft', 'approved'] } }),
    AutoApply.countDocuments({ userId, status: 'prepared' }),
    Tracked.countDocuments({ userId, unread: true }),
    Tracked.countDocuments({ userId, stage: 'interview' }),
    Tracked.countDocuments({ userId, appliedAt: { $gt: new Date(Date.now() - 7 * 86_400_000) } }),
  ]);
  return { newJobs, emailsReady, appsReady, newReplies, interviews, appliedThisWeek };
}

export function summaryEmail(s, appUrl) {
  const lines = [
    s.newReplies && `💬 ${s.newReplies} new ${s.newReplies === 1 ? 'reply' : 'replies'} from companies`,
    s.interviews && `📅 ${s.interviews} at interview stage`,
    s.emailsReady && `✉️ ${s.emailsReady} HR emails ready to review and send`,
    s.appsReady && `📝 ${s.appsReady} applications filled and waiting for your review`,
    s.newJobs && `🔎 ${s.newJobs} new jobs found in the last day`,
    `✅ ${s.appliedThisWeek} applied in the last 7 days`,
  ].filter(Boolean);
  const text = `Your job search today\n\n${lines.join('\n')}\n\nOpen Job Tracker: ${appUrl}`;
  const html = `<p><b>Your job search today</b></p><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul><p><a href="${appUrl}">Open Job Tracker</a></p>`;
  return { text, html };
}

// Once a day after 8 am: a short email to yourself (your own Gmail), unless turned off in Preferences.
export async function sendDailySummaries() {
  if (process.env.MAIL_DRY_RUN === '1' || new Date().getHours() < 8) return;
  const today = localDay();
  for (const p of await Profile.find({ summarySentOn: { $ne: today } }, 'userId preferences')) {
    await Profile.updateOne({ userId: p.userId }, { summarySentOn: today }, { timestamps: false });
    if (!PreferencesSchema.parse(p.preferences ?? {}).dailySummaryEmail) continue;
    const account = await mailAccountOf(p.userId); // sent from and to the user's own Gmail
    if (!account) continue;
    const s = await todaySummary(p.userId);
    if (!s.newReplies && !s.emailsReady && !s.appsReady && !s.newJobs) continue; // nothing to do today: no email
    const { text, html } = summaryEmail(s, process.env.APP_URL || 'http://localhost:5173');
    await sendEmail({ userId: p.userId, fromName: 'Job Tracker', to: account.user, subject: `Today: ${s.emailsReady} emails, ${s.appsReady} applications, ${s.newReplies} replies`, text, html }).catch((err) =>
      console.error('Daily summary email failed:', err.message),
    );
  }
}
