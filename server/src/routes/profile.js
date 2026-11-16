import { Router } from 'express';
import multer from 'multer';
import { Profile } from '../models/Profile.js';
import { ProfileSchema } from '../schemas/profile.js';
import { parseResume, RESUME_TYPES } from '../ai/parseResume.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { httpError } from '../utils/httpError.js';
import { rescoreUser } from '../jobs/score.js';
import { MAX_PDF_BYTES, savePdf, deletePdf, readPdf } from '../resume/storage.js';

const router = Router();
router.use(requireAuth); // every profile route needs a logged-in user

// multer reads the multipart upload into memory (req.file.buffer). We don't keep the file, only the parsed JSON.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, RESUME_TYPES.includes(file.mimetype)),
});

// Your skills and experience feed the fit score, so every save re-scores the feed.
async function saveProfile(userId, update) {
  const saved = await Profile.findOneAndUpdate({ userId }, update, { upsert: true, returnDocument: 'after' });
  await rescoreUser(userId);
  return saved;
}

router.get('/', async (req, res) => {
  res.json(await Profile.findOne({ userId: req.userId })); // null until a resume is uploaded
});

router.post('/upload', upload.single('resume'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Upload a PDF, DOCX, image or text file (max 5 MB)');
  const data = await parseResume(req.file);
  res.json(await saveProfile(req.userId, { data, sourceFileName: req.file.originalname }));
});

// The resume PDF that application emails attach. One per user; a new upload replaces the old one.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});
router.put('/resume-pdf', pdfUpload.single('pdf'), async (req, res) => {
  // magic bytes, not just the browser's claimed type: only real PDFs get emailed to recruiters
  if (!req.file || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') throw httpError(400, 'Upload a PDF file (max 2 MB)');
  const id = await savePdf(req.file.buffer, req.file.originalname, { userId: req.userId });
  const old = await Profile.findOneAndUpdate(
    { userId: req.userId },
    { resumePdf: { id, name: req.file.originalname, size: req.file.size, savedAt: new Date() } },
    { upsert: true, timestamps: false }, // updatedAt keys the profile editor: don't wipe unsaved edits
  );
  await deletePdf(old?.resumePdf?.id);
  res.json(await Profile.findOne({ userId: req.userId }));
});

router.get('/resume-pdf', async (req, res) => {
  const pdf = (await Profile.findOne({ userId: req.userId }, 'resumePdf'))?.resumePdf;
  if (!pdf?.id) throw httpError(404, 'No resume PDF uploaded yet');
  res.type('application/pdf').attachment(pdf.name).send(await readPdf(pdf.id));
});

// Saves your manual corrections. Validated with the same schema the AI must follow.
router.put('/', async (req, res) => {
  const data = ProfileSchema.parse(req.body?.data);
  res.json(await saveProfile(req.userId, { data }));
});

export default router;
