import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact } from '../models/Contact.js';
import { hrTable } from '../mail/prepare.js';
import { discoverForTopJobs, refreshContacts, findingStatus } from '../jobs/contactBook.js';
import { lookupHr, hunterStatus } from '../sources/hunter.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

// The HR table: every contact with its company's active jobs, best fit first, plus active companies with no contact yet.
router.get('/', async (req, res) => {
  const { rows, uncovered } = await hrTable(req.userId);
  const finding = findingStatus(req.userId);
  res.json({ items: rows, uncovered, hunter: await hunterStatus(req.userId), finding: Boolean(finding?.running), lastFound: finding?.result ?? null });
});

// Opening the HR list calls this: the free finder runs in the background, at most once an hour.
router.post('/refresh', (req, res) => {
  res.json(refreshContacts(req.userId));
});

const email = z.string().trim().toLowerCase().pipe(z.email('That email address looks wrong'));
const ManualContact = z
  .object({
    company: z.string().trim().min(1).max(120),
    name: z.string().trim().max(120).optional(),
    position: z.string().trim().max(120).optional(),
    email: email.optional().or(z.literal('').transform(() => undefined)),
    phone: z.string().trim().regex(/^[+\d][\d\s().-]{7,20}$/, 'Phone numbers have 8 to 20 digits').optional().or(z.literal('').transform(() => undefined)),
    jobTitle: z.string().trim().max(120).optional(),
  })
  .refine((b) => b.email || b.phone, 'Give an email or a phone number');

// Paste many at once, one per line: company, email, name, position (name and position optional; commas or tabs,
// so rows copied from a spreadsheet work). Lines already in your list are skipped, never overwritten.
export function parseContactLines(text) {
  const contacts = [];
  const skipped = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const [company, mail, name, position] = line.split(/\t|,/).map((s) => s.trim());
    if (i === 0 && !mail?.includes('@')) return; // a header row
    const parsed = ManualContact.safeParse({ company, email: mail ?? '', name: name || undefined, position: position || undefined });
    if (!parsed.success || !parsed.data.email) skipped.push({ line: i + 1, reason: parsed.error?.issues[0]?.message ?? 'No email on this line' });
    else contacts.push(parsed.data);
  });
  return { contacts, skipped };
}

router.post('/import', async (req, res) => {
  const { text } = z.object({ text: z.string().min(3).max(100_000) }).parse(req.body);
  const { contacts, skipped } = parseContactLines(text);
  if (contacts.length > 500) throw httpError(400, 'Up to 500 contacts at a time');
  const result = contacts.length
    ? await Contact.bulkWrite(
        contacts.map((c) => ({
          updateOne: {
            filter: { userId: req.userId, email: c.email },
            update: { $setOnInsert: { ...c, userId: req.userId, source: 'manual', kind: c.name ? 'person' : 'role' } },
            upsert: true,
          },
        })),
        { ordered: false },
      )
    : { upsertedCount: 0 };
  res.json({ added: result.upsertedCount, alreadyThere: contacts.length - result.upsertedCount, skipped });
});

// Add someone you found yourself (Apollo's web app, LinkedIn, a company's team page…).
router.post('/', async (req, res) => {
  const body = ManualContact.parse(req.body);
  if (body.email && (await Contact.exists({ userId: req.userId, email: body.email }))) throw httpError(409, 'That email is already in your contacts');
  const contact = await Contact.create({ ...body, userId: req.userId, source: 'manual', kind: body.name ? 'person' : 'role' });
  res.status(201).json(contact);
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Contact not found');
  const { deletedCount } = await Contact.deleteOne({ _id: req.params.id, userId: req.userId });
  if (!deletedCount) throw httpError(404, 'Contact not found');
  res.status(204).end();
});

// Run the free finder (job posts + company sites) on your best-fit jobs that haven't been checked yet.
router.post('/discover', async (req, res) => {
  res.json(await discoverForTopJobs(req.userId));
});

// Hunter.io: HR people at one company, by its website domain or just its name.
router.post('/hunter', async (req, res) => {
  const { domain, company, jobId } = z
    .object({ domain: z.string().max(200).optional(), company: z.string().trim().max(120).optional(), jobId: z.string().optional() })
    .refine((b) => b.domain?.trim() || b.company, 'Give the company website or its name')
    .parse(req.body);
  res.json(await lookupHr(req.userId, { domain, company, jobId: jobId && mongoose.isValidObjectId(jobId) ? jobId : undefined }));
});

export default router;
