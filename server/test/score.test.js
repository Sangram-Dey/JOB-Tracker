import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob, yourSkills, yearsFromResume, yourYears } from '../src/jobs/score.js';
import { DEFAULT_PREFERENCES } from '../src/schemas/preferences.js';

const profile = {
  skills: ['JavaScript (ES6+)', 'React', 'Node.js', 'MongoDB', 'Express', 'AWS (EC2, S3)', 'Docker', 'TypeScript', 'Redis'],
  projects: [{ tech: ['React', 'Socket.io'] }],
  experience: [
    { startDate: 'Jan 2022', endDate: 'Jun 2023' },
    { startDate: 'Jul 2023', endDate: 'Present' },
  ],
};
const prefs = { ...DEFAULT_PREFERENCES, roles: ['mern', 'full stack', 'node'], cities: ['Bengaluru', 'Pune'], countries: ['India'], minSalaryLpa: 10 };
const now = Date.parse('2026-11-13T00:00:00Z');
const ctx = { prefs, skills: yourSkills(profile), years: 4, now };
const job = (over) => ({
  title: 'MERN Full Stack Developer',
  description: 'React, Node.js (nodejs), Express, MongoDB, TypeScript, Docker, AWS and Redis. 3+ years.',
  locations: ['Bengaluru, India'],
  workMode: 'hybrid',
  experienceMin: 3,
  postedAt: '2026-11-12T12:00:00Z',
  salary: { lpa: 18 },
  ...over,
});

test('skills: names from the resume match common spellings', () => {
  const names = yourSkills(profile).map((s) => s.name);
  assert.ok(names.includes('JavaScript') && names.includes('AWS') && !names.includes('JavaScript (ES6+)'));
  assert.equal(names.filter((n) => n === 'React').length, 1); // project tech doesn't double-count
  const { matchedSkills } = scoreJob(job({ description: 'We use nodejs.' }), ctx);
  assert.deepEqual(matchedSkills, ['Node.js']);
});

test('a strong match in your first city scores high; a weak far one scores low', () => {
  const strong = scoreJob(job(), ctx);
  assert.ok(strong.score >= 90, `strong was ${strong.score}`);
  const weak = scoreJob(job({ title: 'Node Developer', description: 'PHP and Laravel.', locations: ['Berlin'], experienceMin: 8, postedAt: '2026-10-01', salary: { lpa: 6 } }), ctx);
  assert.ok(weak.score < 30, `weak was ${weak.score}`);
});

test('location follows your city order, then country, then remote', () => {
  const at = (locations, workMode = 'onsite') => scoreJob(job({ locations, workMode }), ctx).parts.location;
  assert.equal(at(['Bengaluru']), 15);
  assert.equal(at(['Pune']), 13);
  assert.equal(at(['Chennai, India']), 9);
  assert.equal(at(['Remote'], 'remote'), 12);
  assert.equal(at(['Remote - India'], 'remote'), 12);
  assert.equal(at(['Mexico Remote'], 'remote'), 6); // remote, but only for another country
});

test('generic web basics alone are not a strong skills match', () => {
  const generic = { ...ctx, skills: yourSkills({ skills: ['HTML5', 'CSS3', 'SQL', 'Git', 'REST APIs', 'Postman'] }) };
  assert.ok(scoreJob(job({ description: 'HTML5, CSS3, SQL, Git, REST APIs, Postman' }), generic).parts.skills <= 12);
});

test('the AI rating moves the best-fit order, not the score', async () => {
  const { rankOf } = await import('../src/jobs/score.js');
  assert.equal(rankOf(90, { rating: 2 }), 80);
  assert.equal(rankOf(70, { rating: 5 }), 90);
  assert.equal(rankOf(70), 70);
});

test('experience: unknown is half points, far above you is zero', () => {
  assert.equal(scoreJob(job({ experienceMin: undefined }), ctx).parts.experience, 8);
  assert.equal(scoreJob(job({ experienceMin: 5 }), ctx).parts.experience, 10);
  assert.equal(scoreJob(job({ experienceMin: 9 }), ctx).parts.experience, 0);
});

test('years: Preferences first, else the resume dates', () => {
  assert.equal(yearsFromResume(profile, new Date('2026-11-13')), 4.9);
  assert.equal(yourYears({ yearsExperience: 2 }, profile), 2);
  assert.equal(yourYears({ yearsExperience: null }, profile) > 4, true);
  assert.equal(yearsFromResume({ experience: [] }), undefined);
});
