import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumePart } from '../src/ai/parseResume.js';
import { pdfText, readability, searchTest, jobMatch, hasSkill } from '../src/resume/atsCheck.js';

// A minimal real PDF: each item is [x, y, text] in points on an A4-ish page.
function makePdf(items, link) {
  const stream = items.map(([x, y, t]) => `BT /F1 10 Tf ${x} ${y} Td (${t}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${link ? ' /Annots [6 0 R]' : ''} >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...(link ? [`<< /Type /Annot /Subtype /Link /Rect [50 700 150 720] /A << /S /URI /URI (${link}) >> >>`] : []),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const lines = [
  'Aarav Sharma', 'aarav@example.com | +91 98765 43210', 'Summary', 'MERN Stack Developer with 3 years building React and Node.js apps.',
  'Experience', 'Software Engineer, CartNest  Jul 2023 - Present', 'Built a seller dashboard in React and Redux.', 'Designed REST APIs in Express and MongoDB.',
  'Skills', 'JavaScript, TypeScript, React, Node.js, Express, MongoDB, Docker, Git', 'Education', 'B.Tech Computer Science, VTU  2017 - 2021',
  'Built and deployed several full stack projects with authentication, payments, dashboards and tests, written in JavaScript and TypeScript end to end.',
];
const profile = { contact: { name: 'Aarav Sharma' }, experience: [{ title: 'Software Engineer' }], education: [{ degree: 'B.Tech' }] };

test('reads a one-column PDF in order, and finds name, email, phone, sections and dates', async () => {
  const pdf = await pdfText(makePdf(lines.map((t, i) => [50, 760 - i * 20, t])));
  assert.equal(pdf.pages, 1);
  assert.equal(pdf.lines[0], 'Aarav Sharma');
  const found = readability(pdf, profile);
  assert.deepEqual(found.filter((f) => f.level !== 'ok').map((f) => f.text), []);
});

test('flags two columns and image-only PDFs', async () => {
  const twoCol = await pdfText(makePdf(lines.flatMap((t, i) => [[40, 760 - i * 20, t.slice(0, 20)], [380, 760 - i * 20, 'Column two text here']])));
  assert.ok(readability(twoCol, profile).some((f) => /two columns/.test(f.text)));
  const empty = await pdfText(makePdf([[50, 700, 'Hi']]));
  assert.equal(readability(empty, profile)[0].level, 'fail');
});

test('skills match common spellings, not lookalikes', () => {
  assert.equal(hasSkill('Built with NodeJS and mongo', 'Node.js'), true);
  assert.equal(hasSkill('Built with NodeJS and mongo', 'MongoDB'), true);
  assert.equal(hasSkill('I know JavaScript', 'Java'), false);
  assert.equal(hasSkill('the rest of the team', 'REST APIs'), false);
  assert.equal(hasSkill('Worked on Kibana dashboards', 'Kibana'), true); // not in the list: whole-word match
});

test('search test: most-asked skills first, with recruiter wording tips', () => {
  const result = searchTest('React, node, MongoDB', ['React Node.js AWS', 'React Node.js', 'React Docker']);
  assert.deepEqual(result.map((r) => [r.name, r.jobs, r.found]), [['React', 3, true], ['Node.js', 2, true], ['AWS', 1, false], ['Docker', 1, false]]);
  assert.match(result[1].tip, /Node\.js/);
});

test('job match: score, missing skills and filter risks', () => {
  const text = lines.join('\n');
  const req = { required: ['React', 'Node.js', 'AWS'], preferred: ['Docker', 'Kubernetes'], minYears: 5, degreeRequired: true };
  const job = { title: 'Senior MERN Stack Developer', workMode: 'onsite', locations: ['Pune'] };
  const r = jobMatch(text, req, job, { years: 3, prefs: { cities: ['Bengaluru'], countries: [] }, profileData: profile });
  assert.deepEqual(r.required, { found: ['React', 'Node.js'], missing: ['AWS'] });
  assert.deepEqual(r.preferred, { found: ['Docker'], missing: ['Kubernetes'] });
  assert.equal(r.titleFound, true);
  assert.equal(r.score, Math.round(70 * (2 / 3) + 20 * 0.5 + 10));
  assert.deepEqual(r.risks.map((x) => x.level), ['fail', 'warn']); // 2 years short; on-site in Pune
});

test('a PDF resume with text goes to the AI as text plus its clickable links; a scanned one as the file', async () => {
  const part = await resumePart({ mimetype: 'application/pdf', buffer: makePdf(lines.map((t, i) => [50, 760 - i * 20, t]), 'https://linkedin.com/in/aarav') });
  assert.match(part.text, /MERN Stack Developer/);
  assert.match(part.text, /Links in the resume:\nhttps:\/\/linkedin\.com\/in\/aarav/);
  const scanned = await resumePart({ mimetype: 'application/pdf', buffer: makePdf([[50, 700, 'Hi']]) });
  assert.equal(scanned.inlineData.mimeType, 'application/pdf');
});
