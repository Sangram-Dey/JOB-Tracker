import { httpError } from '../utils/httpError.js';

// Identify ourselves honestly; some feeds reject requests with no User-Agent.
const UA = 'job-tracker (personal job search)';

// GET a public API or feed. A 404 means a wrong board name, which the run log shows next to that source.
export async function fetchText(url, headers = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': UA, ...headers } });
  if (res.status === 404) throw httpError(404, 'Not found: check the name');
  if (res.status === 429) throw httpError(429, 'Rate limited by this source; it will be retried next run');
  if (!res.ok) throw httpError(502, `Source answered ${res.status}`);
  return res.text();
}

export const fetchJson = async (url, headers) => JSON.parse(await fetchText(url, { Accept: 'application/json', ...headers }));
