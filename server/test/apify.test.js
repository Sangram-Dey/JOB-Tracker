import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naukriToJobs, indeedToJobs, plan } from '../src/sources/apify.js';
import { matchesPreferences } from '../src/jobs/match.js';
import { DEFAULT_PREFERENCES } from '../src/schemas/preferences.js';

const desc = 'Build Node.js and React services for our payments platform. '.repeat(5);

// Field names from the actors' Apify pages (2026-11-20), trimmed.
const naukri = {
  jobId: 'n1', title: 'MERN Stack Developer', companyName: 'Acme Pvt Ltd', location: 'Bengaluru', portalUrl: 'https://www.naukri.com/job-listings-n1',
  description: desc, salary: '6-12 Lacs PA', createdDate: '2026-11-18T00:00:00.000Z', minimumExperience: 2, workModeLabel: 'Hybrid',
  skills: ['React', 'Node.js'], consultant: false,
};
const indeed = {
  key: 'i1', title: 'Full Stack Developer (Node)', employer: { name: 'Beta Labs' }, location: { city: 'Pune', countryCode: 'IN' },
  url: 'https://in.indeed.com/viewjob?jk=i1', jobUrl: 'https://beta.example/careers/1', description: { text: desc },
  datePublished: '2026-11-17', baseSalary: { min: 800000, max: 1200000, currencyCode: 'INR', unitOfWork: 'YEAR' },
};

test('Naukri items from Apify become jobs', () => {
  const [j, ...rest] = naukriToJobs([naukri, { title: 'no url' }, { ...naukri, consultant: true }]);
  assert.equal(rest.length, 0); // no link, consultancy repost: dropped
  assert.equal(naukriToJobs([{ ...naukri, workModeLabel: undefined, wfhType: 'office' }])[0].workMode, 'onsite');
  assert.match(j.description, /Skills: React, Node\.js/);
  assert.equal(j.source, 'apify');
  assert.equal(j.platform, 'naukri');
  assert.equal(j.url, naukri.portalUrl);
  assert.equal(j.experienceMin, 2);
  assert.equal(j.workMode, 'hybrid');
  assert.deepEqual(j.junk, []);
  assert.deepEqual(naukriToJobs([]), []);
});

test('Indeed items from Apify become jobs with pay and the employer link', () => {
  const [j] = indeedToJobs([indeed]);
  assert.equal(j.platform, 'indeed');
  assert.equal(j.company, 'Beta Labs');
  assert.equal(j.applyUrl, indeed.jobUrl);
  assert.ok(j.locations.includes('India'));
  assert.equal(j.salary.lpa, 12);
  assert.deepEqual(indeedToJobs(undefined), []);
  const [noCity] = indeedToJobs([{ ...indeed, location: { city: '', countryCode: 'IN' } }], 'Bengaluru');
  assert.ok(noCity.locations.includes('Bengaluru'));
});

test('Apify jobs go through the same role, place and junk checks as every source', () => {
  const prefs = { ...DEFAULT_PREFERENCES, roles: ['mern'], cities: ['Bangalore'], workModes: ['hybrid', 'onsite'] };
  assert.equal(matchesPreferences(naukriToJobs([naukri])[0], prefs), true); // Bengaluru = Bangalore
  assert.equal(matchesPreferences(indeedToJobs([indeed])[0], prefs), false); // not a MERN title, not in Bangalore
  const [scam] = naukriToJobs([{ ...naukri, description: `${desc} Pay registration fee and WhatsApp me.` }]);
  assert.ok(scam.junk.length);
});

test('Apify runs only with a token and never past its monthly budget', () => {
  const prefs = { ...DEFAULT_PREFERENCES, cities: ['Bengaluru'] };
  delete process.env.APIFY_TOKEN;
  assert.equal(plan(prefs, ['node'], { callsLeft: 10 }).length, 0);
  process.env.APIFY_TOKEN = 'test';
  assert.deepEqual(plan(prefs, ['node'], { callsLeft: 10 }).map((t) => t.label), ['Naukri: node in Bengaluru', 'Indeed: node in Bengaluru']);
  assert.equal(plan(prefs, ['node'], { callsLeft: 1 }).length, 1);
  assert.equal(plan(prefs, ['node'], { callsLeft: 0 }).length, 0);
  assert.equal(plan(prefs, [], { callsLeft: 10 }).length, 0);
  delete process.env.APIFY_TOKEN;
});
