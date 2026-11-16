import '../models/Job.js'; // registers the Job model that populate('jobId') loads
import { Contact } from '../models/Contact.js';
import { JobMatch } from '../models/JobMatch.js';
import { findContacts, fromDescription } from './contacts.js';

const domainOf = (website) => {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

// Adds what the finder found for one job to your contact list, linked to that job.
export async function saveFoundContacts(userId, job, found) {
  const domain = domainOf(found.website);
  const base = { company: job.company, ...(domain && { domain }) };
  const writes = [
    ...found.emails.map((e) => ({
      updateOne: {
        filter: { userId, email: e.email },
        update: {
          $setOnInsert: { userId, email: e.email, kind: e.kind === 'personal' ? 'person' : 'role', source: e.foundOn === 'job description' ? 'job post' : 'company site', foundOn: e.foundOn },
          $set: base,
          $addToSet: { jobIds: job._id },
        },
        upsert: true,
      },
    })),
    ...(found.phones ?? []).map((p) => ({
      updateOne: {
        filter: { userId, phone: p.phone, email: { $exists: false } },
        update: {
          $setOnInsert: { userId, phone: p.phone, kind: 'role', source: p.foundOn === 'job description' ? 'job post' : 'company site', foundOn: p.foundOn },
          $set: base,
          $addToSet: { jobIds: job._id },
        },
        upsert: true,
      },
    })),
  ];
  if (!writes.length) return 0;
  return (await Contact.bulkWrite(writes, { ordered: false })).upsertedCount; // new contacts only
}

// Opening the HR list (at most once an hour) or finishing a search (force): run the finder in the background.
// shortcut: in-memory, so a server restart allows one extra run; fine for one server.
const finding = new Map(); // userId -> { startedAt, running, result }
export const findingStatus = (userId) => finding.get(userId) ?? null;
export function refreshContacts(userId, { force = false } = {}) {
  const last = finding.get(userId);
  if (last && (last.running || (!force && Date.now() - last.startedAt < 3600_000))) return { started: false };
  const state = { startedAt: Date.now(), running: true, result: null };
  finding.set(userId, state);
  discoverForTopJobs(userId)
    .then((result) => (state.result = result))
    .catch((err) => console.error('Background contact search failed:', err.message))
    .finally(() => (state.running = false));
  return { started: true };
}

// Two passes: (1) emails and phones written in every job's description, free and instant;
// (2) the company websites of your best-fit jobs not checked yet, a few at a time (these take a few seconds each).
export async function discoverForTopJobs(userId, limit = 50) {
  const matches = await JobMatch.find({ userId, status: { $ne: 'hidden' } })
    .sort({ 'fit.rank': -1 })
    .populate('jobId');
  const open = matches.map((m) => m.jobId).filter((j) => j && !j.junk?.length && j.liveness?.status !== 'closed');
  let found = 0;
  for (const job of open) {
    const own = fromDescription(job);
    if (own.emails.length || own.phones.length) found += await saveFoundContacts(userId, job, own);
  }

  const due = open.filter((j) => !j.contacts?.checkedAt).slice(0, limit);
  for (let i = 0; i < due.length; i += 4) {
    await Promise.all(
      due.slice(i, i + 4).map(async (job) => {
        try {
          job.contacts = await findContacts(job);
          await job.save();
          found += await saveFoundContacts(userId, job, job.contacts);
        } catch (err) {
          console.error('Contact search failed for', job.company, err.message);
        }
      }),
    );
  }
  return { checked: due.length, found };
}
