import { Contact } from '../models/Contact.js';
import { Job } from '../models/Job.js';
import { JobMatch } from '../models/JobMatch.js';
import { Application } from '../models/Application.js';
import { Profile } from '../models/Profile.js';
import { companyKey } from '../jobs/normalize.js';
import { draftEmail } from '../ai/draftEmail.js';
import { factIssues } from '../resume/factCheck.js';
import { httpError } from '../utils/httpError.js';
import { REPEAT_DAYS } from './queue.js';
import { startTailoring, tailoringOn } from '../resume/tailorJob.js';

// The HR table (your contacts with their companies' active jobs) and the emails prepared from it.
// Emails are written in the background (Gemini takes a few seconds each) and land in "Ready to send".

export const DAILY_PREPARE = Number(process.env.DAILY_PREPARE) || 10; // emails made ready each morning
const ACTIVE_DAYS = 30;
const MIN_FIT = 50;
const PAUSE_MS = 4_000; // Gemini free tier: a few requests a minute
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const localDay = (d = new Date()) => d.toLocaleDateString('en-CA'); // "2026-11-13" in the server's time zone

// Open, not junk, posted in the last 30 days. Jobs without a date count as fresh (most sources give one).
export function isActive(job, now = Date.now()) {
  if (!job || job.junk?.length || job.liveness?.status === 'closed') return false;
  const posted = job.postedAt ?? job.createdAt;
  return !posted || now - new Date(posted) < ACTIVE_DAYS * DAY;
}

// Your active, reasonably matched jobs, grouped by company.
async function activeJobs(userId) {
  const matches = await JobMatch.find({ userId, status: { $ne: 'hidden' }, 'fit.score': { $gte: MIN_FIT } }, 'jobId fit.score')
    .sort({ 'fit.rank': -1 })
    .limit(500)
    .populate('jobId', 'title company url postedAt createdAt junk liveness');
  const byCompany = new Map();
  const byId = new Map();
  for (const m of matches) {
    if (!isActive(m.jobId)) continue;
    const j = { matchId: m._id, jobId: m.jobId._id, title: m.jobId.title, company: m.jobId.company, url: m.jobId.url, postedAt: m.jobId.postedAt ?? m.jobId.createdAt, fit: m.fit.score };
    byId.set(String(j.jobId), j);
    const key = companyKey(j.company);
    byCompany.set(key, [...(byCompany.get(key) ?? []), j]);
  }
  return { byCompany, byId };
}

// Every contact with its company's active jobs (best fit first), whether an email to it is already waiting,
// and whether it was emailed recently. Plus companies with active jobs that have no contact yet.
export async function hrTable(userId) {
  const [{ byCompany, byId }, contacts, apps] = await Promise.all([
    activeJobs(userId),
    Contact.find({ userId }).sort({ updatedAt: -1 }),
    Application.find({ userId }, 'to status subject body warnings jobTitle sentAt error updatedAt createdAt').sort({ updatedAt: -1 }),
  ]);
  const latest = new Map(); // email -> its newest email (draft, approved, sending, sent or failed)
  for (const a of apps) if (!latest.has(a.to)) latest.set(a.to, a);
  const inProgress = writing.get(userId) ?? new Set();
  const rows = contacts
    .map((c) => {
      const jobs = new Map();
      for (const j of [...(byCompany.get(companyKey(c.company)) ?? []), ...c.jobIds.map((id) => byId.get(String(id))).filter(Boolean)]) jobs.set(String(j.jobId), j);
      const sorted = [...jobs.values()].sort((a, b) => b.fit - a.fit);
      return {
        ...c.toJSON(),
        jobs: sorted,
        bestFit: sorted[0]?.fit ?? null,
        mail: (c.email && latest.get(c.email)) || null, // shown and edited in the same row
        outbox: (c.email && ['draft', 'approved', 'queued'].includes(latest.get(c.email)?.status) && latest.get(c.email).status) || null,
        writing: inProgress.has(String(c._id)),
        recent: Boolean(c.lastContactedAt && Date.now() - c.lastContactedAt < REPEAT_DAYS * DAY),
      };
    })
    // best fit first; within a company, a named person (e.g. an HR manager) before a role address like hr@
    .sort((a, b) => (b.bestFit ?? -1) - (a.bestFit ?? -1) || (a.kind === 'person' ? 0 : 1) - (b.kind === 'person' ? 0 : 1));
  const covered = new Set(contacts.map((c) => companyKey(c.company)));
  const uncovered = [...byCompany.entries()]
    .filter(([key]) => !covered.has(key))
    .map(([, jobs]) => ({ company: jobs[0].company, jobs }))
    .sort((a, b) => b.jobs[0].fit - a.jobs[0].fit)
    .slice(0, 20);
  return { rows, uncovered };
}

// Numbers or [placeholders] in an email that aren't in your history: shown so you check them before approving.
export const warningsFor = (subject, body, history) =>
  factIssues({ summary: `${subject}\n${body}` }, history).map((i) => (i.reason.startsWith('Placeholder') ? `Fill in ${i.text}` : `Check "${i.text}": not in your profile`));

const why = (row) =>
  !row.sendable ? (row.email ? 'Hunter is not sure this address works' : 'No email address')
  : row.outbox ? 'Already in Ready to send'
  : row.recent ? `Emailed in the last ${REPEAT_DAYS} days`
  : null;

