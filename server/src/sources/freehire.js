import { fetchJson } from './fetchJson.js';
import { toJob, countryCode } from '../jobs/normalize.js';

// freehire.me: a free public API (no key) that aggregates Naukri, Shine, Hirist, Instahyre, Cutshort,
// Arc, Workday, Lever and more, with country / city / work-mode filters. API notes taken from the
// reference repo's .agents/skills/freehire-search/url-reference.md.
const BASE = 'https://freehire.me/api/v1/agent/jobs/search';
export const minGapMs = 3600_000; // a free API: at most once an hour per user
const MODES = { remote: 'remote', hybrid: 'hybrid', onsite: 'onsite' };

// Which calls to make for these preferences. Each call is one { label, run } task.
export function plan(prefs, terms) {
  const query = new URLSearchParams({ q: terms.slice(0, 5).join(' OR '), limit: '100', posted_within_days: '14', description_format: 'text' });
  const call = (label, extra) => {
    const p = new URLSearchParams(query);
    for (const [key, values] of extra) for (const v of values) p.append(key, v);
    return { label, run: () => search(p) };
  };

  const countries = prefs.countries.map(countryCode).filter(Boolean);
  const hasPlaces = countries.length || prefs.cities.length;
  const tasks = [];
  if (!hasPlaces) return [call('everywhere', [['work_mode', prefs.workModes]])];

  // Your places, in every mode you picked. (Geography filters OR together on freehire's side.)
  tasks.push(call(`in ${[...prefs.cities, ...prefs.countries].join(', ')}`, [['countries', countries], ['cities', prefs.cities], ['work_mode', prefs.workModes]]));
  // Remote from anywhere needs a second call without the place filter.
  if (prefs.workModes.includes('remote') && prefs.remoteScope === 'anywhere') tasks.push(call('remote, anywhere', [['work_mode', ['remote']]]));
  return tasks;
}

async function search(params) {
  const { data } = await fetchJson(`${BASE}?${params}`);
  return data
    .filter((j) => !j.closed_at)
    .map((j) =>
      toJob({
        source: 'freehire',
        via: j.source, // naukri, shine, hirist, …
        externalId: j.public_slug,
        title: j.title,
        company: j.company,
        locations: [j.location, ...(j.cities ?? [])],
        workMode: MODES[j.work_mode],
        url: j.url, // the original posting (Naukri, the company ATS, …)
        text: j.description,
        postedAt: j.posted_at,
        salary: { min: j.enrichment?.salary_min, max: j.enrichment?.salary_max, currency: j.enrichment?.salary_currency, period: j.enrichment?.salary_period },
        experienceMin: j.enrichment?.experience_years_min ?? undefined,
        // freehire tracks re-listings and "bumped to look new" postings
        reposted: j.reality?.repost_count > 1 || j.reality?.fake_freshness,
      }),
    );
}
