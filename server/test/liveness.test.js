import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedReason, checkLiveness } from '../src/jobs/liveness.js';

test('closed postings are recognised from the page', () => {
  assert.match(closedReason(404, ''), /gone/);
  assert.match(closedReason(200, 'Sorry, this job is no longer available.'), /closed/);
  assert.match(closedReason(200, 'We are no longer accepting applications for this role'), /closed/);
  assert.match(closedReason(200, 'This position has been filled.'), /closed/);
  assert.equal(closedReason(200, 'Once the application form has been filled out, we reply within a week.'), undefined);
  assert.equal(closedReason(200, 'Apply now: we are hiring a Node developer'), undefined);
});

test('company board jobs count as open; links into your own network are never opened', async () => {
  assert.equal((await checkLiveness({ source: 'lever', url: 'https://jobs.lever.co/x/1' })).status, 'active');
  assert.equal((await checkLiveness({ source: 'freehire', url: 'http://127.0.0.1:4000/api/health' })).status, 'unknown');
  assert.equal((await checkLiveness({ source: 'freehire', url: 'javascript:alert(1)' })).status, 'unknown');
});
