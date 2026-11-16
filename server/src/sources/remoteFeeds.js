// Four free remote-job feeds. They only list remote jobs, so they're skipped unless you picked Remote.
// Their terms ask for a link back: every job keeps its URL on their site, and the card shows "via <site>".
import { fetchJson, fetchText } from './fetchJson.js';
import { toJob } from '../jobs/normalize.js';
import { htmlToText } from '../jobs/sanitize.js';

const remote = (prefs) => prefs.workModes.includes('remote');

// remotive.com: one call for the whole software-dev category; matching filters it. They ask for only a few calls a day.
export const remotive = {
  minGapMs: 3600_000, // at most once an hour, however often you click Search now
  plan: (prefs) => (remote(prefs) ? [{ label: 'software-dev', run: fetchRemotive }] : []),
};
async function fetchRemotive() {
  const { jobs } = await fetchJson('https://remotive.com/api/remote-jobs?category=software-dev');
  return jobs.map((j) =>
    toJob({
      source: 'remotive',
      externalId: j.id,
      title: j.title,
      company: j.company_name,
      locations: [j.candidate_required_location], // e.g. "Worldwide", "USA, Canada"
      workMode: 'remote',
      url: j.url,
      // their salary is free text ("$3.5k–$5k/month"); putting it in the description lets the text parser read it
      text: [j.salary && `Salary: ${j.salary}`, htmlToText(j.description)].filter(Boolean).join('\n\n'),
      postedAt: j.publication_date,
    }),
  );
}

// remoteok.com: the API returns the latest ~100 jobs; the first array item is their legal notice.
export const remoteok = {
  plan: (prefs) => (remote(prefs) ? [{ label: 'latest', run: fetchRemoteOk }] : []),
};
async function fetchRemoteOk() {
  const [, ...jobs] = await fetchJson('https://remoteok.com/api');
  return jobs.map((j) =>
    toJob({
      source: 'remoteok',
      externalId: j.id,
      title: j.position,
      company: j.company,
      locations: [j.location],
      workMode: 'remote',
      url: j.url,
      text: htmlToText(j.description),
      postedAt: j.date,
      salary: { min: j.salary_min, max: j.salary_max, currency: 'USD' }, // often junk; normalizeSalary drops implausible values
    }),
  );
}

// himalayas.app: a search endpoint, 20 results per page. One call per search term (max 3).
export const himalayas = {
  plan: (prefs, terms) =>
    remote(prefs) ? terms.slice(0, 3).map((term) => ({ label: term, run: () => fetchHimalayas(term) })) : [],
};
async function fetchHimalayas(term) {
  const { jobs } = await fetchJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}`);
  return jobs.map((j) =>
    toJob({
      source: 'himalayas',
      externalId: j.guid,
      title: j.title,
      company: j.companyName,
      // countries the job is open to; empty means anywhere
      locations: j.locationRestrictions?.length ? j.locationRestrictions : ['Worldwide'],
      workMode: 'remote',
      url: j.applicationLink || j.guid,
      text: htmlToText(j.description),
      postedAt: j.pubDate ? j.pubDate * 1000 : undefined,
      salary: { min: j.minSalary, max: j.maxSalary, currency: j.currency, period: j.salaryPeriod },
    }),
  );
}

// weworkremotely.com: an RSS feed (XML), so we read the few tags we need from each <item>.
export const weworkremotely = {
  plan: (prefs) => (remote(prefs) ? [{ label: 'programming', run: fetchWwr }] : []),
};
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() ?? '';
export async function fetchWwr() {
  const xml = await fetchText('https://weworkremotely.com/categories/remote-programming-jobs.rss');
  return parseWwr(xml);
}
export function parseWwr(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const [company, ...rest] = htmlToText(tag(item, 'title')).split(': '); // titles look like "Acme: Senior Node Developer"
    return toJob({
      source: 'weworkremotely',
      externalId: tag(item, 'guid') || tag(item, 'link'),
      title: rest.join(': ') || company,
      company: rest.length ? company : '',
      locations: [htmlToText(tag(item, 'region'))], // e.g. "Anywhere in the World"
      workMode: 'remote',
      url: tag(item, 'link'),
      text: htmlToText(tag(item, 'description')),
      postedAt: tag(item, 'pubDate') || undefined,
    });
  });
}
