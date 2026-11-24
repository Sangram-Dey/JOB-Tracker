import { postJson } from './fetchJson.js';
import { toJob, countryName, countryCode } from '../jobs/normalize.js';

// Naukri and Indeed through Apify: community scrapers ("actors") run on Apify's cloud and return public listings.
// Account safety: no actor here takes cookies, a login or a session, and none touches LinkedIn. Your own Naukri/Indeed
// accounts are never used, and your machine never opens those sites for these jobs (liveness skips source 'apify').
// Needs APIFY_TOKEN. The free plan is $5 a month and stops there (no bill). One run per site a day, 50 jobs each:
// about $0.80 a month. scrape.js also stops at APIFY_MONTHLY_LIMIT calls. Actors chosen 2026-11-20 from their Apify pages.
const NAUKRI = 'blackfalcondata~naukri-jobs-feed'; // ~$0.39 / 1k jobs + $0.001 a run
const INDEED = 'valig~indeed-jobs-scraper'; // ~$0.10 / 1k jobs
const PER_RUN = 50;
export const minGapMs = 24 * 3600_000;
export const monthlyLimit = Number(process.env.APIFY_MONTHLY_LIMIT) || 60;

export function plan(prefs, terms, { callsLeft }) {
  if (!process.env.APIFY_TOKEN || !terms.length) return [];
  const [term] = terms;
  const city = prefs.cities[0];
  const country = countryCode(prefs.countries[0] ?? '') ?? 'in'; // India-first app, as in jsearch.js
  const tasks = [
    {
      label: `Naukri: ${term}${city ? ` in ${city}` : ''}`,
      run: async () =>
        // postedBy 'Company': skips consultancy reposts, which are mostly duplicates or bait listings.
        naukriToJobs(await runActor(NAUKRI, { keyword: term, location: city, freshness: 7, postedBy: 'Company', fetchDetails: true, descriptionFormat: 'text', maxResults: PER_RUN })),
    },
    {
      label: `Indeed: ${term}${city ? ` in ${city}` : ''}`,
      run: async () => indeedToJobs(await runActor(INDEED, { country, title: term, location: city, datePosted: '7', limit: PER_RUN }), city),
    },
  ];
  return tasks.slice(0, Math.max(0, callsLeft));
}

// Runs the actor and waits for its items (Apify allows up to 300 s). Token in a header, so it stays out of URLs and logs.
const runActor = (actor, input) =>
  postJson(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`, input, { Authorization: `Bearer ${process.env.APIFY_TOKEN}` }, 300_000);

// Naukri says "Remote" / "Hybrid" in workModeLabel, or "office" / "remote" in wfhType.
const mode = (...labels) => {
  const m = labels.join(' ').toLowerCase().match(/remote|hybrid|office/)?.[0];
  return m === 'office' ? 'onsite' : m;
};

export function naukriToJobs(items = []) {
  return items
    .filter((j) => j.title && j.portalUrl && !j.consultant) // consultancy posts: reposts of someone else's job
    .map((j) =>
      toJob({
        source: 'apify',
        via: 'Naukri',
        externalId: j.jobId,
        title: j.title,
        company: j.companyName,
        locations: [j.location],
        workMode: mode(j.workModeLabel, j.wfhType),
        url: j.portalUrl,
        // skills go into the text so the fit score sees the stack even when the description doesn't list it
        text: [j.salary && `Salary: ${j.salary}`, j.skills?.length && `Skills: ${j.skills.join(', ')}`, j.description || j.shortDescription]
          .filter(Boolean)
          .join('\n\n'),
        postedAt: j.createdDate,
        experienceMin: Number.isFinite(j.minimumExperience) ? j.minimumExperience : undefined,
        reposted: j.isRepost,
      }),
    );
}

// `searchedCity`: Indeed often leaves the city empty; the job came from a search for that city, so it's there.
export function indeedToJobs(items = [], searchedCity) {
  return items
    .filter((j) => j.title && j.url)
    .map((j) =>
      toJob({
        source: 'apify',
        via: 'Indeed',
        externalId: j.key,
        title: j.title,
        company: j.employer?.name,
        locations: [j.location?.city || searchedCity, j.location?.countryCode && countryName(j.location.countryCode)],
        reposted: j.isRepost,
        url: j.url,
        applyUrl: j.jobUrl,
        text: j.description?.text,
        postedAt: j.datePublished,
        salary: j.baseSalary && { min: j.baseSalary.min, max: j.baseSalary.max, currency: j.baseSalary.currencyCode, period: j.baseSalary.unitOfWork },
      }),
    );
}
