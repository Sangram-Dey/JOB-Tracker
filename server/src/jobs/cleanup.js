import mongoose from 'mongoose';
import { Job } from '../models/Job.js';
import { JobMatch } from '../models/JobMatch.js';
import { Application } from '../models/Application.js';
import { AutoApply } from '../models/AutoApply.js';
import { Tracked } from '../models/Tracked.js';
import { Contact } from '../models/Contact.js';
import { Profile } from '../models/Profile.js';
import { TailoredResume, TAILOR_BUSY } from '../models/TailoredResume.js';
import { deletePdf } from '../resume/storage.js';

// Daily cleanup, so the database (Atlas free tier: 512 MB) doesn't fill with old jobs, drafts, screenshots and PDFs.
// Rule: only delete what nothing else points to. Your history stays: sent emails, applications, Tracker cards,
// saved jobs, contacts and your profile are never deleted here. dryRun: true counts instead of deleting.
export const KEEP_DAYS = { matches: 45, jobs: 60, closedJobs: 14, unsentDrafts: 30, failedApplies: 30, screenshots: 30 };
export const KEEP_LAST_VERSIONS = 2;
const DAY = 86_400_000;

// Which tailored-resume versions to keep: the current one, any that was sent, and the last few.
// -> { keep: [indexes, oldest first], current: the current version's new index (-1 stays -1) }
export function versionsToKeep(versions, current, sentPdfIds, keepLast = KEEP_LAST_VERSIONS) {
  const sent = new Set(sentPdfIds.map(String));
  const keep = versions
    .map((v, i) => i)
    .filter((i) => i === current || i >= versions.length - keepLast || (versions[i].pdfId && sent.has(String(versions[i].pdfId))));
  return { keep, current: current === -1 ? -1 : keep.indexOf(current) };
}

export async function cleanup({ dryRun = false, now = Date.now() } = {}) {
  const ago = (days) => new Date(now - days * DAY);
  const out = {};
  const remove = async (name, Model, filter) => {
    out[name] = dryRun ? await Model.countDocuments(filter) : (await Model.deleteMany(filter)).deletedCount;
  };

  // 1. Applications that never went anywhere. Applied ones lose only the big form screenshot (the confirmation stays).
  await remove('failedApplies', AutoApply, { status: { $in: ['skipped', 'failed'] }, updatedAt: { $lt: ago(KEEP_DAYS.failedApplies) } });
  const oldShots = { status: 'applied', updatedAt: { $lt: ago(KEEP_DAYS.screenshots) }, screenshot: { $exists: true } };
  out.screenshots = dryRun ? await AutoApply.countDocuments(oldShots) : (await AutoApply.updateMany(oldShots, { $unset: { screenshot: 1 } })).modifiedCount;
  await remove('unsentDrafts', Application, { status: { $in: ['draft', 'failed'] }, updatedAt: { $lt: ago(KEEP_DAYS.unsentDrafts) } });

  // 2. Old feed entries you never saved, unless you emailed or applied for that job.
  const usedJobs = (await Promise.all([Application.distinct('jobId'), AutoApply.distinct('jobId'), Tracked.distinct('jobId')])).flat().filter(Boolean);
  const staleMatch = { status: { $in: ['new', 'hidden'] }, createdAt: { $lt: ago(KEEP_DAYS.matches) }, jobId: { $nin: usedJobs } };
  await remove('matches', JobMatch, staleMatch);

  // 3. Jobs no one's feed, email, application or Tracker card points to any more: old, or closed for a while.
  // ($nor: the matches that stay, which is the same before and after step 2, so a dry run counts right too)
  const inFeeds = await JobMatch.distinct('jobId', { $nor: [staleMatch] });
  const jobFilter = {
    _id: { $nin: [...usedJobs, ...inFeeds] },
    $or: [{ createdAt: { $lt: ago(KEEP_DAYS.jobs) } }, { 'liveness.status': 'closed', 'liveness.checkedAt': { $lt: ago(KEEP_DAYS.closedJobs) } }],
  };
  const gone = (await Job.find(jobFilter, '_id').lean()).map((j) => j._id);
  out.jobs = gone.length;
  if (!dryRun && gone.length) {
    await Job.deleteMany({ _id: { $in: gone } });
    await Contact.updateMany({ jobIds: { $in: gone } }, { $pull: { jobIds: { $in: gone } } });
  }
  const goneSet = new Set(gone.map(String));

  // 4. Tailored resumes: drop old versions (and their PDFs) except the current one, the last few and any that was sent.
  const sentPdfs = (await Promise.all([Application.distinct('resumePdfId'), AutoApply.distinct('resumePdfId')])).flat().filter(Boolean);
  const sent = new Set(sentPdfs.map(String));
  out.tailoredVersions = 0;
  out.tailoredResumes = 0;
  for (const doc of await TailoredResume.find({ stage: { $nin: TAILOR_BUSY } })) {
    const jobGone = goneSet.has(String(doc.jobId)) || !(await Job.exists({ _id: doc.jobId }));
    if (jobGone && !doc.versions.some((v) => sent.has(String(v.pdfId)))) {
      out.tailoredResumes++;
      if (!dryRun) {
        for (const v of doc.versions) await deletePdf(v.pdfId);
        await doc.deleteOne();
      }
      continue;
    }
    const { keep, current } = versionsToKeep(doc.versions, doc.current, sentPdfs);
    const drop = doc.versions.filter((_, i) => !keep.includes(i));
    out.tailoredVersions += drop.length;
    if (dryRun || !drop.length) continue;
    for (const v of drop) await deletePdf(v.pdfId);
    doc.versions = keep.map((i) => doc.versions[i]);
    doc.current = current;
    await doc.save();
  }

  // 5. PDF files nothing points to (left by a crash between saving a file and its record). A day's grace for ones being made.
  // Files from the old resume builder (metadata.resumeId) are left alone: that's your data, delete it yourself if unwanted.
  const used = new Set(
    [
      ...(await Profile.distinct('resumePdf.id')),
      ...(await TailoredResume.distinct('versions.pdfId')),
      ...sentPdfs,
    ].map(String),
  );
  const files = await mongoose.connection.db.collection('resumePdfs.files').find({ uploadDate: { $lt: ago(1) }, 'metadata.resumeId': { $exists: false } }, { projection: { _id: 1 } }).toArray();
  const orphans = files.filter((f) => !used.has(String(f._id)));
  out.orphanPdfs = orphans.length;
  if (!dryRun) for (const f of orphans) await deletePdf(f._id);
  return out;
}

// Once a day, from the half-hourly timer in index.js. Logs only when something was removed.
let lastRun = 0;
export async function cleanupDaily() {
  if (Date.now() - lastRun < DAY) return;
  lastRun = Date.now();
  const out = await cleanup();
  if (Object.values(out).some(Boolean)) console.log('Cleanup removed:', out);
}
