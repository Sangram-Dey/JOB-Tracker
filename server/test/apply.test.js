import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formFor } from '../src/apply/form.js';
import { fromProfile, answerForm } from '../src/apply/answer.js';

test('only Greenhouse, Lever and Ashby forms are opened, at their application page', () => {
  assert.deepEqual(formFor({ url: 'https://jobs.lever.co/acme/123?utm_source=x' }), { ats: 'lever', url: 'https://jobs.lever.co/acme/123/apply' });
  assert.deepEqual(formFor({ url: 'https://jobs.ashbyhq.com/acme/abc' }), { ats: 'ashby', url: 'https://jobs.ashbyhq.com/acme/abc/application' });
  assert.deepEqual(formFor({ url: 'https://job-boards.greenhouse.io/acme/jobs/9?gh_jid=9&utm_source=x' }), { ats: 'greenhouse', url: 'https://job-boards.greenhouse.io/acme/jobs/9?gh_jid=9' });
  assert.equal(formFor({ url: 'https://evil.example/greenhouse.io/x' }), null);
  assert.equal(formFor({ url: 'https://greenhouse.io.evil.example/x' }), null);
  assert.equal(formFor({ url: 'http://jobs.lever.co/acme/1' }), null); // https only
  assert.equal(formFor({ url: 'https://www.naukri.com/job/1' }), null);
});

const profile = { contact: { name: 'Aarav Kumar Sharma', email: 'a@x.com', phone: '+91 98765 43210', location: 'Bengaluru', links: ['https://linkedin.com/in/a', 'https://github.com/a', 'https://aarav.dev'] }, experience: [{ company: 'CartNest', title: 'Engineer' }] };
const f = (label, kind = 'text') => ({ id: '1', kind, label, required: true, options: [] });

test('plain facts come from the profile', () => {
  assert.equal(fromProfile(f('First Name'), profile).value, 'Aarav');
  assert.equal(fromProfile(f('Last Name'), profile).value, 'Kumar Sharma');
  assert.equal(fromProfile(f('LinkedIn Profile'), profile).value, 'https://linkedin.com/in/a');
  assert.equal(fromProfile(f('Website'), profile).value, 'https://aarav.dev');
  assert.equal(fromProfile(f('Current company'), profile).value, 'CartNest');
  assert.equal(fromProfile(f('Are you willing to relocate to our office city?'), profile), null); // not a location fact
  assert.deepEqual(fromProfile(f('Resume/CV', 'file'), profile), { source: 'resume' });
  assert.equal(fromProfile(f('Cover Letter', 'file'), profile), null);
});

test('sensitive questions stay blank and never reach the AI; one resume upload only', async () => {
  const fields = [
    { id: '1', kind: 'combobox', label: 'Gender', required: false, options: ['Male', 'Female'] },
    { id: '2', kind: 'select', label: 'Disability status', required: true, options: ['Yes', 'No'] },
    { id: '3', kind: 'file', label: 'resume', required: false, options: [] },
    { id: '4', kind: 'file', label: 'Resume', required: true, options: [] },
    { id: '5', kind: 'text', label: 'Email', required: true, options: [] },
  ];
  const out = await answerForm(fields, { profile, answers: {}, job: {} }); // nothing left for the AI, so no AI call
  assert.deepEqual(out.map((x) => [x.id, x.value, x.source, x.needsYou]), [
    ['1', null, 'blank', false],
    ['2', null, 'blank', true],
    ['3', null, 'blank', false],
    ['4', null, 'resume', false],
    ['5', 'a@x.com', 'profile', false],
  ]);
});
