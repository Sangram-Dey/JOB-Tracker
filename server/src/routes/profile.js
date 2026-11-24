import { Router } from 'express';
import multer from 'multer';
import { Profile } from '../models/Profile.js';
import { ProfileSchema, withNamedLinks } from '../schemas/profile.js';
import { parseResume, PDF } from '../ai/parseResume.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';
import { rescoreUser } from '../jobs/score.js';
import { MAX_PDF_BYTES, savePdf, deletePdf, readPdf } from '../resume/storage.js';
import { placeholdersIn } from '../resume/draft.js';
import { encrypt, verifyMail, cleanPassword } from '../mail/send.js';
import { PROVIDER_IDS, providerFor } from '../mail/providers.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth); // every profile route needs a logged-in user

// multer reads the multipart upload into memory (req.file.buffer); the size check below gives a clear message.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === PDF),
});

// Your skills and experience feed the fit score, so every save re-scores the feed: in the background,
// so you don't wait for it. The Jobs page shows the new scores on its next load.
export async function saveProfile(userId, update) {
  const saved = await Profile.findOneAndUpdate({ userId }, update, { upsert: true, returnDocument: 'after' });
  rescoreUser(userId).catch((err) => console.error('Re-scoring jobs after a profile save failed:', err));
  return saved;
}

// Older profiles are shown in today's shape (named links, schema field order); saving stores it that way.
const current = (data) => {
  const named = withNamedLinks(data);
  return ProfileSchema.safeParse(named).data ?? named;
};

router.get('/', async (req, res) => {
  const profile = await Profile.findOne({ userId: req.userId }); // null until a resume is uploaded
  if (profile?.data) profile.data = current(profile.data);
  res.json(profile);
});

// Keeps a PDF as the resume attached to emails and applications, replacing the old one.
export async function storePdf(userId, file) {
  const id = await savePdf(file.buffer, file.originalname, { userId });
  const old = await Profile.findOneAndUpdate(
    { userId },
    { resumePdf: { id, name: file.originalname, size: file.size, savedAt: new Date() } },
    { upsert: true, timestamps: false }, // updatedAt keys the profile editor: don't wipe unsaved edits
  );
  await deletePdf(old?.resumePdf?.id);
}
const isPdf = (file) => file.buffer.subarray(0, 5).toString() === '%PDF-';

router.post('/upload', upload.single('resume'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Upload your resume as a PDF (max 2 MB)');
  // one upload does both: the PDF is read into your profile and kept as the file attached to emails and applications
  if (req.file.mimetype !== PDF || !isPdf(req.file)) throw httpError(400, 'Upload your resume as a PDF');
  if (req.file.size > MAX_PDF_BYTES) throw httpError(413, 'Keep the PDF under 2 MB: mail and job forms reject bigger files');
  const data = await parseResume(req.file);
  await storePdf(req.userId, req.file);
  // uploadedData: what the upload said, so the Resume page can reset your edits to it
  res.json(await saveProfile(req.userId, { data: withNamedLinks(data), uploadedData: withNamedLinks(data), sourceFileName: req.file.originalname }));
});

router.get('/resume-pdf', async (req, res) => {
  const pdf = (await Profile.findOne({ userId: req.userId }, 'resumePdf'))?.resumePdf;
  if (!pdf?.id) throw httpError(404, 'No resume PDF uploaded yet');
  res.type('application/pdf').attachment(pdf.name).send(await readPdf(pdf.id));
});

// Sending email: connect or replace your apply email (Gmail or Yahoo Mail, with an app password).
// Checked with the provider first: a failed check changes nothing, so a replaced email keeps working until the new one is verified.
router.put('/mail', async (req, res) => {
  const body = z
    .object({
      user: z.string().trim().toLowerCase().email('Enter your email address').max(200),
      pass: z.string().transform(cleanPassword).pipe(z.string().length(16, 'An app password is 16 letters')),
      provider: z.enum(PROVIDER_IDS).optional(),
    })
    .parse(req.body ?? {});
  const provider = body.provider ?? providerFor(body.user);
  if (!provider) throw httpError(400, 'Choose whether this is a Gmail or Yahoo Mail address');
  await verifyMail({ provider, user: body.user, pass: body.pass });
  const mailAccount = { provider, user: body.user, secret: encrypt(body.pass), verifiedAt: new Date() };
  await Profile.updateOne({ userId: req.userId }, { mailAccount }, { upsert: true, timestamps: false });
  res.json({ provider, user: body.user, verifiedAt: mailAccount.verifiedAt });
});

router.delete('/mail', async (req, res) => {
  await Profile.updateOne({ userId: req.userId }, { $unset: { mailAccount: 1 } }, { timestamps: false });
  res.status(204).end();
});

// Saves your manual corrections. Validated with the same schema the AI must follow.
router.put('/', async (req, res) => {
  const data = ProfileSchema.parse(withNamedLinks(req.body?.data));
  if (placeholdersIn(data).length) throw httpError(400, `Fill in or remove the [X] placeholders first (${placeholdersIn(data).join(', ')})`);
  // profiles uploaded before uploadedData existed: the first edit keeps the version before it as the reset point
  const old = await Profile.findOne({ userId: req.userId }, 'data uploadedData');
  res.json(await saveProfile(req.userId, { data, ...(!old?.uploadedData && old?.data && { uploadedData: old.data }) }));
});

export default router;
