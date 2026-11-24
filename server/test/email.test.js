import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml, toText } from '../src/mail/format.js';
import { pickDaily, isActive } from '../src/mail/prepare.js';
import { parseContactLines } from '../src/routes/contacts.js';
import { companyKey } from '../src/jobs/normalize.js';

const profile = { contact: { name: 'Aarav Sharma', phone: '+91 98765 43210', email: 'aarav@example.com', links: ['linkedin.com/in/aarav'] } };
const body = 'Hello Acme hiring team,\n\nI am applying for the **MERN Developer** role.\n\n- Built React apps\n- Node.js <APIs>\n\nBest regards,';

test('formatted email: paragraphs, bullets, bold, escaped text, signature with links', () => {
  const html = toHtml(body, profile);
  assert.match(html, /<b>MERN Developer<\/b>/);
  assert.match(html, /<ul[^>]*><li>Built React apps<\/li><li>Node.js &lt;APIs&gt;<\/li><\/ul>/);
  assert.match(html, /<b>Aarav Sharma<\/b><br>\+91 98765 43210 · aarav@example.com<br><a href="https:\/\/linkedin.com\/in\/aarav"/);
  assert.doesNotMatch(html, /<APIs>/);
});

test('plain-text copy drops the bold marks and keeps the signature', () => {
  const text = toText(body, profile);
  assert.match(text, /the MERN Developer role/);
  assert.match(text, /Best regards,\n\nAarav Sharma\n\+91 98765 43210 · aarav@example.com\nlinkedin.com\/in\/aarav$/);
});

test('company names match across sites', () => {
  assert.equal(companyKey('Acme Technologies Pvt. Ltd.'), companyKey('ACME technologies'));
});

test('active jobs: open, not junk, posted in the last 30 days', () => {
  const now = Date.now();
  assert.equal(isActive({ postedAt: new Date(now - 5 * 86_400_000) }, now), true);
  assert.equal(isActive({ postedAt: new Date(now - 40 * 86_400_000) }, now), false);
  assert.equal(isActive({ liveness: { status: 'closed' } }, now), false);
  assert.equal(isActive({ junk: ['spam'] }, now), false);
});

test('daily pick: best fit first, one per company, skips unsendable, waiting, recent, emailed-before and job-less contacts', () => {
  const job = [{ fit: 80 }];
  const rows = [
    { company: 'Acme', email: 'a@acme.com', sendable: true, jobs: job },
    { company: 'ACME Pvt Ltd', email: 'b@acme.com', sendable: true, jobs: job }, // same company
    { company: 'Beta', email: 'x@beta.com', sendable: false, jobs: job },
    { company: 'Gamma', email: 'g@gamma.com', sendable: true, jobs: job, outbox: 'draft' },
    { company: 'Gamma', email: 'h@gamma.com', sendable: true, jobs: job }, // Gamma already has one waiting
    { company: 'Delta', email: 'd@delta.com', sendable: true, jobs: [] }, // no active job
    { company: 'Echo', email: 'e@echo.com', sendable: true, jobs: job, recent: true },
    { company: 'Fox', email: 'f@fox.com', sendable: true, jobs: job },
    { company: 'Golf', email: 'g@golf.com', sendable: true, jobs: job },
    { company: 'Hotel', email: 'h@hotel.com', sendable: true, jobs: job, lastContactedAt: new Date('2026-10-01') }, // emailed before: never picked automatically
  ];
  assert.deepEqual(pickDaily(rows, 10).map((r) => r.email), ['a@acme.com', 'f@fox.com', 'g@golf.com']);
  assert.deepEqual(pickDaily(rows, 2).map((r) => r.email), ['a@acme.com', 'f@fox.com']);
});

test('pasted contacts: header skipped, commas or tabs, bad lines reported', () => {
  const { contacts, skipped } = parseContactLines('Company,Email,Name\nAcme, HR@Acme.com , Priya, HR Lead\nBeta\tjobs@beta.io\nGamma, not-an-email\n');
  assert.deepEqual(JSON.parse(JSON.stringify(contacts)), [
    { company: 'Acme', email: 'hr@acme.com', name: 'Priya', position: 'HR Lead' },
    { company: 'Beta', email: 'jobs@beta.io' },
  ]);
  assert.deepEqual(skipped.map((s) => s.line), [4]);
});

test('no role keywords: search words come from the resume', async () => {
  const { termsFromProfile } = await import('../src/jobs/scrape.js');
  const data = { headline: 'MERN Stack Developer | React | Node.js', experience: [{ title: 'Software Engineer' }], skills: ['React', 'Node.js', 'MongoDB', 'Docker', 'Git'] };
  assert.deepEqual(termsFromProfile(data), ['Software Engineer', 'MERN Stack Developer', 'React', 'Node.js']);
  assert.deepEqual(termsFromProfile({ headline: 'React Developer', skills: ['react'] }), ['React Developer', 'react']);
  assert.deepEqual(termsFromProfile(undefined), []);
});
