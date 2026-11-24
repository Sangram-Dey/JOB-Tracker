import '../models/Job.js';
import { TailoredResume, TAILOR_BUSY } from '../models/TailoredResume.js';
import { Profile } from '../models/Profile.js';
import { PreferencesSchema } from '../schemas/preferences.js';
import { jobMatch } from './atsCheck.js';
import { resumeText, checkSuggestions, applySafe, replayChanges, keywordReport } from './draft.js';
import { makePdf } from './pdf.js';
import { savePdf } from './storage.js';
import { jobRequirements, suggestDraftEdits } from '../ai/atsAi.js';
import { withBusyRetry } from '../ai/gemini.js';
import { yourYears } from '../jobs/score.js';
import { httpError } from '../utils/httpError.js';

// Tailors your resume to one job in the background, one job at a time per user, saving each step so the page can
// show the analysis live. Only edits that pass the truth checks (resume/draft.js applySafe) are made.
// Every new version gets its own PDF; old ones are kept because an email or form may already have sent them.
// shortcut: in-memory queue, so a restart drops queued work (recoverTailoring marks it failed); fine for one server.

const chains = new Map(); // userId -> promise chain
const runs = new Map(); // TailoredResume id -> its run, so senders can wait for it

export const tailoringOn = (profile) => PreferencesSchema.parse(profile?.preferences ?? {}).tailorResume;
const pdfName = (data) => `${(data.contact?.name || 'Resume').replace(/[^\w .-]+/g, '')} - Resume.pdf`;

// Parts of the resume Remodify can be limited to, and the profile fields each one covers.
export const SECTIONS = { summary: ['headline', 'summary'], skills: ['skills', 'certifications'], experience: ['experience'], projects: ['projects'] };
export const inSections = (path, sections) => !sections?.length || sections.some((s) => SECTIONS[s].some((k) => path === k || path.startsWith(`${k}.`)));

// Starts tailoring if it hasn't been done, or again: true for Regenerate (fresh: from your own resume) and
// Remodify (on top of the current version, optionally only `sections`). Returns the record at once.
export async function startTailoring(userId, jobId, { again = false, fresh = false, instruction = '', sections = [] } = {}) {
  const doc = (await TailoredResume.findOne({ userId, jobId })) ?? new TailoredResume({ userId, jobId });
  if (TAILOR_BUSY.includes(doc.stage) && !doc.isNew) return doc; // already working on it
  if (!doc.isNew && !again && doc.stage === 'ready') return doc;
  Object.assign(doc, { stage: 'queued', error: undefined, note: undefined });
  await doc.save();
  const run = (chains.get(userId) ?? Promise.resolve())
    .then(() => tailor(doc._id, { again, fresh, instruction, sections }))
    .catch(async (err) => {
      const error = err.status === 429 ? 'Gemini’s free limit is used up for now; your original PDF is used. Try again later.' : String(err.message ?? err).slice(0, 200);
      await TailoredResume.updateOne({ _id: doc._id }, { stage: 'failed', error });
    });
  chains.set(userId, run);
  runs.set(String(doc._id), run);
  run.finally(() => runs.get(String(doc._id)) === run && runs.delete(String(doc._id)));
  return doc;
}

// The PDF to send for this job: the current tailored version, waiting for one in progress. null = use your original.
export async function tailoredPdfFor(userId, jobId) {
  const doc = await startTailoring(userId, jobId);
  await runs.get(String(doc._id));
  const done = await TailoredResume.findById(doc._id);
  return done.versions[done.current]?.pdfId ?? null;
}

