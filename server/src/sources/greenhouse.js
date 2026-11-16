import { fetchJson } from './fetchJson.js';
import { toJob } from '../jobs/normalize.js';
import { htmlToText } from '../jobs/sanitize.js';

// Public API, no key: https://developers.greenhouse.io/job-board.html
// Greenhouse has no work-mode field, so toJob guesses it from the location text ("Remote - India").
export async function fetchBoard(board) {
  const { jobs } = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  return jobs.map((j) =>
    toJob({
      source: 'greenhouse',
      externalId: j.id,
      title: j.title,
      company: j.company_name || board,
      locations: [j.location?.name],
      url: j.absolute_url,
      text: htmlToText(j.content),
      postedAt: j.first_published || j.updated_at,
    }),
  );
}
