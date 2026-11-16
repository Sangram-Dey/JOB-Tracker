import mongoose from 'mongoose';
import { httpError } from '../utils/httpError.js';

// Your resume PDF (the one attached to application emails) in GridFS: MongoDB's own file storage, so there is no separate file service to run or pay for.
export const MAX_PDF_BYTES = 2 * 1024 * 1024;

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'resumePdfs' });

// Saves a PDF and returns its file id. Refuses anything over 2 MB.
export async function savePdf(buffer, filename, metadata) {
  if (buffer.length > MAX_PDF_BYTES) throw httpError(413, `The PDF is ${(buffer.length / 1e6).toFixed(1)} MB; the limit is 2 MB`);
  const upload = bucket().openUploadStream(filename, { metadata, contentType: 'application/pdf' });
  await new Promise((resolve, reject) => upload.on('finish', resolve).on('error', reject).end(buffer));
  return upload.id;
}

export const openPdf = (id) => bucket().openDownloadStream(id);

export async function deletePdf(id) {
  if (!id) return;
  await bucket().delete(id).catch((err) => {
    if (!/FileNotFound/i.test(err.message)) throw err; // already gone is fine
  });
}

export async function readPdf(id) {
  const chunks = [];
  for await (const chunk of openPdf(id)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