async function tailor(id, { again, fresh, instruction, sections }) {
  const doc = await TailoredResume.findById(id).populate('jobId');
  const job = doc.jobId;
  const step = (stage, note) => ((doc.stage = stage), (doc.note = note), doc.save()); // a new step clears a "retrying" note
  // Gemini overloaded: say so on the card, wait 30 s, try once more
  const retrying = { onBusy: () => ((doc.note = 'Gemini is busy, trying again in 30 seconds…'), doc.save()) };
  const profile = await Profile.findOne({ userId: doc.userId });
  if (!profile?.data) throw new Error('Upload your resume in Settings first');
  if (!job) throw new Error('This job is no longer in the database');

  await step('reading');
  if ((job.description ?? '').trim().length < 200) {
    return step('ready', 'This job has no real description to tailor to, so your original PDF is used.');
  }
  if (!job.requirements) {
    job.requirements = await withBusyRetry(() => jobRequirements(job), retrying); // one Gemini call per job, kept for next time
    await job.save({ timestamps: false });
  }

  await step('keywords');
  const prefs = PreferencesSchema.parse(profile.preferences ?? {});
  const score = (d) => jobMatch(resumeText(d), job.requirements, job, { years: yourYears(prefs, d), prefs, profileData: d });
  const prev = doc.versions[doc.current];
  const building = Boolean(again && !fresh && prev); // Remodify builds on the version you have; Regenerate starts over
  const base = building ? prev.data : profile.data;
  const was = score(profile.data); // "before" is always your own resume
  const cur = score(base);
  const history = [profile.uploadedData, profile.data].filter(Boolean);

  await step('writing');
  const only = sections.length ? `Only change these parts of the resume: ${sections.join(', ')}. ` : '';
  const suggestions = (
    await withBusyRetry(
      () =>
        suggestDraftEdits({
          data: base,
          history,
          target: `${job.title} at ${job.company}`,
          has: [...cur.required.found, ...cur.preferred.found],
          missing: [...cur.required.missing, ...cur.preferred.missing],
          auto: true,
          again: Boolean(again && prev),
          instruction: `${only}${instruction}`.trim(),
        }),
      retrying,
    )
  ).filter((s) => inSections(s.path, sections)); // the model is asked, and this makes sure

  await step('checking');
  const { data, changes } = applySafe(base, checkSuggestions(suggestions, base, history), history.map(resumeText).join('\n'));
  if (!changes.length) {
    return step('ready', prev ? 'No further safe changes found, so this version stays.' : 'Nothing could be changed without adding things that aren’t in your history, so your original PDF is used.');
  }
  const all = [...(building ? prev.changes.map((c) => c.toObject()) : []), ...changes];

  await step('pdf');
  const label = [fresh ? 'Regenerated' : '', sections.length ? `only ${sections.join(', ')}` : '', instruction].filter(Boolean).join(' · ');
  await addVersion(doc, data, all, was, score(data), label);
}

async function addVersion(doc, data, changes, was, now, instruction = '') {
  const pdfId = await savePdf(await makePdf(data), pdfName(data), { userId: doc.userId, jobId: doc.jobId?._id ?? doc.jobId });
  doc.versions.push({ pdfId, data, changes, keywords: keywordReport(was, now, changes), before: was.score, after: now.score, instruction });
  Object.assign(doc, { current: doc.versions.length - 1, stage: 'ready', note: undefined, error: undefined });
  await doc.save();
}

// Undo one change of the current version: a new version without it, with its own PDF.
export async function undoChange(userId, jobId, index) {
  const doc = await TailoredResume.findOne({ userId, jobId }).populate('jobId');
  const v = doc?.versions[doc.current];
  if (!v?.changes[index]) throw httpError(404, 'Change not found');
  if (TAILOR_BUSY.includes(doc.stage)) throw httpError(409, 'Still working on this resume');
  const profile = await Profile.findOne({ userId });
  const changes = v.changes.filter((_, i) => i !== index).map((c) => c.toObject());
  if (!changes.length) {
    doc.current = -1; // nothing left: your original
    doc.note = 'Every change was undone, so your original PDF is used.';
    return doc.save();
  }
  const job = doc.jobId;
  const prefs = PreferencesSchema.parse(profile.preferences ?? {});
  const score = (d) => jobMatch(resumeText(d), job.requirements, job, { years: yourYears(prefs, d), prefs, profileData: d });
  const data = replayChanges(profile.data, changes);
  await addVersion(doc, data, changes, score(profile.data), score(data), 'Undid a change');
  return doc;
}

// A restart stops the in-memory queue: anything mid-way is marked failed so it can be started again.
export const recoverTailoring = () =>
  TailoredResume.updateMany({ stage: { $in: TAILOR_BUSY } }, { $set: { stage: 'failed', error: 'Interrupted by a server restart; try again' } });