async function assertCanWrite(userId) {
  const profile = await Profile.findOne({ userId }, 'data resumePdf');
  if (!profile?.data) throw httpError(400, 'Upload your resume in Settings first');
  if (!profile.resumePdf?.id) throw httpError(400, 'Upload the resume PDF to attach in Settings first');
}

// One writer per user; the last result is kept so the page can say what was skipped.
const running = new Set();
const lastRun = new Map();
const writing = new Map(); // userId -> contact ids whose email is being written now
export const preparing = (userId) => running.has(userId);
export const lastPrepared = (userId) => lastRun.get(userId) ?? null;

function startWriting(userId, rows) {
  if (running.has(userId)) throw httpError(409, 'Already writing emails; they appear in Ready to send one by one');
  running.add(userId);
  const ids = new Set(rows.map((r) => String(r._id)));
  writing.set(userId, ids);
  writeEmails(userId, rows, ids)
    .then((result) => lastRun.set(userId, { ...result, at: new Date() }))
    .catch((err) => lastRun.set(userId, { created: 0, skipped: [{ contact: 'all', reason: err.message }], at: new Date() }))
    .finally(() => (running.delete(userId), writing.delete(userId)));
}

async function writeEmails(userId, rows, ids) {
  const profile = await Profile.findOne({ userId }, 'data preferences');
  let created = 0;
  const skipped = [];
  for (const row of rows) {
    const best = row.jobs[0];
    const job = best && (await Job.findById(best.jobId, 'title company description'));
    try {
      const { subject, body } = await draftEmail({ profile: profile.data, contact: row, job, jobTitle: row.jobTitle });
      await Application.create({
        userId,
        contactId: row._id,
        jobId: job?._id,
        company: row.company,
        jobTitle: job?.title || row.jobTitle,
        to: row.email,
        toName: row.name,
        subject,
        body,
        warnings: warningsFor(subject, body, [profile.data]),
      });
      created++;
      // the resume for this job, tailored in the background while you read the email
      if (job && tailoringOn(profile)) startTailoring(userId, job._id).catch((err) => console.error('Tailoring:', err.message));
    } catch (err) {
      skipped.push({ contact: row.email, reason: err.message });
      if (err.status === 429) break; // free-tier limit: the rest would fail too
    }
    ids.delete(String(row._id)); // this row shows its email (or no longer "writing")
    await sleep(PAUSE_MS);
  }
  return { created, skipped };
}

// "Move to Ready": the contacts you ticked in the HR table.
// confirmRepeat: you confirmed writing again to people you emailed before; without it they're skipped.
export async function prepareSelected(userId, contactIds, { confirmRepeat = false } = {}) {
  await assertCanWrite(userId);
  const { rows } = await hrTable(userId);
  const ids = new Set(contactIds.map(String));
  const chosen = rows.filter((r) => ids.has(String(r._id)));
  const reason = (r) => why(r) ?? (r.lastContactedAt && !confirmRepeat ? 'Emailed before: confirm to email again' : null);
  const skipped = chosen.filter(reason).map((r) => ({ contact: r.email || r.phone, reason: reason(r) }));
  const ok = chosen.filter((r) => !reason(r));
  if (ok.length) startWriting(userId, ok);
  return { writing: ok.length, skipped };
}

// Automatic pick: best-fit companies with active jobs first, one contact per company, skipping companies
// that already have an email waiting or were emailed in the last REPEAT_DAYS days.
export function pickDaily(rows, count) {
  const busy = new Set(rows.filter((r) => r.outbox || r.recent).map((r) => companyKey(r.company)));
  const picked = [];
  for (const r of rows) {
    if (picked.length >= count) break;
    const key = companyKey(r.company);
    // never someone emailed before: a second email only goes out when you choose it and confirm
    if (why(r) || r.lastContactedAt || !r.jobs.length || busy.has(key)) continue;
    busy.add(key);
    picked.push(r);
  }
  return picked;
}

export async function prepareDaily(userId, count = DAILY_PREPARE) {
  await assertCanWrite(userId);
  const picked = pickDaily((await hrTable(userId)).rows, count);
  if (picked.length) startWriting(userId, picked);
  return { writing: picked.length };
}

// Each morning (first check after 7:00): top up Ready to send to DAILY_PREPARE emails for everyone set up to send.
export async function prepareMornings() {
  if (new Date().getHours() < 7) return;
  const today = localDay();
  const due = await Profile.find({ data: { $exists: true }, 'resumePdf.id': { $exists: true }, emailsPreparedOn: { $ne: today } }, 'userId');
  for (const { userId } of due) {
    await Profile.updateOne({ userId }, { emailsPreparedOn: today }, { timestamps: false });
    const ready = await Application.countDocuments({ userId, status: { $in: ['draft', 'approved'] } });
    if (ready < DAILY_PREPARE && !preparing(userId)) await prepareDaily(userId, DAILY_PREPARE - ready).catch((err) => console.error('Morning emails failed:', err.message));
  }
}

// Days in a row with at least one email sent (today counts once you send one).
export async function streak(userId) {
  const sent = await Application.find({ userId, status: 'sent', sentAt: { $gt: new Date(Date.now() - 90 * DAY) } }, 'sentAt');
  const days = new Set(sent.map((a) => localDay(a.sentAt)));
  const d = new Date();
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return { streak: n, sentToday: sent.filter((a) => localDay(a.sentAt) === localDay()).length };
}
