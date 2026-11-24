import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { providerFor, PROVIDERS } from '../src/mail/providers.js';

test('the server stops at once, listing every missing setting', () => {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CLERK_SECRET_KEY: 'x' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js'); console.log('started')"], { env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /MONGODB_URI, CLERK_PUBLISHABLE_KEY, GEMINI_API_KEY, MAIL_SECRET_KEY/);
  assert.doesNotMatch(r.stdout, /started/);
});

test('the provider is picked from the email address', () => {
  assert.equal(providerFor('me@gmail.com'), 'gmail');
  assert.equal(providerFor('Me@GoogleMail.com'), 'gmail');
  assert.equal(providerFor('me@yahoo.co.in'), 'yahoo');
  assert.equal(providerFor('me@ymail.com'), 'yahoo');
  assert.equal(providerFor('me@outlook.com'), null); // not supported: needs Microsoft sign-in
  assert.equal(providerFor('me@company.com'), null); // the user picks
  assert.equal(PROVIDERS.yahoo.smtp, 'smtp.mail.yahoo.com');
  assert.equal(PROVIDERS.gmail.imap, 'imap.gmail.com');
});
