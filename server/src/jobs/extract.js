// Pay, years of experience and platform for a job. Rules only, no AI, so every search stays free.

// Rough INR per unit, only to compare and sort pay across currencies.
// shortcut: fixed rates (late 2026); switch to a rates API if exact conversions start to matter.
const INR_PER = { INR: 1, USD: 88, EUR: 96, GBP: 112, CAD: 63, AUD: 57, SGD: 67, AED: 24, CHF: 100 };
const PER_YEAR = { year: 1, annual: 1, yearly: 1, month: 12, monthly: 12, week: 52, weekly: 52, day: 260, daily: 260, hour: 2080, hourly: 2080 };

// Turns { min, max, currency, period } from a source into yearly pay, plus `lpa` (lakhs of rupees a year, upper end)
// for sorting and filtering. Returns undefined for missing or implausible numbers: some feeds send junk like 21 or 114000000.
export function normalizeSalary({ min, max, currency, period = 'year' } = {}, fromText = false) {
  const code = String(currency ?? '').toUpperCase();
  const factor = PER_YEAR[String(period).toLowerCase()];
  if (!INR_PER[code] || !factor) return undefined;
  [min, max] = [Number(min) || 0, Number(max) || 0];
  if (!min && !max) return undefined;
  if (!max) max = min;
  if (!min) min = max;
  if (min > max) [min, max] = [max, min];
  const yearly = (n) => Math.round(n * factor);
  const lpa = (yearly(max) * INR_PER[code]) / 100_000;
  if (lpa < 0.5 || lpa > 1000) return undefined; // under ₹50k or over ₹10 crore a year: not a real salary
  return { min: yearly(min), max: yearly(max), currency: code, lpa: Math.round(lpa * 10) / 10, fromText };
}

const num = (s) => Number(String(s).replace(/,/g, ''));
const periodNear = (text) =>
  /\/\s*(hr|hour)|per\s+hour|hourly/i.test(text) ? 'hour' : /\/\s*(mo|month)|per\s+month|monthly|\bp\.?m\.?\b/i.test(text) ? 'month' : 'year';

// Finds pay written in a description: "12-18 LPA", "₹12,00,000 - ₹18,00,000", "$120k–$150k", "$3.5k–$5k/month".
export function parseSalaryText(text = '') {
  // Indian style: lakhs per annum
  let m = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)\b/i);
  if (m) return normalizeSalary({ min: m[1] * 100_000, max: m[2] * 100_000, currency: 'INR' }, true);
  m = text.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs? per annum|lacs? per annum)\b/i);
  if (m) return normalizeSalary({ min: m[1] * 100_000, currency: 'INR' }, true);

  // Rupee amounts: a range, so a lone "₹50 crore raised" isn't read as pay
  m = text.match(/(?:₹|\binr|\brs\.?)\s*([\d,]{4,}(?:\.\d+)?)\s*(?:-|–|to)\s*(?:₹|inr|rs\.?)?\s*([\d,]{4,})(.{0,20})/i);
  if (m) return normalizeSalary({ min: num(m[1]), max: num(m[2]), currency: 'INR', period: periodNear(m[3]) }, true);

  // Other currencies: "$120k–$150k", "€60,000 - €75,000", "$50-$75 /hour"
  const SYMBOL = { $: 'USD', '€': 'EUR', '£': 'GBP' };
  m = text.match(/([$€£])\s?(\d+(?:[.,]\d+)*)\s*(k)?\s*(?:-|–|to)\s*[$€£]?\s?(\d+(?:[.,]\d+)*)\s*(k)?(.{0,20})/i);
  if (m) {
    const k = m[3] || m[5] ? 1000 : 1;
    const period = periodNear(m[6]);
    const [lo, hi] = [num(m[2]) * k, num(m[4]) * k];
    // without "k" or a period, small numbers are usually not pay ("$5-10M funding" is caught by the sanity check anyway)
    if (k > 1 || period !== 'year' || hi >= 10_000) return normalizeSalary({ min: lo, max: hi, currency: SYMBOL[m[1]], period }, true);
  }
  return undefined;
}

// The lowest overall "N years" a description asks for: "3+ years of experience", "2-5 yrs exp", "minimum 4 years".
// Like career-ops' jd-years: take the most lenient reading, so a job is never hidden by a misread number.
export function parseYears(text = '') {
  const found = [];
  const patterns = [
    /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,40}?\b(?:experience|exp)\b/gi,
    /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi,
    /\bexperience\s*[:\-–]\s*(\d{1,2})\s*(?:\+|-|–|to)?\s*(?:\d{1,2})?\s*(?:years?|yrs?)/gi,
  ];
  for (const re of patterns) for (const [, n] of text.matchAll(re)) if (+n <= 20) found.push(+n);
  return found.length ? Math.min(...found) : undefined;
}

// Which site the job really comes from: freehire's "naukri", JSearch's "Naukri.com" and "Indeed", or the source itself.
export const platformOf = (source, via) =>
  String(via || source)
    .toLowerCase()
    .replace(/\.(com|in|co|io|net)$/, '')
    .replace(/[^a-z0-9]+/g, '');

// Signs a posting is junk: a scam, an ad-network copy, or too empty to judge. Each reason is shown to you, so a
// wrong call is visible. Rules only; tune them here when real jobs get caught.
const SCAM =
  /\b(registration|joining|processing|security|training)\s+(fee|fees|charges?|deposit)\b|\bpay\s+to\s+(apply|join)\b|\bwhats\s?app\s+(me|us|on|at|your)\b|\btelegram\b|\bearn\s+(₹|rs\.?|inr|\$)?\s*\d[\d,]*\s*(\/|per)\s*(day|hour|week)\b|\b(mlm|network marketing)\b|\bdata entry\b[^.\n]{0,40}\b(from home|online)\b/i;
// Sites that only republish other sites' jobs as pay-per-click pages.
const MIRRORS = /^whatjobs/;

export function junkReasons({ title = '', company = '', description = '', platform = '', source = '' }) {
  const reasons = [];
  if (SCAM.test(`${title}\n${description}`)) reasons.push('Asks for fees or contact on WhatsApp or Telegram');
  if (MIRRORS.test(platform)) reasons.push('Ad-network copy of a job posted elsewhere');
  if (!company || company === 'Unknown company') reasons.push('No company name');
  // Company boards' descriptions are always real; for the rest, a few words is not enough to judge or apply.
  if (!['greenhouse', 'lever', 'ashby'].includes(source) && description.trim().length < 150) reasons.push('Almost no description');
  // emoji or "!!" only: all-caps titles are normal in some countries ("DESARROLLADOR FULL STACK")
  if (/\p{Extended_Pictographic}|!{2,}/u.test(title)) reasons.push('Spammy title');
  return reasons;
}
