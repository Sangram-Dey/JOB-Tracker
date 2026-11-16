import { fetchJson } from './fetchJson.js';
import { toJob, countryName, countryCode } from '../jobs/normalize.js';

// JSearch (RapidAPI) searches Google for Jobs, which lists jobs from LinkedIn, Indeed, Glassdoor, Shine, Foundit
// and company sites. That's how we get those sites' jobs without scraping them.
// Needs JSEARCH_API_KEY. The free plan is 200 requests a month: at most 2 calls every 12 hours here (~120 a month),
// and scrape.js stops at JSEARCH_MONTHLY_LIMIT. Endpoint and fields checked against the live API on 2026-11-13.
const MAX_CALLS_PER_RUN = 2;
export const minGapMs = 12 * 3600_000;

export function plan(prefs, terms, { callsLeft }) {
  if (!process.env.JSEARCH_API_KEY || !terms.length) return [];
  const term = terms[0];
  // JSearch assumes the US unless told otherwise. A country you listed sets it; for cities, your first country does.
  // shortcut: falls back to India when no country is listed (this is an India-first app); add a setting if that changes.
  const home = countryCode(prefs.countries[0] ?? '') ?? 'in';
  const queries = [
    ...prefs.cities.map((city) => ({ label: `${term} in ${city}`, query: `${term} in ${city}`, country: home })),
    ...prefs.countries.map((c) => ({ label: `${term} in ${c}`, query: `${term} in ${c}`, country: countryCode(c) ?? home })),
    ...(prefs.workModes.includes('remote') ? [{ label: `${term}, remote`, query: `${term} remote`, country: home, remote: true }] : []),
  ];
  if (!queries.length) queries.push({ label: term, query: term, country: home });
  return queries.slice(0, Math.min(MAX_CALLS_PER_RUN, callsLeft)).map((q) => ({ label: q.label, run: () => search(q) }));
}

async function search({ query, country, remote }) {
  const params = new URLSearchParams({ query, page: '1', num_pages: '1', date_posted: 'week', country });
  if (remote) params.set('work_from_home', 'true');
  const body = await fetchJson(`https://jsearch.p.rapidapi.com/search-v2?${params}`, {
    'x-rapidapi-key': process.env.JSEARCH_API_KEY,
    'x-rapidapi-host': 'jsearch.p.rapidapi.com',
  });
  return toJobs(body);
}

// search-v2 answers { data: { jobs: [...], cursor } }.
export function toJobs(body) {
  return (body.data?.jobs ?? []).map((j) =>
    toJob({
      source: 'jsearch',
      via: j.job_publisher, // "LinkedIn", "Shine", "Indeed", …
      externalId: j.job_id,
      title: j.job_title,
      company: j.employer_name,
      locations: [[j.job_city, j.job_state].filter(Boolean).join(', '), countryName(j.job_country), j.job_location],
      workMode: j.job_is_remote ? 'remote' : undefined,
      url: j.job_apply_link,
      // pay comes as text ("₹6L–₹12L a year") with no currency field, so the description's pay parser reads it
      text: [j.job_salary_string && `Salary: ${j.job_salary_string}`, j.job_description].filter(Boolean).join('\n\n'),
      postedAt: j.job_posted_at_datetime_utc,
      website: j.employer_website,
    }),
  );
}
