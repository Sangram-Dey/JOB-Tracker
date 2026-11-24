import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { TailoredResume } from '../models/TailoredResume.js';
import { JobMatch } from '../models/JobMatch.js';
import { Application } from '../models/Application.js';
import { startTailoring, undoChange, SECTIONS } from '../resume/tailorJob.js';
import { readPdf } from '../resume/storage.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

// Your resume tailored to one job: shared by the Jobs tab, HR emails and auto-apply (resume/tailorJob.js).
const router = Router();
router.use(requireAuth);

// Only jobs in your feed or your emails: tailoring costs Gemini calls.
async function jobOf(req) {
  const { jobId } = req.params;
  if (!mongoose.isValidObjectId(jobId)) throw httpError(404, 'Job not found');
  if (!(await JobMatch.exists({ userId: req.userId, jobId })) && !(await Application.exists({ userId: req.userId, jobId }))) throw httpError(404, 'Job not found');
  return jobId;
}

// Without the resume data of old versions: the page needs the current one in full and a summary of the rest.
const view = (doc) => {
  if (!doc) return { stage: 'none', versions: [], current: -1 };
  const { versions, ...rest } = doc.toObject();
  return { ...rest, versions: versions.map(({ data, ...v }) => v) };
};

router.get('/:jobId', async (req, res) => {
  const jobId = await jobOf(req);
  res.json(view(await TailoredResume.findOne({ userId: req.userId, jobId })));
});

// Tailor (first time), Regenerate (again + fresh: a new version from your own resume), or Remodify (again: builds on the
// current version), optionally only some sections and with a wish like "focus on backend".
router.post('/:jobId', async (req, res) => {
  const jobId = await jobOf(req);
  const opts = z
    .object({
      again: z.boolean().default(false),
      fresh: z.boolean().default(false),
      instruction: z.string().trim().max(200).default(''),
      sections: z.array(z.enum(Object.keys(SECTIONS))).max(4).default([]),
    })
    .parse(req.body ?? {});
  res.status(202).json(view(await startTailoring(req.userId, jobId, opts)));
});

router.post('/:jobId/undo', async (req, res) => {
  const jobId = await jobOf(req);
  const { index } = z.object({ index: z.number().int().min(0) }).parse(req.body);
  res.json(view(await undoChange(req.userId, jobId, index)));
});

// Go back to an earlier version (-1 = your original PDF).
router.post('/:jobId/version', async (req, res) => {
  const jobId = await jobOf(req);
  const { index } = z.object({ index: z.number().int().min(-1) }).parse(req.body);
  const doc = await TailoredResume.findOne({ userId: req.userId, jobId });
  if (!doc || index >= doc.versions.length) throw httpError(404, 'Version not found');
  doc.current = index;
  await doc.save();
  res.json(view(doc));
});

router.get('/:jobId/pdf', async (req, res) => {
  const jobId = await jobOf(req);
  const doc = await TailoredResume.findOne({ userId: req.userId, jobId });
  const v = doc?.versions[req.query.v != null ? Number(req.query.v) : doc.current];
  if (!v?.pdfId) throw httpError(404, 'No tailored resume for this job yet');
  res.type('application/pdf').set('Content-Disposition', 'inline; filename="tailored-resume.pdf"').send(await readPdf(v.pdfId));
});

export default router;
