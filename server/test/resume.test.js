import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factIssues } from '../src/resume/factCheck.js';
import { MAX_PDF_BYTES, savePdf } from '../src/resume/storage.js';

const content = {
  contact: { name: 'Aarav Sharma', email: 'aarav@example.com', phone: '+91 98765 43210', location: 'Bengaluru', links: [] },
  headline: 'MERN Stack Developer',
  summary: 'Full stack developer with 3 years building React and Node.js apps.',
  experience: [{ company: 'CartNest', title: 'Software Engineer', location: 'Bengaluru', startDate: 'Jul 2023', endDate: 'Present',
    bullets: ['Built a seller dashboard in React, cutting processing time by 35%.', 'Designed Node.js APIs serving 2M requests a day.', 'Added Redis caching.'] }],
  education: [{ institution: 'VTU', degree: 'B.Tech', field: 'Computer Science', startDate: '2017', endDate: '2021', grade: '8.2' }],
  skills: ['React', 'Node.js', 'MongoDB', 'Express', 'Docker'],
  projects: [], certifications: [],
};

test('fact check flags invented employers and numbers, not true ones', () => {
  const edited = { ...content, experience: [{ ...content.experience[0], company: 'Google', bullets: ['Cut costs by 70%', 'Cut processing time by 35%', 'Improved speed by [X]%'] }] };
  const issues = factIssues(edited, [content]);
  assert.deepEqual(issues.map((i) => i.reason), ['Employer not in your history', 'Number not in your history', 'Placeholder still to fill in']);
  assert.deepEqual(factIssues(content, [content]), []);
});

test('a resume PDF over 2 MB is refused before it is stored', async () => {
  await assert.rejects(savePdf(Buffer.alloc(MAX_PDF_BYTES + 1), 'big.pdf'), { status: 413 });
});
