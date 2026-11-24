import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { JobMatch } from '../models/JobMatch.js';
import { ScrapeRun } from '../models/ScrapeRun.js';
import { Profile } from '../models/Profile.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { runScrape, refreshIfStale, isSearching, searchError, nextScheduled } from '../jobs/scrape.js';
import { findContacts } from '../jobs/contacts.js';
import { saveFoundContacts } from '../jobs/contactBook.js';
import { reviewMatch, reviewContext } from '../jobs/review.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';
import { AutoApply } from '../models/AutoApply.js';
import { formFor } from '../apply/form.js';

async function withApplyStatus(userId, items) {
  const apps = await AutoApply.find({ userId, jobId: { $in: items.map((i) => i.job._id) } }, 'jobId status');
  const byJob = new Map(apps.map((a) => [String(a.jobId), { _id: a._id, status: a.status }]));
  return items.map((i) => ({ ...i, ats: formFor(i.job)?.ats ?? null, application: byJob.get(String(i.job._id)) ?? null }));
}

const router = Router();
router.use(requireAuth);

const PAGE_SIZE = 20;
const AUTO_APPLY_URL = /^https:\/\/([^/?#]*\.)?(greenhouse\.io|lever\.co|ashbyhq\.com)([/?#:]|$)/i;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Missing values count as a match: a job that doesn't state its pay, years or date is shown, not hidden.
const orUnknown = (field, condition) => ({ $or: [{ [field]: condition }, { [field]: null }] });

// Your preferences turned into a filter on the joined job.
export function preferenceFilter(prefs, now = Date.now()) {
  const and = [
    orUnknown('job.postedAt', { $gte: new Date(now - prefs.maxAgeDays * 86_400_000) }),
    // quality checks, not settings: closed postings and junk never reach the feed
    { 'job.liveness.status': { $ne: 'closed' } },
    { 'job.junk.0': { $exists: false } },
  ];
  if (prefs.minSalaryLpa != null) and.push(orUnknown('job.salary.lpa', { $gte: prefs.minSalaryLpa }));
  if (prefs.yearsExperience != null) and.push(orUnknown('job.experienceMin', { $lte: prefs.yearsExperience + 1 }));
  if (prefs.platforms.length) and.push({ 'job.platform': { $in: prefs.platforms } });
  return { $and: and };
}

// Best fit, newest posted, best paid (jobs without pay last: null sorts lowest), or most recently found.
const SORTS = {
  fit: { 'fit.rank': -1, 'job.postedAt': -1, _id: -1 },
  posted: { 'job.postedAt': -1, _id: -1 },
  pay: { 'job.salary.lpa': -1, 'job.postedAt': -1, _id: -1 },
  found: { createdAt: -1, _id: -1 },
};

// Your feed: your matches joined with the shared job details.
// GET /api/jobs?status=new|saved|hidden&q=react&workMode=remote&sort=fit|posted|pay|found&page=1
router.get('/', async (req, res) => {
  const { status = 'new', q, workMode, sort = 'fit', all, autoApply, found } = req.query;
  if (!['new', 'saved', 'hidden'].includes(status)) throw httpError(400, 'Unknown status');
  if (!SORTS[sort]) throw httpError(400, 'Unknown sort');
  const page = Math.max(1, Number.parseInt(req.query.page) || 1);
  // limit: rows per page; "Load more" asks for a bigger page instead of the next one
  const size = Math.min(500, Math.max(1, Number.parseInt(req.query.limit) || PAGE_SIZE)); // Load more grows it
  const skip = Math.max(0, Number.parseInt(req.query.skip) || (page - 1) * size);

  const jobFilter = {};
  if (workMode) jobFilter['job.workMode'] = workMode;
  // autoApply=1: only jobs whose form auto-apply can fill (same hosts as formFor)
  if (autoApply === '1') jobFilter.$and = [{ $or: ['job.applyUrl', 'job.url'].map((f) => ({ [f]: AUTO_APPLY_URL })) }];
  if (q) {
    const re = new RegExp(escape(String(q).slice(0, 100)), 'i'); // escaped: your search text is matched literally
    jobFilter.$or = [{ 'job.title': re }, { 'job.company': re }, { 'job.locations': re }];
  }
  const prefs = PreferencesSchema.parse((await Profile.findOne({ userId: req.userId }, 'preferences'))?.preferences ?? {});
  // all=1 ("Show all jobs found"): skip your pay, age, experience and platform settings; closed and junk stay out.
  const keep = all === '1' ? { 'job.liveness.status': { $ne: 'closed' }, 'job.junk.0': { $exists: false } } : preferenceFilter(prefs);

  const [result] = await JobMatch.aggregate([
    // found=today: matches made in the last 24 hours, the same window as "new jobs today" on the Jobs page
    { $match: { userId: req.userId, status, ...(found === 'today' && { createdAt: { $gt: new Date(Date.now() - 86_400_000) } }) } },
    // $lookup = a join: attach the Job document (without the long description) to each match
    { $lookup: { from: 'jobs', localField: 'jobId', foreignField: '_id', as: 'job', pipeline: [{ $project: { description: 0 } }] } },
    { $unwind: '$job' },
    { $match: jobFilter },
    {
      $facet: {
        items: [{ $match: keep }, { $sort: SORTS[sort] }, { $skip: skip }, { $limit: size }],
        shown: [{ $match: keep }, { $count: 'n' }],
        closedOrJunk: [{ $match: { $or: [{ 'job.liveness.status': 'closed' }, { 'job.junk.0': { $exists: true } }] } }, { $count: 'n' }],
        all: [{ $count: 'n' }],
      },
    },
  ]);
  const shown = result.shown[0]?.n ?? 0;
  // hiddenByPreferences: so an empty-looking feed can say "12 jobs hidden by your pay/age/platform settings"
  const closedOrJunk = result.closedOrJunk[0]?.n ?? 0;
  res.json({
    // ats: the job's form can be auto-applied (Greenhouse, Lever, Ashby); application: how far auto-apply got
    items: await withApplyStatus(req.userId, result.items),
    page,
    total: shown,
    pageSize: size,
    hasMore: skip + size < shown,
    closedOrJunk,
    hiddenByPreferences: (result.all[0]?.n ?? 0) - shown - closedOrJunk,
  });
});

// Platforms in your feed, with counts, for the Preferences checklist.
router.get('/platforms', async (req, res) => {
  res.json(
    await JobMatch.aggregate([
      { $match: { userId: req.userId } },
      { $lookup: { from: 'jobs', localField: 'jobId', foreignField: '_id', as: 'job', pipeline: [{ $project: { platform: 1 } }] } },
      { $unwind: '$job' },
      { $group: { _id: '$job.platform', count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, platform: '$_id', count: 1 } },
    ]),
  );
});

// Run a search now (the schedule also runs one every 6 hours).
router.post('/search', async (req, res) => {
  res.json(await runScrape(req.userId, 'manual'));
});

// Opening the Jobs tab calls this: a background search if the last one is over an hour old.
router.post('/refresh', async (req, res) => {
  res.json(await refreshIfStale(req.userId));
});

// The last search, plus whether one is running now and why the last background one failed (if it did).
router.get('/runs/latest', async (req, res) => {
  const run = await ScrapeRun.findOne({ userId: req.userId }).sort({ createdAt: -1 });
  res.json({ run, running: isSearching(req.userId), error: searchError(req.userId), nextScheduled: await nextScheduled(req.userId) });
});

// One of your matches, with the full job (description included).
async function findMine(req) {
  if (!mongoose.isValidObjectId(req.params.matchId)) throw httpError(404, 'Job not found');
  const match = await JobMatch.findOne({ _id: req.params.matchId, userId: req.userId }).populate('jobId');
  if (!match?.jobId) throw httpError(404, 'Job not found');
  return match;
}

router.get('/:matchId', async (req, res) => {
  const match = await findMine(req);
  res.json({ _id: match._id, status: match.status, fit: match.fit, ai: match.ai, job: match.jobId });
});

// Find hiring emails for this job. Cached on the job for a week, unless you give a different website.
router.post('/:matchId/contacts', async (req, res) => {
  const { website } = z.object({ website: z.url({ protocol: /^https?$/ }).optional() }).parse(req.body ?? {});
  const job = (await findMine(req)).jobId;
  const fresh = job.contacts?.checkedAt && Date.now() - job.contacts.checkedAt < 7 * 24 * 3600_000;
  if (fresh && (!website || new URL(website).origin === job.contacts.website)) return res.json(job.contacts);
  job.contacts = await findContacts(job, website);
  await job.save();
  await saveFoundContacts(req.userId, job, job.contacts); // also lands in your Contacts list
  res.json(job.contacts);
});

// Ask Gemini to review this job now (or again).
router.post('/:matchId/review', async (req, res) => {
  const match = await findMine(req);
  res.json(await reviewMatch(match, await reviewContext(req.userId)));
});

// Save or hide a job in your feed.
router.patch('/:matchId', async (req, res) => {
  const { status } = z.object({ status: z.enum(['new', 'saved', 'hidden']) }).parse(req.body);
  if (!mongoose.isValidObjectId(req.params.matchId)) throw httpError(404, 'Job not found');
  // userId in the filter: you can only change your own matches
  const match = await JobMatch.findOneAndUpdate({ _id: req.params.matchId, userId: req.userId }, { status }, { returnDocument: 'after' });
  if (!match) throw httpError(404, 'Job not found');
  res.json(match);
});

export default router;
