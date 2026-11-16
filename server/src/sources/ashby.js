import { fetchJson } from './fetchJson.js';
import { toJob } from '../jobs/normalize.js';

const MODES = { Remote: 'remote', Hybrid: 'hybrid', OnSite: 'onsite' };
const INTERVALS = { '1 YEAR': 'year', '1 MONTH': 'month', '1 HOUR': 'hour' };

// Ashby lists pay as components (salary, equity, bonus); only the base salary counts here.
const salaryOf = (comp) => {
  const s = comp?.summaryComponents?.find((c) => c.compensationType === 'Salary');
  return s && { min: s.minValue, max: s.maxValue, currency: s.currencyCode, period: INTERVALS[s.interval] };
};

// Public API, no key: https://developers.ashbyhq.com/docs/public-job-posting-api
export async function fetchBoard(board) {
  const { jobs } = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
  return jobs
    .filter((j) => j.isListed !== false)
    .map((j) =>
      toJob({
        source: 'ashby',
        externalId: j.id,
        title: j.title,
        company: board, // the API doesn't return the company name
        locations: [
          j.location,
          ...(j.secondaryLocations ?? []).map((l) => l.location),
          // country names from the structured address, so "Remote (US)" also matches "United States"
          ...[j.address, ...(j.secondaryLocations ?? []).map((l) => l.address)].map((a) => a?.postalAddress?.addressCountry),
        ],
        workMode: MODES[j.workplaceType] ?? (j.isRemote ? 'remote' : undefined),
        url: j.jobUrl,
        applyUrl: j.applyUrl,
        text: j.descriptionPlain,
        postedAt: j.publishedAt,
        salary: salaryOf(j.compensation),
      }),
    );
}
