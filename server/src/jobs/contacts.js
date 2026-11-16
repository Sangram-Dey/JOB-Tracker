import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { httpError } from '../utils/httpError.js';
import { htmlToText } from './sanitize.js';

// Finds hiring contact emails for a job, from two places:
//   1. the job description itself ("send your resume to hr@acme.com"): the poster put them there for applicants
//   2. the company's own website (home, careers, contact pages), keeping only role addresses like hr@ or careers@.
// Personal addresses (firstname.lastname@) found on websites are skipped on purpose: we don't harvest people's emails.

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const HIRING = /^(hr|careers?|jobs?|recruit\w*|talent\w*|hiring|people|humanresources|resumes?|cv|apply|joinus|join)([._-]?[a-z]*)?$/i;
const GENERAL = /^(info|contact|hello|enquir(y|ies)|inquir(y|ies)|support|admin|office)([._-]?[a-z]*)?$/i;
const JUNK = /\.(png|jpe?g|gif|svg|webp)$|@(example|sentry|wixpress|domain|email)\./i;

// Hosts that are job sites, ATSs or social networks, never the company's own website.
const NOT_COMPANY = new RegExp(
  '(^|\\.)(naukri|lever|greenhouse|ashbyhq|myworkdayjobs|workday|smartrecruiters|workable|freshteam|zohorecruit|zoho|keka|darwinbox|' +
    'cutshort|instahyre|hirist|shine|foundit|timesjobs|indeed|glassdoor|linkedin|arc|himalayas|remotive|remoteok|weworkremotely|' +
    'breezy|jazzhr|applytojob|comeet|radancy|eightfold|icims|taleo|oraclecloud|successfactors|bamboohr|recruitee|teamtailor|' +
    'personio|jobvite|freehire|wellfound|jobgether|turing|manatal|google|facebook|twitter|x|instagram|youtube|github|medium|bit|t)\\.[a-z.]+$',
  'i',
);

const emailsIn = (text) => [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()).filter((e) => !JUNK.test(e)))];
const kindOf = (email) => (HIRING.test(email.split('@')[0]) ? 'hiring' : GENERAL.test(email.split('@')[0]) ? 'general' : 'personal');
const baseDomain = (host) => host.replace(/^www\./, '').toLowerCase();

// Phone numbers: Indian mobiles (98765 43210, +91-98765-43210) and international numbers written with a +.
// No digit may touch either end, so order IDs and years aren't read as phones.
const PHONE = /(?<![\d+])(?:(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}|\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,3})(?!\d)/g;
const last10 = (phone) => phone.replace(/\D/g, '').slice(-10);
export function phonesIn(text) {
  const seen = new Map(); // last 10 digits -> as written
  for (const raw of text.match(PHONE) ?? []) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15 && !seen.has(last10(raw))) seen.set(last10(raw), raw.trim());
  }
  return [...seen.values()];
}

// A website a source gave for the employer, if it really is the company's own (not LinkedIn or a job board).
function companySite(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) && !NOT_COMPANY.test(hostname) ? `${protocol}//${hostname}` : undefined;
  } catch {
    return undefined;
  }
}

// The company website: one you typed, else a link in the job (or the job URL) whose domain carries the
// company's name ("earnix" -> earnix.com) and isn't a job site. Without the name check, other job boards slip in.
export function guessWebsite(job) {
  const name = (job.company ?? '').toLowerCase().match(/[a-z0-9]{3,}/)?.[0];
  if (!name) return undefined;
  const urls = [...(job.description ?? '').matchAll(/https?:\/\/[^\s)"'<>]+/g)].map((m) => m[0]).concat(job.url ?? []);
  for (const u of urls) {
    try {
      const { protocol, hostname } = new URL(u);
      if (/^https?:$/.test(protocol) && !NOT_COMPANY.test(hostname) && hostname.replace(/[.-]/g, '').includes(name)) return `${protocol}//${hostname}`;
    } catch {}
  }
  return undefined;
}

// The server fetches a URL you can type, so refuse anything that points inside your own network.
// shortcut: checks the first DNS answer only, not redirects or DNS rebinding; fine for a one-user app, harden before multi-user.
export async function assertPublicHost(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw httpError(400, 'That website is not allowed');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true }).catch(() => {
    throw httpError(400, 'Could not find that website');
  });
  const isPrivate = (a) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80)/i.test(a);
  if (addresses.some(({ address }) => isPrivate(address))) throw httpError(400, 'That website is not allowed');
}

const UA = 'job-tracker (personal job search; finds published hiring contacts)';
async function getText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok || !/text\/(html|plain)/.test(res.headers.get('content-type') ?? '')) return null;
    return { url: res.url, text: (await res.text()).slice(0, 2_000_000) };
  } catch {
    return null;
  }
}

