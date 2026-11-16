import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Profile } from '../models/Profile.js';
import { AutoApply } from '../models/AutoApply.js';
import { ApplyAnswersSchema } from '../schemas/applyAnswers.js';
import { queuePrepare, queueSubmit, openNow, DAILY_APPLY_LIMIT } from '../apply/run.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

// Auto-apply on companies' own forms (Greenhouse, Lever, Ashby), started from the Jobs page:
// tick jobs -> Prepare (filled in the background) -> review each -> Submit (the app presses the form's Submit button;
// if it can't, a window opens for you). See apply/run.js.
const router = Router();
router.use(requireAuth);

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Unknown id');

router.get('/answers', async (req, res) => {
  res.json((await Profile.findOne({ userId: req.userId }, 'applyAnswers'))?.applyAnswers ?? {});
});

router.put('/answers', async (req, res) => {
  const applyAnswers = ApplyAnswersSchema.parse(req.body ?? {});
  await Profile.updateOne({ userId: req.userId }, { applyAnswers }, { upsert: true, timestamps: false });
  res.json(applyAnswers);
});

// The review queue on the Jobs page: everything not finished, newest first, plus today's count.
router.get('/queue', async (req, res) => {
  const items = await AutoApply.find({ userId: req.userId, status: { $nin: ['applied', 'skipped'] } }, '-fields').sort({ updatedAt: -1 }).limit(100);
  const needs = await AutoApply.aggregate([
    { $match: { userId: req.userId, _id: { $in: items.map((i) => i._id) } } },
    { $project: { n: { $size: { $filter: { input: '$fields', cond: { $and: ['$$this.needsYou', { $in: ['$$this.value', [null, '']] }] } } } } } },
  ]);
  const needsBy = new Map(needs.map((x) => [String(x._id), x.n]));
  const today = await AutoApply.countDocuments({ userId: req.userId, status: { $in: ['submitting', 'opened', 'applied'] }, updatedAt: { $gt: new Date(Date.now() - 86_400_000) } });
  res.json({ items: items.map((i) => ({ ...i.toJSON(), needsYou: needsBy.get(String(i._id)) ?? 0 })), today, dailyLimit: DAILY_APPLY_LIMIT });
});

router.post('/prepare', async (req, res) => {
  const { matchIds } = z.object({ matchIds: z.array(objectId).min(1).max(20) }).parse(req.body);
  const profile = await Profile.findOne({ userId: req.userId }, 'data resumePdf');
  if (!profile?.data || !profile.resumePdf?.id) throw httpError(400, 'Upload your resume (and the resume PDF) on the Profile page first');
  res.status(202).json(await queuePrepare(req.userId, matchIds));
});

router.post('/submit', async (req, res) => {
  const { ids } = z.object({ ids: z.array(objectId).min(1).max(20) }).parse(req.body);
  res.status(202).json(await queueSubmit(req.userId, ids));
});

async function mine(req, select) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Application not found');
  const app = await AutoApply.findOne({ _id: req.params.id, userId: req.userId }).select(select ?? '');
  if (!app) throw httpError(404, 'Application not found');
  return app;
}

router.get('/:id', async (req, res) => {
  res.json(await mine(req));
});

router.get('/:id/screenshot', async (req, res) => {
  const app = await mine(req, '+screenshot +confirmation');
  const image = req.query.confirmation ? app.confirmation : app.screenshot;
  if (!image) throw httpError(404, 'No screenshot yet');
  res.type('image/jpeg').send(image);
});

// Your corrections: any field's value. A corrected field no longer needs you.
router.put('/:id', async (req, res) => {
  const { fields } = z.object({ fields: z.array(z.object({ id: z.string(), value: z.union([z.string().max(4000), z.array(z.string().max(300)), z.null()]) })).max(200) }).parse(req.body);
  const app = await mine(req);
  if (['applied', 'submitting', 'preparing'].includes(app.status)) throw httpError(409, 'This application is busy or done');
  for (const { id, value } of fields) {
    const f = app.fields.find((x) => x.id === id);
    if (!f || f.kind === 'file') continue;
    f.value = value === '' ? null : value;
    f.source = f.value == null ? 'blank' : 'you';
    f.needsYou = f.value == null && f.required;
  }
  app.markModified('fields');
  await app.save();
  res.json(app);
});

// Open the filled form in a visible window to finish it yourself.
router.post('/:id/open', async (req, res) => {
  const app = await mine(req);
  if (['applied', 'submitting', 'preparing'].includes(app.status)) throw httpError(409, 'This application is busy or done');
  await openNow(app);
  res.json({ opened: true });
});

router.post('/:id/applied', async (req, res) => {
  const app = await mine(req);
  Object.assign(app, { status: 'applied', appliedAt: app.appliedAt ?? new Date(), error: undefined });
  await app.save();
  res.json(app);
});

router.post('/:id/skip', async (req, res) => {
  const app = await mine(req);
  app.status = 'skipped';
  await app.save();
  res.json(app);
});

export default router;
