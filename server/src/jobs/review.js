import { Profile } from '../models/Profile.js';
import '../models/Job.js'; // registers the Job model that populate('jobId') loads
import { JobMatch } from '../models/JobMatch.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { rateJob } from '../ai/rateJob.js';
import { yourYears, rankOf } from './score.js';
import { httpError } from '../utils/httpError.js';

// Gemini reviews for your best-scored jobs. The free tier allows only a few requests a minute,
// so reviews go one at a time with a pause, at most REVIEWS_PER_RUN after each search.
const REVIEWS_PER_RUN = 20;
const PAUSE_MS = 4_500;
const reviewing = new Set(); // userIds with reviews in progress
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function reviewContext(userId) {
  const profile = await Profile.findOne({ userId });
  if (!profile?.data) throw httpError(400, 'Upload your resume first: the review compares jobs with your profile');
  const prefs = PreferencesSchema.parse(profile.preferences ?? {});
  return { profile: profile.data, prefs, years: yourYears(prefs, profile.data) };
}

// Reviews one match now and saves it on the match.
export async function reviewMatch(match, ctx) {
  match.ai = await rateJob(match.jobId, ctx);
  if (match.fit?.score != null) match.fit.rank = rankOf(match.fit.score, match.ai);
  await match.save();
  return match.ai;
}

// Runs in the background after a search: never awaited by the request, so Search now stays fast.
export async function reviewTopJobs(userId, limit = REVIEWS_PER_RUN) {
  if (reviewing.has(userId)) return 0;
  reviewing.add(userId);
  let done = 0;
  try {
    const ctx = await reviewContext(userId).catch(() => null);
    if (!ctx) return 0; // no resume yet: nothing to compare with
    const candidates = await JobMatch.find({ userId, status: { $ne: 'hidden' }, 'ai.ratedAt': null, 'fit.score': { $ne: null } })
      .sort({ 'fit.score': -1 })
      .limit(limit * 3)
      .populate('jobId');
    const worth = candidates.filter((m) => m.jobId && !m.jobId.junk?.length && m.jobId.liveness?.status !== 'closed').slice(0, limit);
    for (const match of worth) {
      try {
        await reviewMatch(match, ctx);
        done++;
      } catch (err) {
        if (err.status === 429) break; // out of free requests for now; the next search continues
        console.error('Review failed for', match.jobId?.title, err.message);
      }
      await sleep(PAUSE_MS);
    }
    return done;
  } finally {
    reviewing.delete(userId);
  }
}
