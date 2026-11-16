import { z } from 'zod';

// Your standard answers for application forms: the things every form asks that a resume doesn't say.
// Filled once on the Apply page; the form filler (apply/fill.js) and the AI use only these and your profile.
const answer = z.string().trim().max(400).optional();
export const ApplyAnswersSchema = z.object({
  noticePeriod: answer, // "30 days", "Immediate"
  currentCtc: answer, // "12 LPA"
  expectedCtc: answer, // "18 LPA"; also used for "salary expectation" questions
  workAuthorization: answer, // "Indian citizen; authorized to work in India; need sponsorship elsewhere"
  needsSponsorship: answer, // "No for India, yes for other countries"
  willingToRelocate: answer, // "Yes, within India"
  earliestStart: answer, // "Within 30 days"
  howDidYouHear: answer, // "Company careers page"
  extra: z.string().trim().max(2000).optional(), // anything else forms ask: languages, preferred pronouns you DO want shared, etc.
});
