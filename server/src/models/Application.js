import mongoose from 'mongoose';

// One application you're making. Today: an email to a hiring contact. The Tracker builds on these same records.
//   draft    -> written by AI, waiting for your review
//   approved -> you read it and clicked Approve (editing it again sends it back to draft)
//   queued   -> you clicked Send; waiting its turn (emails go out spaced apart)
//   sent / failed
export const STATUSES = ['draft', 'approved', 'queued', 'sent', 'failed'];

const applicationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    company: String,
    jobTitle: String,
    to: { type: String, required: true },
    toName: String,
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: 'draft' },
    warnings: [String], // numbers or placeholders not found in your history: check before approving
    sentAt: Date,
    useOriginal: { type: Boolean, default: false }, // you chose your own PDF over the one tailored to this job
    resumePdfId: mongoose.Schema.Types.ObjectId, // the tailored resume that was attached (resume/tailorJob.js); none = your own
    messageId: String, // Gmail's id for the sent email
    error: String,
    history: [{ _id: false, status: String, at: Date }],
  },
  { timestamps: true },
);
applicationSchema.index({ userId: 1, to: 1, sentAt: -1 });
applicationSchema.index({ userId: 1, status: 1, sentAt: -1 }); // daily limit, queue, Ready to send

// Every status change is recorded, so the Tracker can show a timeline.
applicationSchema.pre('save', function () {
  if (this.isNew || this.isModified('status')) this.history.push({ status: this.status, at: new Date() });
});

export const Application = mongoose.model('Application', applicationSchema);
