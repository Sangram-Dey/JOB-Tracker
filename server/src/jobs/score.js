import { Profile } from '../models/Profile.js';
import '../models/Job.js'; // registers the Job model that populate('jobId') loads
import { JobMatch } from '../models/JobMatch.js';
import { PreferencesSchema } from '../schemas/preferences.js';

// How well a job fits you, 0–100, from plain rules: free, instant, and the same answer every time.
// It only orders the feed; it never hides a job (a wrong low score costs a scroll, a wrong hide costs a job).
//
//   skills 40 · role 15 · experience 15 · location 15 · freshness 10 · pay 5

const GENERIC = new Set(['html', 'html5', 'css', 'css3', 'sql', 'git', 'rest apis', 'rest', 'postman', 'json', 'agile']);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, word) => new RegExp(`(^|[^a-z0-9])${escape(word)}($|[^a-z0-9])`, 'i').test(text);

// "JavaScript (ES6+)" -> "javascript", "AWS (EC2, S3)" -> "aws"; "Node.js" also matches "nodejs" and "node".
function skillSpellings(skill) {
  const base = skill.replace(/\(.*?\)/g, '').trim().toLowerCase();
  if (!base) return [];
  const forms = [base];
  if (base.endsWith('.js')) forms.push(base.replace('.js', 'js'), base.slice(0, -3));
  return forms;
}

export function yourSkills(profileData) {
  const all = [...(profileData?.skills ?? []), ...(profileData?.projects ?? []).flatMap((p) => p.tech ?? [])];
  const seen = new Map(); // first spelling -> display name
  for (const s of all) {
    const forms = skillSpellings(s);
    if (forms.length && !seen.has(forms[0])) seen.set(forms[0], { name: s.replace(/\(.*?\)/g, '').trim(), forms });
  }
  return [...seen.values()];
}

// "Jul 2023", "2023", "07/2023", "Present" -> a date.
function parseMonth(text, now) {
  if (!text) return undefined;
  if (/present|current|now|till date/i.test(text)) return now;
  const mm = text.match(/(\d{1,2})[/-](\d{4})/);
  if (mm) return new Date(+mm[2], +mm[1] - 1);
  const d = new Date(text);
  return Number.isNaN(+d) ? undefined : d;
}

// Years of experience from the resume: earliest start to latest end. Gaps aren't subtracted, so it can run a bit high.
export function yearsFromResume(profileData, now = new Date()) {
  const spans = (profileData?.experience ?? [])
    .map((e) => [parseMonth(e.startDate, now), parseMonth(e.endDate, now) ?? now])
    .filter(([start]) => start);
  if (!spans.length) return undefined;
  const start = Math.min(...spans.map(([s]) => +s));
  const end = Math.max(...spans.map(([, e]) => +e));
  return Math.round(((end - start) / (365.25 * 86_400_000)) * 10) / 10;
}

// Your years: what you set in Preferences, else what the resume says.
export const yourYears = (prefs, profileData) => prefs.yearsExperience ?? yearsFromResume(profileData);

export function scoreJob(job, { prefs, skills, years, now = Date.now() }) {
  const text = `${job.title}\n${job.description ?? ''}`;

  // Skills: how many of yours the job mentions. Basics almost every web job lists count half, so a Java job
  // doesn't look like a match just for mentioning HTML and SQL. 10 shared skills is a full match.
  const matched = skills.filter((s) => s.forms.some((f) => mentions(text, f)));
  const matchedSkills = matched.map((s) => s.name);
  const weight = matched.reduce((n, s) => n + (GENERIC.has(s.forms[0]) ? 0.5 : 1), 0);
  const skillPts = Math.round(Math.min(1, weight / 10) * 40);

  // Role: your role keywords in the title (one is required to reach the feed; more is a closer match).
  const roleHits = prefs.roles.filter((r) => mentions(job.title.replace(/[-/]/g, ' '), r.replace(/[-/]/g, ' '))).length;
  const rolePts = !prefs.roles.length ? 8 : roleHits >= 2 ? 15 : roleHits === 1 ? 10 : 4;

  // Experience: the job's minimum against yours. Unknown on either side is half points.
  const need = job.experienceMin;
  const expPts = need == null || years == null ? 8 : need <= years ? 15 : need <= years + 1 ? 10 : need <= years + 2 ? 4 : 0;

  // Location: your first city is best, then your other cities, your country, then remote if you want it.
  const where = (job.locations ?? []).join(' | ');
  const cityIndex = prefs.cities.findIndex((c) => mentions(where, c));
  // A remote job limited to another country ("Mexico Remote") is worth less than open or local remote.
  const remoteOpen = /^[s|,;()-]*(remote|anywhere|worldwide|global|work from home)?[s|,;()-]*$/i.test(where) || prefs.countries.some((c) => mentions(where, c));
  const locPts =
    job.workMode === 'remote'
      ? !prefs.workModes.includes('remote') ? 4 : remoteOpen ? 12 : 6
      : cityIndex >= 0
        ? Math.max(9, 15 - cityIndex * 2)
        : prefs.countries.some((c) => mentions(where, c))
          ? 9
          : where ? 3 : 5;

  // Freshness: early applicants get read.
  const ageDays = job.postedAt ? (now - new Date(job.postedAt)) / 86_400_000 : undefined;
  const freshPts = ageDays == null ? 4 : ageDays <= 1 ? 10 : ageDays <= 3 ? 8 : ageDays <= 7 ? 6 : ageDays <= 14 ? 3 : 1;

  // Pay: meets your minimum. Most Indian postings don't state pay, so unknown isn't punished much.
  const lpa = job.salary?.lpa;
  const payPts = lpa == null ? 2 : prefs.minSalaryLpa == null ? 4 : lpa >= prefs.minSalaryLpa ? 5 : 0;

  const parts = { skills: skillPts, role: rolePts, experience: expPts, location: locPts, freshness: freshPts, pay: payPts };
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), parts, matchedSkills };
}

// Order for "Best fit": the rule score moved by the AI's rating (5/5 +20, 3/5 ±0, 1/5 -20) once a review exists.
export const rankOf = (score, ai) => score + (ai?.rating ? (ai.rating - 3) * 10 : 0);

// Re-scores every job in one user's feed. A few hundred jobs take well under a second.
export async function rescoreUser(userId) {
  const profile = await Profile.findOne({ userId });
  if (!profile) return 0;
  const prefs = PreferencesSchema.parse(profile.preferences ?? {});
  const ctx = { prefs, skills: yourSkills(profile.data), years: yourYears(prefs, profile.data) };
  const matches = await JobMatch.find({ userId }, 'jobId ai').populate('jobId', 'title description locations workMode experienceMin postedAt salary');
  const scoredAt = new Date();
  const writes = matches
    .filter((m) => m.jobId)
    .map((m) => {
      const fit = scoreJob(m.jobId, ctx);
      return { updateOne: { filter: { _id: m._id }, update: { $set: { fit: { ...fit, rank: rankOf(fit.score, m.ai), scoredAt } } } } };
    });
  if (writes.length) await JobMatch.bulkWrite(writes, { ordered: false });
  return writes.length;
}
