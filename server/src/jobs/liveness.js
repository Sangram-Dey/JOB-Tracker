import { assertPublicHost, robotsDisallows } from './contacts.js';

// Is a posting still open? Opens the job page once and looks for "no longer available"-type text, like
// career-ops' liveness check. Three answers, never a guess:
//   active  : the page opens and doesn't say it's closed (or a company board API listed it just now)
//   closed  : the page is gone (404/410) or says the job is closed; hidden from your feed
//   unknown : blocked, timed out, or robots.txt asks bots not to open it; still shown

// Company board APIs only return open jobs, so their listings are live by definition. Apify jobs were just scraped
// as open, and skipping them means this server never opens naukri.com / indeed.com pages for them.
const LIVE_BY_API = new Set(['greenhouse', 'lever', 'ashby', 'apify']);

const CLOSED = [
  /\bjob (?:is )?no longer (?:available|open|active)\b/i,
  /\bno longer accepting (?:applications|candidates)\b/i,
  /\b(?:position|role|job|vacancy|opening|requisition) (?:has been|is) (?:filled|closed)\b(?!\s+out)/i,
  /\b(?:this )?job (?:posting |listing )?has (?:expired|been (?:removed|closed|deleted))\b/i,
  /\bthis (?:position|role|job|posting|vacancy) is no longer\b/i,
  /\bjob you are (?:looking for|trying to (?:view|apply)) (?:is|was) (?:no longer|not) (?:available|found)\b/i,
  /\bapplications? (?:for this (?:job|role|position) )?(?:are|is) (?:now )?closed\b/i,
];

export function closedReason(status, text = '') {
  if (status === 404 || status === 410) return `The job page is gone (${status})`;
  const plain = text.replace(/[‘’]/g, "'");
  return CLOSED.some((re) => re.test(plain)) ? 'The job page says it is closed' : undefined;
}

const robotsCache = new Map(); // origin -> Disallow rules, for this server's lifetime
const result = (status, reason) => ({ status, reason, checkedAt: new Date() });

export async function checkLiveness(job) {
  if (LIVE_BY_API.has(job.source)) return result('active', 'Listed by the company job board just now');
  try {
    const url = new URL(job.url);
    if (!/^https?:$/.test(url.protocol)) return result('unknown', 'Not a web link');
    await assertPublicHost(url.hostname); // job links come from outside: never let one point into your network
    if (!robotsCache.has(url.origin)) robotsCache.set(url.origin, await robotsDisallows(url.origin));
    if (robotsCache.get(url.origin).some((rule) => url.pathname.startsWith(rule))) return result('unknown', "The site's robots.txt asks bots not to open job pages");

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'job-tracker (personal job search; checks postings are still open)' } });
    const text = res.ok ? (await res.text()).slice(0, 500_000) : '';
    const closed = closedReason(res.status, text);
    if (closed) return result('closed', closed);
    if (res.ok) return result('active', "The job page opens and doesn't say it's closed");
    return result('unknown', `The site answered ${res.status}`);
  } catch {
    return result('unknown', 'Could not open the job page');
  }
}

// Checks several jobs, a few at a time, so one slow site doesn't hold up the rest.
export async function checkMany(jobs, concurrency = 6) {
  const out = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    out.push(...(await Promise.all(batch.map(async (job) => ({ _id: job._id, liveness: await checkLiveness(job) })))));
  }
  return out;
}