// Minimal robots.txt check: the "User-agent: *" group's Disallow prefixes.
// shortcut: ignores Allow lines and wildcards; a site that relies on those may get one page more or less.
export async function robotsDisallows(origin) {
  const robots = await getText(`${origin}/robots.txt`);
  if (!robots) return [];
  const rules = [];
  let forAll = false;
  for (const line of robots.text.split('\n')) {
    const [key, ...rest] = line.split('#')[0].split(':');
    const value = rest.join(':').trim();
    if (/^user-agent$/i.test(key.trim())) forAll = value === '*';
    else if (forAll && /^disallow$/i.test(key.trim()) && value) rules.push(value);
  }
  return rules;
}

// Emails and phones the poster put in the job description: no web requests, so it runs on every job.
export function fromDescription(job) {
  const text = job.description ?? '';
  return {
    emails: emailsIn(text).map((email) => ({ email, kind: kindOf(email), foundOn: 'job description' })),
    phones: phonesIn(text).map((phone) => ({ phone, foundOn: 'job description' })),
  };
}

// No website known: try <name>.com / .in / .io and keep the first whose page title carries the company's name.
// shortcut: name-based guess; a company whose domain differs from its name ("Meta" -> meta.com is fine,
// "Tata Consultancy" -> tcs.com is missed) needs Hunter or a typed website.
async function probeWebsite(company) {
  const words = String(company ?? '').toLowerCase().replace(/\b(private|pvt|limited|ltd|inc|llc|llp|technologies|technology|solutions|labs|software)\b|[^a-z0-9 ]/g, '').trim();
  const name = words.replace(/\s+/g, '');
  if (name.length < 3 || name.length > 30) return undefined;
  for (const tld of ['com', 'in', 'io']) {
    const origin = `https://${name}.${tld}`;
    try {
      await assertPublicHost(`${name}.${tld}`);
    } catch {
      continue; // no such domain
    }
    const page = await getText(origin);
    const title = page?.text.match(/<title[^>]*>([^<]*)/i)?.[1]?.toLowerCase() ?? '';
    if (title.includes(words.split(' ')[0])) return origin;
  }
  return undefined;
}

export async function findContacts(job, website) {
  const own = fromDescription(job);
  const emails = new Map(own.emails.map((e) => [e.email, e])); // email -> { email, kind, foundOn }
  const phones = new Map(); // last 10 digits -> { phone, foundOn }
  const addPhones = (list, foundOn) => list.forEach((phone) => phones.has(last10(phone)) || phones.set(last10(phone), { phone, foundOn }));
  addPhones(own.phones.map((p) => p.phone), 'job description');

  website ??= companySite(job.website) ?? guessWebsite(job) ?? (await probeWebsite(job.company));
  let note;
  if (!website) note = 'Company website not found in the job; type it in to search it.';
  else {
    const { protocol, hostname } = new URL(website);
    await assertPublicHost(hostname);
    const origin = `${protocol}//${hostname}`;
    const disallowed = await robotsDisallows(origin);
    const allowed = (path) => !disallowed.some((rule) => path.startsWith(rule));

    // Home page first; it also gives us the real links to careers / contact pages.
    const pages = ['/', '/careers', '/contact', '/contact-us', '/about'];
    const home = allowed('/') ? await getText(origin) : null;
    if (home) {
      for (const [, href] of home.text.matchAll(/href=["']([^"'#]+)["']/gi)) {
        try {
          const u = new URL(href, home.url);
          if (baseDomain(u.hostname) === baseDomain(new URL(home.url).hostname) && /career|contact|jobs|join|hiring/i.test(u.pathname)) pages.push(u.pathname);
        } catch {}
      }
    }
    const site = baseDomain(new URL(home?.url ?? origin).hostname);
    const visited = new Set(['/']);
    const toVisit = [...new Set(pages)].filter((p) => !visited.has(p) && allowed(p)).slice(0, 6);
    const fetched = [home, ...(await Promise.all(toVisit.map((p) => getText(origin + p))))].filter(Boolean);

    for (const page of fetched) {
      const text = page.text.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, '@'); // simple obfuscations
      for (const email of emailsIn(text + ' ' + htmlToText(text))) {
        const kind = kindOf(email);
        // Only addresses on the company's own domain, and never personal ones.
        if (kind === 'personal' || !email.endsWith('@' + site) && !email.endsWith('.' + site)) continue;
        if (!emails.has(email)) emails.set(email, { email, kind, foundOn: page.url });
      }
      // Phones only where a company shows them on purpose: tel: links, or numbers on a contact page.
      addPhones([...page.text.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1])), page.url);
      if (/contact/i.test(new URL(page.url).pathname)) addPhones(phonesIn(htmlToText(page.text)), page.url);
    }
    if (!fetched.length) note = 'Could not open the company website (or robots.txt blocks it).';
    website = origin;
  }

  const order = { hiring: 0, general: 1, personal: 2 };
  return { website, emails: [...emails.values()].sort((a, b) => order[a.kind] - order[b.kind]), phones: [...phones.values()], note, checkedAt: new Date() };
}
