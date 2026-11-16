import { fetchJson } from './fetchJson.js';
import { toJob, countryName } from '../jobs/normalize.js';
import { htmlToText } from '../jobs/sanitize.js';

const MODES = { remote: 'remote', hybrid: 'hybrid', 'on-site': 'onsite' }; // anything else ("unspecified") -> guessed from text

// Public API, no key: https://github.com/lever/postings-api
export async function fetchBoard(board) {
  const postings = await fetchJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
  return postings.map((p) =>
    toJob({
      source: 'lever',
      externalId: p.id,
      title: p.text,
      company: board, // Lever's API doesn't return the company name
      // country is a code ("US"); add its name so "United States" in your preferences matches
      locations: [...(p.categories?.allLocations ?? [p.categories?.location]), countryName(p.country)],
      workMode: MODES[p.workplaceType],
      url: p.hostedUrl,
      applyUrl: p.applyUrl,
      text: [p.descriptionPlain, ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), p.additionalPlain].join('\n\n'),
      postedAt: p.createdAt,
    }),
  );
}
