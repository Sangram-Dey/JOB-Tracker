import mongoose from 'mongoose';

// "This job is in this user's feed": your status, fit score and AI review for one job. Personal, so not on Job.
const jobMatchSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    status: { type: String, enum: ['new', 'saved', 'hidden'], default: 'new' },
    // Rule score from jobs/score.js, recomputed after each search and when you save Preferences or Profile.
    fit: {
      score: Number, // 0–100
      rank: Number, // score moved by the AI rating; what "Best fit" sorts by
      parts: { skills: Number, role: Number, experience: Number, location: Number, freshness: Number, pay: Number },
      matchedSkills: [String],
      scoredAt: Date,
    },
    // Gemini's review from ai/rateJob.js, for your top jobs. Kept until you ask for a new one.
    ai: {
      rating: Number, // 1–5
      verdict: { type: String, enum: ['apply', 'maybe', 'skip'] },
      reasons: [String],
      missingSkills: [String],
      redFlags: [String],
      ratedAt: Date,
      model: String,
    },
  },
  { timestamps: true },
);
// One match per user per job, and fast "my feed, newest first" queries.
jobMatchSchema.index({ userId: 1, jobId: 1 }, { unique: true });
jobMatchSchema.index({ userId: 1, status: 1, createdAt: -1 });
jobMatchSchema.index({ userId: 1, status: 1, 'fit.rank': -1 });

export const JobMatch = mongoose.model('JobMatch', jobMatchSchema);
