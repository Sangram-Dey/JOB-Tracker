import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Tracked, STAGES } from '../models/Tracked.js';
import { moveTo } from '../tracker/track.js';
import { checkInbox, inboxReady, inboxStatusOf } from '../tracker/inbox.js';
import { NOT_CONNECTED } from '../mail/send.js';
import { todaySummary } from '../tracker/summary.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

// The Tracker board: every application (emails you sent, forms applied, ones you add) and where it stands.
const router = Router();
router.use(requireAuth);

async function mine(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Card not found');
  const card = await Tracked.findOne({ _id: req.params.id, userId: req.userId });
  if (!card) throw httpError(404, 'Card not found');
  return card;
}

// Cards are added when an email is sent or a form applied (and by each inbox check), not on every page load.
router.get('/', async (req, res) => {
  const items = await Tracked.find({ userId: req.userId }).sort({ appliedAt: -1 }).limit(1000);
  res.json({ items, inbox: { ready: await inboxReady(req.userId), ...inboxStatusOf(req.userId) } });
});

router.get('/today', async (req, res) => {
  res.json(await todaySummary(req.userId));
});

// Check Gmail for replies now (it also runs every 30 minutes).
router.post('/check-inbox', async (req, res) => {
  if (!(await inboxReady(req.userId))) throw httpError(400, NOT_CONNECTED);
  res.json(await checkInbox(req.userId));
});

// An application you made somewhere else (Naukri, a referral, a career site).
const email = z.string().trim().toLowerCase().email().max(200);
router.post('/', async (req, res) => {
  const body = z
    .object({
      company: z.string().trim().min(1).max(200),
      role: z.string().trim().max(200).optional(),
      url: z.string().trim().url().max(1000).optional().or(z.literal('').transform(() => undefined)),
      to: email.optional().or(z.literal('').transform(() => undefined)),
      appliedAt: z.coerce.date().optional(),
      jobId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Unknown job').optional(), // "I applied" on a job in the feed
    })
    .parse(req.body);
  const existing = body.jobId && (await Tracked.findOne({ userId: req.userId, jobId: body.jobId }));
  if (existing) return res.json(existing); // already on the board
  res.status(201).json(await Tracked.create({ ...body, userId: req.userId, kind: 'manual' }));
});

// Move a card, write notes, or mark its reply as read.
router.put('/:id', async (req, res) => {
  const { stage, notes, read } = z.object({ stage: z.enum(STAGES).optional(), notes: z.string().max(5000).optional(), read: z.boolean().optional() }).parse(req.body);
  const card = await mine(req);
  if (stage) moveTo(card, stage, 'you');
  if (notes !== undefined) card.notes = notes;
  if (read) card.unread = false;
  await card.save();
  res.json(card);
});

// Only cards you added: sent emails and applied forms always keep their card.
router.delete('/:id', async (req, res) => {
  const card = await mine(req);
  if (card.kind !== 'manual') throw httpError(409, 'Only cards you added can be deleted. Move this one to Rejected instead.');
  await card.deleteOne();
  res.json({ deleted: true });
});

export default router;
