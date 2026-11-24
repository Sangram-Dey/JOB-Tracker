import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeText, draftChecks, placeholdersIn, resumeHtml, checkSuggestions, applySafe, replayChanges, keywordReport } from '../src/resume/draft.js';

const data = {
  contact: { name: 'Aarav Sharma', email: 'aarav@example.com', phone: '+91 98765 43210', location: 'Pune', linkedin: '', github: '', portfolio: '', links: [] },
  headline: 'MERN Developer',
  summary: 'MERN developer with 3 years building React and Node.js apps.',
  experience: [{ company: 'CartNest', title: 'Developer', location: 'Pune', startDate: 'Jul 2022', endDate: 'Present', bullets: ['Worked on the checkout page', 'Built a React admin used by 40 sellers'] }],
  education: [],
  skills: ['React', 'Node.js', 'MongoDB', 'Express', 'JavaScript', 'Git'],
  projects: [],
  certifications: [],
};

test('resume text has the sections in reading order, with dates on the role line', () => {
  const lines = resumeText(data).split('\n');
  assert.equal(lines[0], 'Aarav Sharma');
  assert.ok(lines.indexOf('Summary') < lines.indexOf('Skills') && lines.indexOf('Skills') < lines.indexOf('Experience'));
  assert.ok(lines.includes('Developer, CartNest | Pune | Jul 2022 – Present'));
});

test('format checks flag weak openers and placeholders', () => {
  const texts = draftChecks(data).map((f) => `${f.level} ${f.text}`);
  assert.ok(texts.some((t) => t.startsWith('warn') && t.includes('Worked on')));
  const withX = { ...data, summary: 'Cut load time by [X]%.' };
  assert.deepEqual(placeholdersIn(withX), ['summary']);
  assert.ok(draftChecks(withX).some((f) => f.level === 'fail' && f.text.includes('placeholder')));
});

test('PDF html escapes text and uses one column', () => {
  const html = resumeHtml({ ...data, summary: '<script>x</script> & more' });
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt; &amp; more'));
  assert.ok(!/<table|display:\s*(grid|flex)|column-count/i.test(html));
});

test('suggestions must point at a real field with its real text', () => {
  const history = [data];
  const out = checkSuggestions(
    [
      { path: 'experience.0.bullets.0', before: 'Worked on the checkout page', after: 'Built the checkout page in React', reason: '', keyword: '', needsConfirmation: false },
      { path: 'experience.0.bullets.1', before: 'Something else', after: 'x y z', reason: '', keyword: '', needsConfirmation: false }, // wrong before
      { path: 'skills', before: '', after: 'Docker', reason: '', keyword: 'Docker', needsConfirmation: false }, // not in history
      { path: 'skills', before: '', after: 'react', reason: '', keyword: '', needsConfirmation: false }, // already there
      { path: '__proto__.x', before: '', after: 'bad', reason: '', keyword: '', needsConfirmation: false },
      { path: 'contact', before: '', after: 'bad', reason: '', keyword: '', needsConfirmation: false }, // an object, not text
      { path: 'summary', before: '', after: 'Cut load time by 70% for 2M users.', reason: '', keyword: '', needsConfirmation: false }, // invented numbers
    ],
    data,
    history,
  );
  assert.deepEqual(out.map((s) => [s.path, s.kind]), [['experience.0.bullets.0', 'rewrite'], ['skills', 'add'], ['summary', 'rewrite']]);
  assert.equal(out[0].needsConfirmation, false);
  assert.ok(out[1].needsConfirmation && out[1].warnings[0].includes('Skill not in your history'));
  assert.ok(out[2].needsConfirmation && out[2].warnings.some((w) => w.includes('Number not in your history')));
  assert.equal(out[2].before, data.summary); // filled from the real field
});

test('auto-apply tailoring applies only edits that need no check', () => {
  const s = (path, before, after, more = {}) => ({ path, before, after, reason: '', keyword: '', needsConfirmation: false, warnings: [], kind: before ? 'rewrite' : 'add', ...more });
  const { data: out, changes } = applySafe(
    data,
    [
      s('experience.0.bullets.0', 'Worked on the checkout page', 'Built the checkout page in React'), // safe
      s('experience.0.bullets.0', 'Worked on the checkout page', 'Built checkout in React and Node.js'), // same field again: stale now
      s('experience.0.bullets.1', 'Built a React admin used by 40 sellers', 'Built a React admin on AWS for 40 sellers'), // AWS not in history
      s('summary', data.summary, 'Cut load time by [X]%.'), // placeholder
      s('skills', '', 'Docker', { warnings: ['Skill not in your history: Docker'] }),
      s('skills', '', 'REST APIs', { needsConfirmation: true }),
      s('skills', '', 'Mongoose'), // a known skill your history doesn't show
    ],
    resumeText(data),
  );
  assert.deepEqual(changes.map((c) => c.after), ['Built the checkout page in React']);
  assert.equal(out.experience[0].bullets[0], 'Built the checkout page in React');
  assert.equal(data.experience[0].bullets[0], 'Worked on the checkout page'); // the original is untouched
});

test('undoing one change replays the others on your original', () => {
  const changes = [
    { path: 'experience.0.bullets.0', kind: 'rewrite', before: 'Worked on the checkout page', after: 'Built the checkout page in React' },
    { path: 'skills', kind: 'add', before: '', after: 'REST APIs' },
    { path: 'summary', kind: 'rewrite', before: 'not the real summary', after: 'x' }, // stale: skipped
  ];
  const out = replayChanges(data, changes);
  assert.equal(out.experience[0].bullets[0], 'Built the checkout page in React');
  assert.deepEqual(out.skills.slice(-1), ['REST APIs']);
  assert.equal(out.summary, data.summary);
});

test('keyword report: added, worked into more lines, and missing', () => {
  const r = (found, missing) => ({ required: { found, missing }, preferred: { found: [], missing: [] } });
  const k = keywordReport(r(['React'], ['REST APIs', 'Go']), r(['React', 'REST APIs'], ['Go']), [{ keyword: 'react' }, { keyword: 'REST APIs' }]);
  assert.deepEqual(k, { added: ['REST APIs'], strengthened: ['React'], missing: ['Go'] });
});
