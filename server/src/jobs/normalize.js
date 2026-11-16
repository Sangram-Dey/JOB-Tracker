import { createHash } from 'node:crypto';
import { sanitizeDescription } from './sanitize.js';
import { normalizeSalary, parseSalaryText, parseYears, platformOf, junkReasons } from './extract.js';

// Every source turns its own format into this one shape (the Job model), so the rest of the code
// never cares where a job came from.
export function toJob({ source, via, externalId, title, company, locations, workMode, url, applyUrl, text, postedAt, salary, experienceMin, reposted, website }) {
  locations = [...new Set(locations.map((l) => l?.trim()).filter(Boolean))];
  title = title.trim();
  company = company?.trim() || 'Unknown company';
  const { description, flags } = sanitizeDescription(text);
  const platform = platformOf(source, via);
  return {
    dedupeKey: dedupeKey(company, title),
    source,
    via, // the site the source got it from, e.g. freehire -> "naukri", JSearch -> "Indeed"
    platform,
    junk: junkReasons({ title, company, description, platform, source }),
    // The source's own numbers when it has them, else whatever the description says.
    salary: (salary && normalizeSalary(salary)) ?? parseSalaryText(description),
    experienceMin: experienceMin ?? parseYears(description),
    reposted: Boolean(reposted),
    externalId: String(externalId),
    website: website || undefined, // the employer's own site, when the source knows it (JSearch does)
    title,
    company,
    locations,
    workMode: workMode ?? detectWorkMode(locations.join(' ')),
    url,
    applyUrl: applyUrl ?? url,
    description,
    flags,
    postedAt: postedAt ? new Date(postedAt) : undefined,
  };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Legal suffixes differ between sites ("Acme Pvt Ltd" on Naukri, "Acme" on Lever), so drop them.
const LEGAL = /\b(private|pvt|limited|ltd|inc|llc|llp|corp|corporation|co|gmbh|plc)\b/g;
// "Acme Pvt. Ltd." and "ACME" -> "acme": also links HR contacts to the same company's jobs.
export const companyKey = (company) => norm(company ?? '').replace(LEGAL, '').replace(/\s+/g, ' ').trim();
// Company + title, like the reference repo's job_key: the same job arrives from several sites with
// differently written locations, so location is left out.
export const dedupeKey = (company, title) => createHash('sha1').update(`${companyKey(company)}|${norm(title)}`).digest('hex');

// For sources that only give a location string ("Remote - India", "Hybrid, Pune").
export function detectWorkMode(text) {
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\bremote\b|work from home|\bwfh\b|anywhere/i.test(text)) return 'remote';
  if (/\bon-?site\b|\bin[- ]office\b/i.test(text)) return 'onsite';
  return 'unknown';
}

// "US" -> "United States", so country codes match the country names you type.
const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code) => {
  try {
    return code ? regionName.of(code.toUpperCase()) : undefined;
  } catch {
    return code;
  }
};

// "India" -> "in": the reverse, for APIs that filter by ISO country code. Built once from the same names.
const CODES = new Map();
for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const name = regionName.of(a + b);
    if (name !== a + b) CODES.set(name.toLowerCase(), (a + b).toLowerCase());
  }
}
CODES.set('usa', 'us').set('uk', 'gb');
export const countryCode = (name) => CODES.get(name.trim().toLowerCase());
