import mongoose from 'mongoose';

// One document per real job, shared by all users (no userId). Your personal state lives in JobMatch.
const jobSchema = new mongoose.Schema(
  {
    // sha1 of company + title: the same job from two sources gets the same key, and the
    // unique index makes the second insert a no-op. This is the deduplication.
    dedupeKey: { type: String, required: true, unique: true },
    source: { type: String, required: true }, // greenhouse | lever | ashby | freehire | remotive | remoteok | himalayas | weworkremotely | jsearch
    via: String, // the original site when the source is an aggregator, e.g. "naukri", "Indeed"
    externalId: { type: String, required: true }, // the job's id on that source
    title: { type: String, required: true },
    company: { type: String, required: true },
    locations: [String], // as the source wrote them, e.g. "Remote (Canada)", "Bengaluru, India"
    workMode: { type: String, enum: ['remote', 'hybrid', 'onsite', 'unknown'], required: true },
    url: String, // job page
    applyUrl: String,
    description: String, // plain text, cleaned by sanitize.js
    flags: [String], // suspicious lines found by sanitize.js (possible prompt injection)
    postedAt: Date,
    website: String, // the employer's own website, when the source gives it
    // From jobs/extract.js. Refreshed on every search (see scrape.js), unlike the fields above.
    platform: { type: String, index: true }, // where the job really is: naukri, indeed, lever, remoteok…
    salary: {
      min: Number, // yearly, in `currency`
      max: Number,
      currency: String,
      lpa: Number, // upper end in lakhs of rupees a year, for sorting and filtering across currencies
      fromText: Boolean, // read from the description rather than given by the source
    },
    experienceMin: Number, // lowest years of experience the description asks for
    reposted: Boolean, // the source says this opening was listed again (possible ghost job)
    junk: [String], // reasons from junkReasons(); any reason hides the job from the feed
    // Is the posting still open? Checked by jobs/liveness.js when the job is first found, and again after 3 days.
    liveness: { status: { type: String, enum: ['active', 'closed', 'unknown'] }, reason: String, checkedAt: Date },
    // Hiring contacts, found on demand by jobs/contacts.js (job description + the company's own website).
    requirements: Object, // what the posting asks for (ai/atsAi.js), read once for the ATS check
    contacts: {
      website: String,
      emails: [{ _id: false, email: String, kind: { type: String, enum: ['hiring', 'general', 'personal'] }, foundOn: String }],
      phones: [{ _id: false, phone: String, foundOn: String }],
      note: String,
      checkedAt: Date,
    },
  },
  { timestamps: true },
);

export const Job = mongoose.model('Job', jobSchema);
