import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJobs, plan } from '../src/sources/jsearch.js';
import { DEFAULT_PREFERENCES } from '../src/schemas/preferences.js';

// Shape copied from a real search-v2 answer (2026-11-13), trimmed.
const body = {
  status: 'OK',
  data: {
    cursor: 'x',
    jobs: [
      {
        job_id: 'abc', job_title: 'Full Stack - Node.Js+ React.Js (Developer)', employer_name: 'Tata Consultancy Services Limited',
        job_publisher: 'JobLeads', job_apply_link: 'https://example.com/apply', job_is_remote: false,
        job_description: 'Build Node.js and React services. '.repeat(10), job_posted_at_datetime_utc: '2026-11-08T00:00:00.000Z',
        job_city: 'Bengaluru', job_state: 'Karnataka', job_country: 'IN', job_location: 'Bengaluru, Karnataka', job_salary_string: '₹6L–₹12L a year',
      },
    ],
  },
};

test('JSearch search-v2 answers become jobs', () => {
  const [j] = toJobs(body);
  assert.equal(j.source, 'jsearch');
  assert.equal(j.platform, 'jobleads');
  assert.equal(j.company, 'Tata Consultancy Services Limited');
  assert.ok(j.locations.includes('India'));
  assert.equal(j.workMode, 'unknown');
  assert.deepEqual(toJobs({ data: {} }), []);
});

test('JSearch asks for India by default and never spends more than its budget', () => {
  process.env.JSEARCH_API_KEY = 'test';
  const prefs = { ...DEFAULT_PREFERENCES, cities: ['Bengaluru'], countries: ['India'] };
  assert.deepEqual(plan(prefs, ['node'], { callsLeft: 10 }).map((t) => t.label), ['node in Bengaluru', 'node in India']);
  assert.equal(plan(prefs, ['node'], { callsLeft: 1 }).length, 1);
  assert.equal(plan(prefs, ['node'], { callsLeft: 0 }).length, 0);
  delete process.env.JSEARCH_API_KEY;
  assert.equal(plan(prefs, ['node'], { callsLeft: 10 }).length, 0);
});
