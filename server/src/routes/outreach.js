import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Application } from '../models/Application.js';
import { Profile } from '../models/Profile.js';
import { gmailReady } from '../mail/send.js';
import { processQueue, sentInLastDay, DAILY_LIMIT, REPEAT_DAYS } from '../mail/queue.js';
import { prepareSelected, prepareDaily, preparing, lastPrepared, streak, warningsFor, DAILY_PREPARE } from '../mail/prepare.js';
import { companyKey } from '../jobs/normalize.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

// Email applications: AI prepares emails -> you review (edit if you like) -> approve and send, one or many.
const router = Router();
router.use(requireAuth);

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Unknown id');
const PLACEHOLDER = /\[[^\]]{1,40}\]/;
const hasPlaceholder = (app) => PLACEHOLDER.test(app.subject) || PLACEHOLDER.test(app.body);

async function findMine(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Email not found');
  const app = await Application.findOne({ _id: req.params.id, userId: req.userId });
  if (!app) throw httpError(404, 'Email not found');
  return app;
}

// Everything the page header shows: Gmail, today's progress, streak, and whether emails are being written.
router.get('/status', async (req, res) => {
  const [last24h, days, ready] = await Promise.all([
    sentInLastDay(req.userId),
    streak(req.userId),
    Application.countDocuments({ userId: req.userId, status: { $in: ['draft', 'approved'] } }),
  ]);
  res.json({
    gmail: gmailReady(),
    from: process.env.GMAIL_USER || null,
    sentLast24h: last24h,
    dailyLimit: DAILY_LIMIT,
    dailyGoal: DAILY_PREPARE,
    repeatDays: REPEAT_DAYS,
    ready,
    ...days,
    preparing: preparing(req.userId),
    lastPrepared: lastPrepared(req.userId),
  });
});

router.get('/', async (req, res) => {
  const filter = { userId: req.userId };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  res.json(await Application.find(filter).sort({ updatedAt: -1 }).limit(300));
});

// "Move to Ready": write emails for the contacts you ticked in the HR table (in the background).
router.post('/drafts', async (req, res) => {
  const { contactIds } = z.object({ contactIds: z.array(objectId).min(1).max(25) }).parse(req.body);
  res.status(202).json(await prepareSelected(req.userId, contactIds));
});

// "Prepare more": the app picks your best-fit companies itself (the same pick as every morning).
router.post('/prepare', async (req, res) => {
  const { count } = z.object({ count: z.number().int().min(1).max(25).default(DAILY_PREPARE) }).parse(req.body ?? {});
  res.status(202).json(await prepareDaily(req.userId, count));
});

// Your edits. Any change to an approved email sends it back to draft, so what goes out is always what you approved.
router.put('/:id', async (req, res) => {
  const body = z.object({ subject: z.string().trim().min(3).max(200).optional(), body: z.string().trim().min(20).max(5000).optional() }).parse(req.body);
  const app = await findMine(req);
  if (!['draft', 'approved', 'failed'].includes(app.status)) throw httpError(409, 'This email is already on its way');
  Object.assign(app, body);
  app.status = 'draft';
  const profile = await Profile.findOne({ userId: req.userId }, 'data');
  app.warnings = warningsFor(app.subject, app.body, [profile?.data].filter(Boolean));
  await app.save();
  res.json(app);
});

// You've read it: approve. Blocked while a [placeholder] is still in the text.
router.post('/:id/approve', async (req, res) => {
  const app = await findMine(req);
  if (!['draft', 'failed'].includes(app.status)) throw httpError(409, 'Only drafts can be approved');
  if (hasPlaceholder(app)) throw httpError(400, 'Fill in or remove the [placeholder] first');
  app.status = 'approved';
  await app.save();
  res.json(app);
});

// Send one email or many. approve: true also approves the drafts you ticked (ticking + clicking is your approval).
// Rules: within the daily limit, and at most one email per company per day (more looks like spam to a company's HR).
router.post('/send', async (req, res) => {
  const { ids, approve } = z.object({ ids: z.array(objectId).min(1).max(50), approve: z.boolean().default(false) }).parse(req.body);
  if (!gmailReady()) throw httpError(400, 'Connect Gmail first: add GMAIL_USER and GMAIL_APP_PASSWORD to server/.env');
  const left = DAILY_LIMIT - (await sentInLastDay(req.userId));
  if (left <= 0) throw httpError(429, `Daily limit reached (${DAILY_LIMIT} emails in 24 hours). They'll be ready to send tomorrow.`);

  const apps = await Application.find({ _id: { $in: ids }, userId: req.userId, status: { $in: approve ? ['draft', 'approved', 'failed'] : ['approved'] } });
  const today = await Application.find(
    { userId: req.userId, $or: [{ status: 'queued' }, { status: 'sent', sentAt: { $gt: new Date(Date.now() - 86_400_000) } }] },
    'company',
  );
  const emailedCompanies = new Set(today.map((a) => companyKey(a.company)));
  const go = [];
  const skipped = [];
  for (const app of apps) {
    const key = companyKey(app.company);
    if (hasPlaceholder(app)) skipped.push({ to: app.to, reason: 'Fill in the [placeholder] first' });
    else if (emailedCompanies.has(key)) skipped.push({ to: app.to, reason: `${app.company} already has an email today; send this one tomorrow` });
    else {
      emailedCompanies.add(key);
      go.push(app);
    }
  }
  if (!go.length) throw httpError(400, skipped[0]?.reason ?? 'Approve the emails first');
  for (const app of go) {
    if (app.status !== 'approved') {
      app.status = 'approved';
      await app.save(); // recorded in its history
    }
    app.status = 'queued';
    await app.save();
  }
  processQueue(req.userId).catch((err) => console.error('Email queue failed:', err.message));
  res.json({ queued: go.length, sendingToday: Math.min(go.length, left), skipped });
});

router.delete('/:id', async (req, res) => {
  const app = await findMine(req);
  if (!['draft', 'approved', 'failed'].includes(app.status)) throw httpError(409, 'This email is already on its way');
  await app.deleteOne();
  res.status(204).end();
});

export default router;
