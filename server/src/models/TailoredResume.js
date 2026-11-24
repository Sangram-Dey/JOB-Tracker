import mongoose from 'mongoose';

// Your resume tailored to one job (resume/tailorJob.js). One per you and job, shared by the HR email,
// auto-apply and the Jobs tab, so a job is tailored once and every place shows the same version.
//   stage: queued -> reading -> keywords -> writing -> checking -> pdf -> ready, or failed. The page follows it live.
export const TAILOR_STAGES = ['queued', 'reading', 'keywords', 'writing', 'checking', 'pdf', 'ready', 'failed'];
export const TAILOR_BUSY = ['queued', 'reading', 'keywords', 'writing', 'checking', 'pdf'];

const versionSchema = new mongoose.Schema(
  {
    pdfId: mongoose.Schema.Types.ObjectId, // GridFS; kept even when replaced, since an email or form may have sent it
    data: Object, // the tailored resume, in the profile's shape
    changes: [{ _id: false, path: String, kind: String, before: String, after: String, reason: String, keyword: String }],
    keywords: { added: [String], strengthened: [String], missing: [String] },
    before: Number, // keyword match of your original resume
    after: Number, // and of this version
    instruction: String, // what you asked for when you clicked Remodify
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const tailoredSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    stage: { type: String, enum: TAILOR_STAGES, default: 'queued' },
    note: String, // why there's no (new) version: nothing safe to change, no job description…
    error: String,
    versions: [versionSchema],
    current: { type: Number, default: -1 }, // the version in use; -1 = your original PDF
  },
  { timestamps: true },
);
tailoredSchema.index({ userId: 1, jobId: 1 }, { unique: true });

export const TailoredResume = mongoose.model('TailoredResume', tailoredSchema);
