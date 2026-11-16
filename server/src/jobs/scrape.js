import { Profile } from '../models/Profile.js';
import { Job } from '../models/Job.js';
import { JobMatch } from '../models/JobMatch.js';
import { ScrapeRun } from '../models/ScrapeRun.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { matchesPreferences } from './match.js';
import { checkMany } from './liveness.js';
import { rescoreUser } from './score.js';
import { reviewTopJobs } from './review.js';
import { refreshContacts } from './contactBook.js';
import { httpError } from '../utils/httpError.js';
import * as greenhouse from '../sources/greenhouse.js';
import * as lever from '../sources/lever.js';
import * as ashby from '../sources/ashby.js';
import * as freehire from '../sources/freehire.js';
import * as jsearch from '../sources/jsearch.js';
import { remotive, remoteok, himalayas, weworkremotely } from '../sources/remoteFeeds.js';

// Two kinds of source:
//   boards: one company's job board (you list the board names)
//   search: a job site searched with your role words and places
const BOARDS = { greenhouse, lever, ashby };
const SEARCH = { freehire, remotive, remoteok, himalayas, weworkremotely, jsearch };
const JSEARCH_MONTHLY_LIMIT = Number(process.env.JSEARCH_MONTHLY_LIMIT) || 150; // free tier is about 200
const LIVENESS_PER_RUN = 40;
const MANUAL_COOLDOWN = 60_000; // be polite to free APIs: at most one manual search per minute
const running = new Set(); // userIds with a run in progress (one server process, so memory is enough)


// Every API call this run will make, as { source, label, run }.
async function planTasks(userId, prefs, terms) {
  const tasks = Object.entries(prefs.companies).flatMap(([source, boards]) =>
    boards.map((board) => ({ source, label: board, run: () => BOARDS[source].fetchBoard(board) })),
  );
  if (!terms.length) return tasks;
  // JSearch's free quota is monthly: count its calls in the last 30 days (runs are kept for 30 days).
  const [used] = await ScrapeRun.aggregate([
    { $match: { userId } },
    { $unwind: '$boards' },
    { $match: { 'boards.source': 'jsearch' } },
    { $count: 'n' },
  ]);
  const ctx = { callsLeft: JSEARCH_MONTHLY_LIMIT - (used?.n ?? 0) };
  for (const [source, mod] of Object.entries(SEARCH)) {
    if (!prefs.sources[source]) continue;
    // Some sources ask for few calls (Remotive: a few a day), so they keep their own minimum gap between calls.
    if (mod.minGapMs && (await ScrapeRun.exists({ userId, 'boards.source': source, createdAt: { $gt: Date.now() - mod.minGapMs } }))) continue;
    tasks.push(...mod.plan(prefs, terms, ctx).map((t) => ({ source, ...t })));
  }
  return tasks;
}

// Role words from your resume, for when Preferences has none: your latest job title, your headline's first part
// ("MERN Stack Developer | React" -> "MERN Stack Developer") and up to two main tech skills ("React" matches "React Developer").
const ROLE_SKILL = /^(react(\.?js)?|node(\.?js)?|mern|mean|angular|vue(\.?js)?|next\.?js|python|django|java|spring|javascript|typescript|full ?stack|front ?end|back ?end|devops|android|ios|flutter|react native|\.net|php|laravel|golang|go|ruby|rails|data engineer|data scientist|qa)$/i;
export function termsFromProfile(data) {
  const terms = [
    data?.experience?.[0]?.title,
    data?.headline?.split(/[|,•·/]/)[0],
    ...(data?.skills ?? []).filter((s) => ROLE_SKILL.test(s.trim())).slice(0, 2),
  ]
    .map((t) => t?.trim())
    .filter((t) => t && t.split(/\s+/).length <= 4);
  return [...new Map(terms.map((t) => [t.toLowerCase(), t])).values()].slice(0, 4);
}

export const isSearching = (userId) => running.has(userId);

// Opening the Jobs tab: search in the background if the last search is over an hour old (never two at once).
const STALE_MS = 3600_000;
const lastError = new Map(); // userId -> why the last background search failed
export async function refreshIfStale(userId) {
  if (running.has(userId)) return { started: false, running: true };
  const last = await ScrapeRun.findOne({ userId }, 'createdAt').sort({ createdAt: -1 });
  if (last && Date.now() - last.createdAt < STALE_MS) return { started: false, running: false };
  lastError.delete(userId);
  runScrape(userId, 'auto').catch((err) => lastError.set(userId, err.message));
  return { started: true, running: true };
}
export const searchError = (userId) => lastError.get(userId) ?? null;

