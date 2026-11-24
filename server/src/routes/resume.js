import { Router } from 'express';
import mongoose from 'mongoose';
import '../models/Job.js'; // registers the Job model that populate('jobId') loads
import { JobMatch } from '../models/JobMatch.js';
import { Profile } from '../models/Profile.js';
import { ProfileSchema, withNamedLinks } from '../schemas/profile.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { pdfText, readability, searchTest, jobMatch } from '../resume/atsCheck.js';
import { resumeText, draftChecks, placeholdersIn, checkSuggestions } from '../resume/draft.js';
import { makePdf } from '../resume/pdf.js';
import { jobRequirements, suggestDraftEdits } from '../ai/atsAi.js';
import { yourYears } from '../jobs/score.js';
import { saveProfile, storePdf } from './profile.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

// Resume page: edit your resume with a live ATS score, AI suggestions, and an ATS-friendly PDF export.
// The draft is sent with each request (it's unsaved in the browser) and validated like a profile save.
const router = Router();
router.use(requireAuth);

const draftOf = (req) => ProfileSchema.parse(withNamedLinks(req.body?.data));

async function myProfile(userId) {
  const profile = await Profile.findOne({ userId });
  if (!profile?.data) throw httpError(400, 'Upload your resume in Settings first');
  return profile;
}

// What the draft is measured against: one job from your feed, or the skills your best-fit jobs ask for most.
async function measure(userId, matchId, data) {
  const profile = await myProfile(userId);
  const text = resumeText(data);
  if (matchId) {
    if (!mongoose.isValidObjectId(matchId)) throw httpError(404, 'Job not found');
    const match = await JobMatch.findOne({ _id: matchId, userId }).populate('jobId');
    const job = match?.jobId;
    if (!job) throw httpError(404, 'Job not found');
    if (!job.requirements) {
      job.requirements = await jobRequirements(job); // one Gemini call per job, kept for next time
      await job.save({ timestamps: false });
    }
    const prefs = PreferencesSchema.parse(profile.preferences ?? {});
    const r = jobMatch(text, job.requirements, job, { years: yourYears(prefs, data), prefs, profileData: data });
    return { profile, label: `${job.title} at ${job.company}`, score: r.score, has: [...r.required.found, ...r.preferred.found], missing: [...r.required.missing, ...r.preferred.missing], risks: r.risks };
  }
  const top = await JobMatch.find({ userId, status: { $ne: 'hidden' } }, 'jobId').sort({ 'fit.rank': -1 }).limit(40).populate('jobId', 'title description');
  const keys = searchTest(text, top.map((m) => `${m.jobId?.title}\n${m.jobId?.description ?? ''}`));
  const has = keys.filter((k) => k.found).map((k) => k.name);
  return { profile, label: 'your best-fit jobs', score: keys.length ? Math.round((100 * has.length) / keys.length) : null, has, missing: keys.filter((k) => !k.found).map((k) => k.name), risks: [] };
}

// Jobs to tailor for: your best fits, newest scores first.
router.get('/targets', async (req, res) => {
  const top = await JobMatch.find({ userId: req.userId, status: { $ne: 'hidden' } }, 'jobId fit.score').sort({ 'fit.rank': -1 }).limit(40).populate('jobId', 'title company');
  res.json(top.filter((m) => m.jobId).map((m) => ({ id: m._id, title: m.jobId.title, company: m.jobId.company, fit: m.fit?.score ?? null })));
});

// Live score: keywords found and missing, plus format checks. Plain code, no AI (except a job's first look).
router.post('/score', async (req, res) => {
  const data = draftOf(req);
  const { profile, ...m } = await measure(req.userId, req.body?.matchId, data);
  res.json({ ...m, checks: draftChecks(data), hasOriginal: Boolean(profile.uploadedData) });
});

// Gemini's edits, each tied to the field it changes and checked against your real history.
router.post('/suggest', async (req, res) => {
  const data = draftOf(req);
  const { profile, label, has, missing } = await measure(req.userId, req.body?.matchId, data);
  const history = [profile.uploadedData, profile.data].filter(Boolean);
  const list = await suggestDraftEdits({ data, history, target: label, has, missing });
  res.json(checkSuggestions(list, data, history));
});

async function renderPdf(data) {
  const where = placeholdersIn(data);
  if (where.length) throw httpError(400, `Fill in or remove the [X] placeholders first (${where.join(', ')})`);
  return makePdf(data);
}
const fileName = (data) => `${(data.contact?.name || 'Resume').replace(/[^\w .-]/g, '').trim()} Resume.pdf`;

// Download the ATS-friendly PDF of the draft.
router.post('/pdf', async (req, res) => {
  const data = draftOf(req);
  res.type('application/pdf').attachment(fileName(data)).send(await renderPdf(data));
});

// Save the draft and make its PDF the one attached to emails and applications. Then read it back like an ATS.
router.post('/pdf/use', async (req, res) => {
  const data = draftOf(req);
  const profile = await myProfile(req.userId);
  const buffer = await renderPdf(data);
  await saveProfile(req.userId, { data, ...(!profile.uploadedData && { uploadedData: profile.data }) });
  await storePdf(req.userId, { buffer, originalname: fileName(data), size: buffer.length });
  res.json({ file: fileName(data), readability: readability(await pdfText(buffer), data) });
});

// Back to what your last upload said.
router.post('/reset', async (req, res) => {
  const profile = await myProfile(req.userId);
  if (!profile.uploadedData) throw httpError(400, 'Nothing to reset to yet: your resume hasn’t been edited since the upload');
  res.json(await saveProfile(req.userId, { data: profile.uploadedData }));
});

export default router;
