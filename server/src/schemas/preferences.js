import { z } from 'zod';

// Text lists from the UI, one per line or comma-separated ("mern, node" is two items). Trimmed, empties dropped.
const list = z
  .array(z.string())
  .transform((items) => items.flatMap((item) => item.split(',')).map((s) => s.trim()).filter(Boolean))
  .default([]);
// Board names go into an API URL, so only allow characters a board slug can have.
const boards = z
  .array(z.string().trim().regex(/^[\w.-]*$/, 'Board names are letters, numbers, - . _'))
  .transform((b) => b.filter(Boolean))
  .default([]);
const on = z.boolean().default(true);

// What jobs you want. Stored in profiles.preferences, next to the resume (profiles.data).
// Every field has a default, so preferences saved before a field existed still parse.
export const PreferencesSchema = z.object({
  // Search words for job sites (required for them), and a job title must contain one (case-insensitive).
  roles: list,
  workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).min(1, 'Pick at least one work mode').default(['remote', 'hybrid', 'onsite']),
  // Remote jobs: "anywhere" keeps every remote job; "myCountries" keeps remote jobs open to one of your countries.
  remoteScope: z.enum(['anywhere', 'myCountries']).default('anywhere'),
  cities: list,
  countries: list,
  // Drop jobs whose title contains any of these (e.g. "senior", "intern").
  excludeKeywords: list,
  // Company job boards to check, by board name: boards.greenhouse.io/<name>, jobs.lever.co/<name>, jobs.ashbyhq.com/<name>
  companies: z.object({ greenhouse: boards, lever: boards, ashby: boards }).prefault({}),
  // Job sites searched with your role words. JSearch also needs JSEARCH_API_KEY in server/.env.
  sources: z
    .object({ freehire: on, remotive: on, remoteok: on, himalayas: on, weworkremotely: on, jsearch: on, apify: on })
    .prefault({}),

  // Feed filters, applied when the feed is shown (routes/jobs.js), so a change shows at once and nothing is deleted.
  // Jobs that don't say their pay, years or date are kept: most Indian postings don't state pay.
  minSalaryLpa: z.number().min(0).max(1000).nullable().default(null), // lakhs of rupees a year
  yearsExperience: z.number().min(0).max(50).nullable().default(null), // yours; jobs asking more than this + 1 are hidden
  maxAgeDays: z.number().int().min(1).max(90).default(30),
  // A short email to yourself each morning: replies, ready emails and applications, new jobs.
  dailySummaryEmail: on,
  // HR emails and auto-apply send a copy of your resume tailored to each job (resume/tailorJob.js).
  tailorResume: on,
  platforms: z.array(z.string().regex(/^[a-z0-9]+$/)).default([]), // naukri, indeed, lever…; empty = every platform
});

export const DEFAULT_PREFERENCES = PreferencesSchema.parse({});
