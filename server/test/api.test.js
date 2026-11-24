// Run with: npm test   (needs no database or Clerk account: signed-out requests are rejected before touching either)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSchema, withNamedLinks, allLinks } from '../src/schemas/profile.js';

// A well-formed but fake Clerk key pair, so clerkMiddleware can start without a real Clerk app.
process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${btoa('example.clerk.accounts.dev$')}`;
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
const { app } = await import('../src/app.js');

let server, base;
before(() => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

test('health check answers', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('profile needs a signed-in user', async () => {
  const res = await fetch(`${base}/profile`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Not signed in');
});

test('upload needs a signed-in user', async () => {
  assert.equal((await fetch(`${base}/profile/upload`, { method: 'POST' })).status, 401);
});

test('preferences and jobs need a signed-in user', async () => {
  for (const path of ['/preferences', '/jobs', '/jobs/runs/latest', '/profile/resume-pdf', '/contacts', '/outreach', '/outreach/status', '/apply/queue', '/apply/answers', '/tracker', '/tracker/today']) assert.equal((await fetch(`${base}${path}`)).status, 401);
  assert.equal((await fetch(`${base}/jobs/search`, { method: 'POST' })).status, 401);
  for (const path of ['/tracker/check-inbox', '/outreach/test', '/tailor/x', '/resume/score']) assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 401);
});

test('Gmail connect needs a signed-in user', async () => {
  assert.equal((await fetch(`${base}/profile/mail`, { method: 'PUT' })).status, 401);
  assert.equal((await fetch(`${base}/profile/mail`, { method: 'DELETE' })).status, 401);
});

test('unknown API routes return JSON 404', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test('profile schema rejects a missing field', () => {
  assert.equal(ProfileSchema.safeParse({ contact: {} }).success, false);
});

test('old profiles: LinkedIn, GitHub and portfolio move out of the links list into their own fields', () => {
  const { contact } = withNamedLinks({ contact: { name: 'A', links: ['https://github.com/a', 'https://a.dev', 'https://linkedin.com/in/a', 'https://blog.a.dev'] } });
  assert.deepEqual(contact, { name: 'A', linkedin: 'https://linkedin.com/in/a', github: 'https://github.com/a', portfolio: 'https://a.dev', links: ['https://blog.a.dev'] });
  assert.deepEqual(withNamedLinks({ contact }).contact, contact); // already split: unchanged
  assert.deepEqual(allLinks(contact), ['https://linkedin.com/in/a', 'https://github.com/a', 'https://a.dev', 'https://blog.a.dev']);
});
