import mongoose from 'mongoose';

// One card on the Tracker board: an application you made, however you made it.
//   kind: email (sent to HR from the Email page), form (auto-apply), manual (added by you)
//   stage: applied -> replied -> interview -> offer, or rejected. Inbox checks only move it forward.
export const STAGES = ['applied', 'replied', 'interview', 'rejected', 'offer']; // in "forward" order
export const KINDS = ['email', 'form', 'manual'];

const trackedSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    kind: { type: String, enum: KINDS, required: true },
    sourceId: mongoose.Schema.Types.ObjectId, // the Application (email) or AutoApply (form) it came from
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    company: { type: String, required: true },
    role: String,
    url: String,
    tailoredResume: Boolean, // auto-apply sent a resume tailored to this job (GET /api/apply/<sourceId>/resume)
    to: String, // HR email address (email kind, or added by you): replies from it are matched
    messageId: String, // your sent email's id: a reply to it is matched for sure
    appliedAt: { type: Date, default: Date.now },
    stage: { type: String, enum: STAGES, default: 'applied' },
    notes: { type: String, default: '' },
    reply: { from: String, subject: String, snippet: String, at: Date, messageId: String },
    unread: { type: Boolean, default: false }, // a reply came in that you haven't opened yet
    history: [{ _id: false, stage: String, at: Date, by: { type: String, enum: ['you', 'inbox', 'app'] } }],
  },
  { timestamps: true },
);
// One card per email or auto-application, so syncing again never makes duplicates.
trackedSchema.index({ userId: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $exists: true } } });

trackedSchema.pre('save', function () {
  if (this.isNew) this.history.push({ stage: this.stage, at: this.appliedAt ?? new Date(), by: 'app' });
});

export const Tracked = mongoose.model('Tracked', trackedSchema);
