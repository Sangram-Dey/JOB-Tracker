import mongoose from 'mongoose';

// One job application through a company's own form (Greenhouse, Lever or Ashby).
//   preparing  -> waiting for / being filled in a hidden browser
//   prepared   -> filled; answers and a screenshot wait for your review
//   submitting -> you clicked Submit: the app fills the form again and presses the company's Submit button
//   opened     -> it couldn't submit on its own (a CAPTCHA, or a required answer missing): a window opened for you
//   applied    -> the company's confirmation page was seen (or you marked it applied)
//   skipped / failed
export const APPLY_STATUSES = ['preparing', 'prepared', 'submitting', 'opened', 'applied', 'skipped', 'failed'];

const fieldSchema = new mongoose.Schema(
  {
    id: String, // position on the form, used to fill it again
    kind: { type: String, enum: ['text', 'textarea', 'select', 'combobox', 'radio', 'checkbox', 'file'] },
    label: String,
    required: Boolean,
    options: [String],
    value: mongoose.Schema.Types.Mixed, // string, or a list for checkboxes; null = left blank
    source: { type: String, enum: ['profile', 'answers', 'ai', 'you', 'resume', 'blank'] },
    needsYou: Boolean, // left blank on purpose (sensitive, unknown or unsure): you answer it
  },
  { _id: false },
);

const autoApplySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobMatch' },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    company: String,
    title: String,
    formUrl: String,
    ats: { type: String, enum: ['greenhouse', 'lever', 'ashby'] },
    status: { type: String, enum: APPLY_STATUSES, default: 'prepared' },
    fields: [fieldSchema],
    screenshot: { type: Buffer, select: false }, // the filled form, before submitting
    confirmation: { type: Buffer, select: false }, // the company's "thank you" page
    error: String,
    step: String, // while preparing or submitting: what it is doing now (shown with a timer)
    stepAt: Date,
    appliedAt: Date,
    resumePdfId: mongoose.Schema.Types.ObjectId, // the tailored resume sent (resume/tailorJob.js); none = your own PDF
    useOriginal: { type: Boolean, default: false }, // you chose your own PDF over the tailored one
    history: [{ _id: false, status: String, at: Date }],
  },
  { timestamps: true },
);
autoApplySchema.index({ userId: 1, jobId: 1 }, { unique: true });
autoApplySchema.index({ userId: 1, status: 1, updatedAt: -1 }); // review queue and today's count
autoApplySchema.pre('save', function () {
  if (this.isNew || this.isModified('status')) this.history.push({ status: this.status, at: new Date() });
});

export const AutoApply = mongoose.model('AutoApply', autoApplySchema);