// One search run for one user: call every source -> keep matching jobs -> save jobs once -> add them to the feed.
export async function runScrape(userId, trigger) {
  if (running.has(userId)) throw httpError(409, 'A search is already running');
  running.add(userId);
  try {
    const profile = await Profile.findOne({ userId });
    if (!profile?.preferences && !profile?.data) throw httpError(400, 'Upload your resume on the Profile page, or save your preferences');
    const prefs = PreferencesSchema.parse(profile.preferences ?? {}); // fills defaults for newer fields
    if (trigger === 'manual') {
      const last = await ScrapeRun.findOne({ userId }).sort({ createdAt: -1 });
      if (last && Date.now() - last.createdAt < MANUAL_COOLDOWN) throw httpError(429, 'Searched less than a minute ago; try again shortly');
    }

    // Search words, like the reference repo's search-queries.md. Required for job sites: the remote feeds return
    // every job they have, and the role words are what filter out non-tech titles. None set: taken from your resume.
    const termsFrom = prefs.roles.length ? 'preferences' : 'profile';
    const terms = termsFrom === 'preferences' ? prefs.roles : termsFromProfile(profile.data);
    prefs.roles = terms; // the title filter uses the same words
    const run = new ScrapeRun({ userId, trigger, terms, termsFrom });
    if (!terms.length && !Object.values(prefs.companies).flat().length) {
      throw httpError(400, 'Add role keywords in Preferences (e.g. mern, full stack, node, react) to search job sites');
    }
    const tasks = await planTasks(userId, prefs, terms);
    if (!terms.length) run.boards.push({ source: 'job sites', board: 'skipped', fetched: 0, kept: 0, error: 'Add role keywords in Preferences to search job sites' });

    // All sources at once; one failing source must not stop the others, so each result is settled separately.
    const results = await Promise.allSettled(tasks.map((t) => t.run()));
    const kept = new Map(); // dedupeKey -> job, so a job found on two sites is only written once
    results.forEach((result, i) => {
      const { source, label } = tasks[i];
      if (result.status === 'rejected') {
        const err = result.reason;
        if (!err.status) console.error(`${source}/${label}:`, err);
        run.boards.push({ source, board: label, fetched: 0, kept: 0, error: err.status ? err.message : 'Could not reach this source' });
        return;
      }
      const mine = result.value.filter((job) => matchesPreferences(job, prefs));
      mine.forEach((job) => kept.has(job.dedupeKey) || kept.set(job.dedupeKey, job));
      run.boards.push({ source, board: label, fetched: result.value.length, kept: mine.length });
    });

    if (kept.size) {
      const jobs = [...kept.values()];
      // Upsert by dedupeKey: a new job is inserted; for a known one only the extracted fields are refreshed
      // (pay, years, repost flag), so the first source's text and the contacts you looked up stay as they are.
      const saved = await Job.bulkWrite(
        jobs.map(({ salary, experienceMin, reposted, platform, junk, ...rest }) => ({
          updateOne: {
            filter: { dedupeKey: rest.dedupeKey },
            update: { $setOnInsert: rest, $set: { salary, experienceMin, reposted, platform, junk } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      run.newJobs = saved.upsertedCount;

      const ids = await Job.find({ dedupeKey: { $in: [...kept.keys()] } }, '_id');
      const matched = await JobMatch.bulkWrite(
        ids.map(({ _id }) => ({
          updateOne: { filter: { userId, jobId: _id }, update: { $setOnInsert: { userId, jobId: _id } }, upsert: true },
        })),
        { ordered: false },
      );
      run.newMatches = matched.upsertedCount; // jobs you already saved or hid keep their status

      // Still open? Check jobs not checked yet or not in the last 3 days, skipping junk, at most 40 per search
      // so a search stays quick; the rest are checked on the next runs.
      const due = await Job.find(
        {
          dedupeKey: { $in: [...kept.keys()] },
          'junk.0': { $exists: false },
          $or: [{ 'liveness.checkedAt': null }, { 'liveness.checkedAt': { $lt: new Date(Date.now() - 3 * 86_400_000) } }],
        },
        'source url',
      ).limit(LIVENESS_PER_RUN);
      const checks = await checkMany(due);
      if (checks.length) await Job.bulkWrite(checks.map(({ _id, liveness }) => ({ updateOne: { filter: { _id }, update: { $set: { liveness } } } })));
      run.liveness = { checked: checks.length, closed: checks.filter((c) => c.liveness.status === 'closed').length };
    }

    await rescoreUser(userId); // new jobs and fresher dates change the order
    run.finishedAt = new Date();
    const saved = await run.save();
    // Gemini reviews take minutes on the free tier, so they run after the search answers, not during it.
    reviewTopJobs(userId).catch((err) => console.error('Background reviews failed:', err.message));
    refreshContacts(userId, { force: true }); // new jobs: look for their HR contacts too
    return saved;
  } finally {
    running.delete(userId);
  }
}

// Every 30 minutes: run a search for each user whose last run is more than 6 hours old.
// Checking "last run" instead of a plain 6-hour timer means restarts and a sleeping laptop don't skip searches.
// shortcut: in-process timer, fine for one server; move to Agenda/BullMQ when there are several servers or many users.
const SIX_HOURS = 6 * 3600 * 1000;
export function startSchedule() {
  const tick = async () => {
    const profiles = await Profile.find({ $or: [{ preferences: { $exists: true } }, { data: { $exists: true } }] }, 'userId');
    for (const { userId } of profiles) {
      const last = await ScrapeRun.findOne({ userId }).sort({ createdAt: -1 });
      if (last && Date.now() - last.createdAt < SIX_HOURS) continue;
      // 400 = setup missing (no keywords yet): nothing to search, so stay quiet instead of logging every 30 minutes.
      await runScrape(userId, 'schedule').catch((err) => err.status === 400 || console.error(`Scheduled search for ${userId} failed:`, err.message));
    }
  };
  setTimeout(() => tick().catch(console.error), 60_000); // first check a minute after start
  setInterval(() => tick().catch(console.error), 30 * 60_000);
}
