import { httpError } from '../utils/httpError.js';

// Identify ourselves honestly; some feeds reject requests with no User-Agent.
const UA = 'job-tracker (personal job search)';

// GET (or POST, via `init`) a public API or feed. A 404 means a wrong board name, which the run log shows next to that source.
export async function fetchText(url, headers = {}, { timeoutMs = 30_000, ...init } = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, ...headers } });
  if (res.status === 404) throw httpError(404, 'Not found: check the name');
  if (res.status === 402) throw httpError(402, 'Free credit used up for this month; it resets next month');
  if (res.status === 429) throw httpError(429, 'Rate limited by this source; it will be retried next run');
  if (!res.ok) throw httpError(502, `Source answered ${res.status}`);
  return res.text();
}

export const fetchJson = async (url, headers) => JSON.parse(await fetchText(url, { Accept: 'application/json', ...headers }));

export const postJson = async (url, body, headers, timeoutMs) =>
  JSON.parse(
    await fetchText(url, { Accept: 'application/json', 'Content-Type': 'application/json', ...headers }, { method: 'POST', body: JSON.stringify(body), timeoutMs }),
  );
