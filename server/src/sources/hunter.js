import mongoose from 'mongoose';
import { fetchJson } from './fetchJson.js';
import { Contact } from '../models/Contact.js';
import { httpError } from '../utils/httpError.js';

// Hunter.io Domain Search with department=hr: named HR and recruiting people at a company, each with a confidence
// score, a verification status and the pages the address was seen on. Needs HUNTER_API_KEY (free: 50 credits a month,
// at most 10 results per search). One search per domain per 30 days; the monthly budget stops before credits run out.
// Docs: https://hunter.io/api-documentation/v2#domain-search (checked 2026-11-13).
const MONTHLY_LIMIT = Number(process.env.HUNTER_MONTHLY_LIMIT) || 25;
const CACHE_DAYS = 30;

// A log of lookups: the cache and the budget.
const lookupSchema = new mongoose.Schema({ userId: String, domain: String, resolved: String, found: Number }, { timestamps: true });
lookupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31 * 86_400 }); // both the cache and the budget look back 30 days
const Lookup = mongoose.models.Lookup ?? mongoose.model('Lookup', lookupSchema);

export async function hunterStatus(userId) {
  const used = await Lookup.countDocuments({ userId, createdAt: { $gt: new Date(Date.now() - 30 * 86_400_000) } });
  return { configured: Boolean(process.env.HUNTER_API_KEY), used, limit: MONTHLY_LIMIT };
}

export const cleanDomain = (input) =>
  String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];

export function toContacts(data, { userId, company }) {
  return (data?.emails ?? []).map((e) => ({
    userId,
    company: company || data.organization || data.domain,
    domain: data.domain,
    name: [e.first_name, e.last_name].filter(Boolean).join(' ') || undefined,
    position: e.position || undefined,
    email: e.value?.toLowerCase(),
    phone: e.phone_number || undefined,
    kind: e.type === 'generic' ? 'role' : 'person',
    source: 'hunter',
    foundOn: e.sources?.[0]?.uri,
    confidence: e.confidence,
    verified: e.verification?.status,
  }));
}

// By domain (best) or, when you only know the name, by company: Hunter then finds the domain itself.
export async function lookupHr(userId, { domain, company, jobId }) {
  if (!process.env.HUNTER_API_KEY) throw httpError(400, 'Add HUNTER_API_KEY to server/.env to look up HR people (free account at hunter.io)');
  domain = cleanDomain(domain);
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw httpError(400, 'Give the company website, like acme.com');
  const key = domain || `company:${company.toLowerCase()}`; // cache and budget key
  const mine = (d) => Contact.find({ userId, source: 'hunter', ...(d ? { domain: d } : { company }) });
  const earlier = await Lookup.findOne({ userId, domain: key, createdAt: { $gt: new Date(Date.now() - CACHE_DAYS * 86_400_000) } });
  if (earlier) return { cached: true, contacts: await mine(earlier.resolved ?? domain) };
  const { used, limit } = await hunterStatus(userId);
  if (used >= limit) throw httpError(429, `Hunter limit for this month reached (${limit} lookups). It resets as older lookups pass 30 days.`);

  const params = new URLSearchParams({ ...(domain ? { domain } : { company }), department: 'hr', limit: '10', api_key: process.env.HUNTER_API_KEY });
  const { data } = await fetchJson(`https://api.hunter.io/v2/domain-search?${params}`);
  const found = toContacts(data, { userId, company }).filter((c) => c.email);
  await Lookup.create({ userId, domain: key, resolved: data?.domain, found: found.length });
  domain ||= data?.domain;
  if (found.length) {
    await Contact.bulkWrite(
      found.map(({ email, ...rest }) => ({
        updateOne: { filter: { userId, email }, update: { $set: rest, ...(jobId && { $addToSet: { jobIds: jobId } }) }, upsert: true },
      })),
      { ordered: false },
    );
  }
  return { cached: false, contacts: await mine(domain) };
}
