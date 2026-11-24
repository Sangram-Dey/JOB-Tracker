import mongoose from 'mongoose';

// A log of each search run, so you can see what happened (and which board failed).
const scrapeRunSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    trigger: { type: String, enum: ['manual', 'schedule', 'auto'], required: true },
    finishedAt: Date,
    terms: [String], // the role words searched
    termsFrom: { type: String, enum: ['preferences', 'profile'] }, // profile = none set in Preferences, taken from your resume
    // One entry per API call: a company board ({ source: 'lever', board: 'spotify' }) or a site search
    // ({ source: 'freehire', board: 'in Bengaluru, India' }), with how many jobs came back and were kept.
    boards: [{ _id: false, source: String, board: String, fetched: Number, kept: Number, error: String }],
    // not called this time: checked within the hour (until = next allowed), or its monthly budget is used
    skipped: [{ _id: false, source: String, board: String, until: Date, reason: String }],
    newJobs: { type: Number, default: 0 }, // jobs never seen before by anyone
    newMatches: { type: Number, default: 0 }, // jobs newly added to your feed
    liveness: { checked: Number, closed: Number }, // still-open checks done in this run
  },
  { timestamps: true },
);
// TTL index: MongoDB deletes runs 30 days after they were created.
scrapeRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const ScrapeRun = mongoose.model('ScrapeRun', scrapeRunSchema);
