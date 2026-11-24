import { Router } from 'express';
import mongoose from 'mongoose';
import '../models/Job.js'; // registers the Job model that populate('jobId') loads
import { JobMatch } from '../models/JobMatch.js';
import { Profile } from '../models/Profile.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { readPdf } from '../resume/storage.js';
import { pdfText, readability, searchTest, jobMatch } from '../resume/atsCheck.js';
import { factIssues } from '../resume/factCheck.js';
import { jobRequirements, suggestFixes } from '../ai/atsAi.js';
import { yourYears } from '../jobs/score.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

// ATS check of the resume PDF on your Profile: on its own, and against one job in your feed.
const router = Router();
router.use(requireAuth);

async function myResume(userId) {
  const profile = await Profile.findOne({ userId });
  if (!profile?.resumePdf?.id) throw httpError(400, 'Upload your resume PDF in Settings first');
  const pdf = await pdfText(await readPdf(profile.resumePdf.id)).catch(() => {
    throw httpError(400, 'That PDF could not be read; export it again from Word or Google Docs');
  });
  return { profile, pdf, prefs: PreferencesSchema.parse(profile.preferences ?? {}) };
}

// Can an ATS read it, and does it have the skills your best-fit jobs ask for most?
router.post('/resume', async (req, res) => {
  const { profile, pdf } = await myResume(req.userId);
  const top = await JobMatch.find({ userId: req.userId, status: { $ne: 'hidden' } }, 'jobId')
    .sort({ 'fit.rank': -1 })
    .limit(40)
    .populate('jobId', 'title description');
  res.json({
    file: profile.resumePdf.name,
    readability: readability(pdf, profile.data),
    searchTest: searchTest(pdf.text, top.map((m) => `${m.jobId?.title}\n${m.jobId?.description ?? ''}`)),
    jobsCompared: top.length,
  });
});

async function matchFor(req) {
  if (!mongoose.isValidObjectId(req.params.matchId)) throw httpError(404, 'Job not found');
  const match = await JobMatch.findOne({ _id: req.params.matchId, userId: req.userId }).populate('jobId');
  if (!match?.jobId) throw httpError(404, 'Job not found');
  const job = match.jobId;
  if (!job.requirements) {
    job.requirements = await jobRequirements(job); // one Gemini call per job, kept for next time
    await job.save({ timestamps: false });
  }
  const mine = await myResume(req.userId);
  const result = jobMatch(mine.pdf.text, job.requirements, job, { years: yourYears(mine.prefs, mine.profile.data), prefs: mine.prefs, profileData: mine.profile.data });
  return { ...mine, job, result };
}

// Match % for one job, skills found and missing, and filter risks.
router.post('/job/:matchId', async (req, res) => {
  const { result } = await matchFor(req);
  res.json(result);
});

// Gemini's suggested edits for this job, each checked against your history (anything not in it is flagged).
router.post('/job/:matchId/suggest', async (req, res) => {
  const { profile, pdf, job, result } = await matchFor(req);
  const suggestions = await suggestFixes({
    resumeText: pdf.text,
    profile: profile.data,
    jobTitle: job.title,
    matched: [...result.required.found, ...result.preferred.found],
    missing: [...result.required.missing, ...result.preferred.missing],
  });
  res.json(suggestions.map((s) => ({ ...s, warnings: factIssues({ summary: s.after }, [profile.data, pdf.text]).map((i) => `${i.reason}: ${i.text}`) })));
});

export default router;
