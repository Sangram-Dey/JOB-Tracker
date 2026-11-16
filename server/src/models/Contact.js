import mongoose from 'mongoose';

// A hiring contact in your list: found in a job post, on a company's site, by Hunter.io, or added by you.
// Per user, so your manual contacts and outreach history stay yours.
const contactSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    company: { type: String, required: true },
    domain: String, // company website domain, e.g. acme.com
    name: String, // a person's name when known (Hunter or manual); empty for role addresses like hr@
    position: String, // their position, e.g. "Talent Acquisition Lead"
    email: String,
    phone: String,
    kind: { type: String, enum: ['role', 'person'], default: 'role' }, // hr@acme.com vs priya@acme.com
    source: { type: String, enum: ['job post', 'company site', 'hunter', 'manual'], required: true },
    foundOn: String, // the page it was found on, so you can see why it's trusted
    confidence: Number, // Hunter's 0-100
    verified: String, // Hunter's verification: valid | accept_all | unknown | invalid
    jobIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Job' }], // jobs this contact is for
    jobTitle: String, // for manual contacts: the role you're applying for
    lastContactedAt: Date,
  },
  { timestamps: true },
);
// One contact per email per user (phone-only contacts are allowed, and skipped by the index).
contactSchema.index({ userId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });

// Can this contact receive an application email? Hunter guesses must be verified or high-confidence, to avoid bounces
// that hurt your Gmail's reputation.
contactSchema.virtual('sendable').get(function () {
  if (!this.email) return false;
  if (this.source !== 'hunter') return true;
  return this.verified === 'valid' || (this.confidence ?? 0) >= 80;
});
contactSchema.set('toJSON', { virtuals: true });

export const Contact = mongoose.model('Contact', contactSchema);
