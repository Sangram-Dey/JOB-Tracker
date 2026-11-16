import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { phonesIn } from '../jobs/contacts.js';

// An ATS (Workday, Greenhouse, Lever, Taleo…) first pulls the text out of your PDF, then fills in fields and lets
// recruiters search it. These checks repeat those steps in plain code, so the answers are free and the same every time.
// No ATS publishes its scoring: this is a realistic simulation, not any company's real filter.

// Reads the PDF like an ATS: text in reading order, line by line, plus signs of columns or tables.
export async function pdfText(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true }).promise;
  const lines = [];
  let splitLines = 0; // lines with a wide gap in the middle: two columns or a table
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const width = page.getViewport({ scale: 1 }).width;
    const rows = new Map(); // rounded y -> items on that line
    for (const item of (await page.getTextContent()).items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], w: item.width, s: item.str }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const items = rows.get(y).sort((a, b) => a.x - b.x);
      if (items.some((it, i) => i > 0 && it.x - (items[i - 1].x + items[i - 1].w) > width * 0.15)) splitLines++;
      lines.push(items.map((it) => it.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text: lines.join('\n'), lines, pages, splitLines };
}

// Skills recruiters search for, each with the spellings people write. `name` is the usual search wording.
const SKILLS = [
  ['JavaScript', /\bjavascript\b|\bes6\b/i], ['TypeScript', /\btypescript\b/i], ['React', /\breact(\.?js)?\b(?!\s*native)/i],
  ['React Native', /\breact\s*native\b/i], ['Next.js', /\bnext\.?js\b/i], ['Node.js', /\bnode(\.?js)?\b/i], ['Express', /\bexpress(\.?js)?\b/i],
  ['MongoDB', /\bmongo(db)?\b/i], ['Mongoose', /\bmongoose\b/i], ['Redux', /\bredux\b/i], ['Angular', /\bangular(js)?\b/i], ['Vue.js', /\bvue(\.?js)?\b/i],
  ['HTML', /\bhtml5?\b/i], ['CSS', /\bcss3?\b/i], ['Tailwind CSS', /\btailwind/i], ['Bootstrap', /\bbootstrap\b/i], ['SASS', /\bs[ac]ss\b/i],
  ['REST APIs', /\brestful\b|\brest\s*(apis?|services?)\b/i], ['GraphQL', /\bgraphql\b/i], ['WebSockets', /\bweb\s?sockets?\b|socket\.io/i], ['Microservices', /\bmicro-?services?\b/i],
  ['SQL', /\bsql\b/i], ['PostgreSQL', /\bpostgres(ql)?\b/i], ['MySQL', /\bmysql\b/i], ['Redis', /\bredis\b/i], ['Elasticsearch', /\belastic\s?search\b/i],
  ['Firebase', /\bfirebase\b/i], ['Prisma', /\bprisma\b/i], ['Kafka', /\bkafka\b/i], ['RabbitMQ', /\brabbitmq\b/i],
  ['AWS', /\baws\b|amazon web services/i], ['Azure', /\bazure\b/i], ['GCP', /\bgcp\b|google cloud/i], ['Docker', /\bdocker\b/i], ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['CI/CD', /\bci\s*\/\s*cd\b|continuous integration/i], ['GitHub Actions', /\bgithub actions\b/i], ['Jenkins', /\bjenkins\b/i], ['Linux', /\blinux\b/i], ['Nginx', /\bnginx\b/i],
  ['Git', /\bgit\b/i], ['Jest', /\bjest\b/i], ['Unit testing', /\bunit test(s|ing)?\b/i], ['Cypress', /\bcypress\b/i], ['Playwright', /\bplaywright\b/i],
  ['Python', /\bpython\b/i], ['Django', /\bdjango\b/i], ['Java', /\bjava\b(?!script)/i], ['Spring Boot', /\bspring\s*boot\b/i], ['Go', /\bgolang\b/i],
  ['PHP', /\bphp\b/i], ['C#', /\bc#|\.net\b/i], ['Webpack', /\bwebpack\b/i], ['Vite', /\bvite\b/i], ['JWT', /\bjwt\b/i], ['OAuth', /\boauth\b/i],
  ['System design', /\bsystem design\b/i], ['Data structures', /\bdata structures?\b|\bdsa\b/i], ['Agile', /\bagile\b|\bscrum\b/i], ['Figma', /\bfigma\b/i],
  ['LLM', /\bllms?\b|large language model/i], ['Generative AI', /\bgen(erative)?\s?ai\b/i], ['Machine learning', /\bmachine learning\b|\bml\b/i],
].map(([name, re]) => ({ name, re }));

export const skillsIn = (text) => SKILLS.filter((s) => s.re.test(text)).map((s) => s.name);

// Is this skill (any wording, known or not) in the text? Known skills use their spellings, others a whole-word match.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function hasSkill(text, skill) {
  const known = SKILLS.find((s) => s.re.test(skill) || s.name.toLowerCase() === skill.toLowerCase());
  if (known) return known.re.test(text);
  return new RegExp(`(^|[^a-z0-9])${escape(skill.replace(/\(.*?\)/g, '').trim())}($|[^a-z0-9])`, 'i').test(text);
}

// Recruiters type the usual wording ("Node.js"): a resume that only says "node" may not show up for it.
const wordingTip = (text, name) => (new RegExp(escape(name), 'i').test(text) ? null : `Write "${name}" the way recruiters search for it`);

const HEADINGS = {
  Experience: /^(work\s+)?experience|employment|work history|professional experience/i,
  Education: /^education|academic/i,
  Skills: /^(technical\s+)?skills|tech(nical)? stack|technologies/i,
};
const DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{1,2}\/\d{4}\b|\b(19|20)\d{2}\s*[-–—to]+\s*((19|20)\d{2}|present|current|now)\b/gi;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i;

// Step 1: can an ATS read it? Each finding is { level: 'ok' | 'warn' | 'fail', text }.
export function readability({ text, lines, pages, splitLines }, profileData) {
  const out = [];
  const add = (level, msg) => out.push({ level, text: msg });
  if (text.replace(/\s/g, '').length < 300) {
    add('fail', 'Almost no text could be read: this looks like a scanned or image PDF. Export it from Word or Google Docs instead.');
    return out;
  }
  add('ok', `Text is readable (${text.split(/\s+/).length} words, ${pages} page${pages > 1 ? 's' : ''}).`);
  if (pages > 2) add('warn', `${pages} pages: keep it to 1–2 pages; recruiters skim the first one.`);

  const name = profileData?.contact?.name;
  const top = lines.slice(0, 6).join(' ');
  if (name && !top.toLowerCase().includes(name.toLowerCase())) add('warn', `Your name ("${name}") isn't in the first lines, where an ATS looks for it.`);
  else add('ok', 'Name found at the top.');
  add(EMAIL.test(text) ? 'ok' : 'fail', EMAIL.test(text) ? 'Email found.' : 'No email address found: recruiters can’t contact you.');
  add(phonesIn(text).length ? 'ok' : 'warn', phonesIn(text).length ? 'Phone number found.' : 'No phone number found (write it like +91 98765 43210).');

  for (const [heading, re] of Object.entries(HEADINGS)) {
    const found = lines.some((l) => l.length < 40 && re.test(l));
    add(found ? 'ok' : 'warn', found ? `"${heading}" section found.` : `No clear "${heading}" heading: use the plain word so the ATS files your details correctly.`);
  }
  const dates = text.match(DATE) ?? [];
  if ((profileData?.experience?.length ?? 0) > 0 && dates.length < 2) add('warn', 'Few or no dates could be read. Write dates like "Jul 2023 – Present".');
  else add('ok', `${dates.length} dates readable.`);

  if (splitLines / lines.length > 0.2) {
    add('warn', 'Looks like two columns or a table: many ATSs read across the columns and mix your text up. A single column is safest.');
  }
  if (/[-]/.test(text)) add('warn', 'Icon symbols found (for phone, email, links): ATSs show these as junk characters. Use plain words.');
  return out;
}

// Step 4: the skills most asked for in your best-fit jobs, and whether your resume has each in recruiter wording.
export function searchTest(text, descriptions, top = 12) {
  const counts = new Map();
  for (const d of descriptions) for (const s of skillsIn(d)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([name, jobs]) => {
      const found = SKILLS.find((s) => s.name === name).re.test(text);
      return { name, jobs, found, tip: found ? wordingTip(text, name) : null };
    });
}

const SENIORITY = /\b(senior|sr|junior|jr|lead|principal|staff|associate|intern|trainee|i{1,3}|iv|\d+)\b|[^a-z\s]/gi;

// Steps 2 and 3 for one job: skills found and missing, title match, a match % (like Jobscan's), and filter risks.
//   match % = 70 for required skills + 20 for preferred + 10 for the job title appearing in your resume
export function jobMatch(text, req, job, { years, prefs, profileData }) {
  const required = req.required.length ? req.required : skillsIn(`${job.title}\n${job.description ?? ''}`); // nothing listed: the posting's own tech
  const split = (list) => ({ found: list.filter((s) => hasSkill(text, s)), missing: list.filter((s) => !hasSkill(text, s)) });
  const reqs = split(required);
  const prefd = split(req.preferred.filter((s) => !required.includes(s)));
  const titleWords = job.title.toLowerCase().replace(SENIORITY, ' ').split(/\s+/).filter((w) => w.length > 2);
  const titleFound = titleWords.length > 0 && titleWords.filter((w) => text.toLowerCase().includes(w)).length / titleWords.length >= 0.6;
  const share = (part, list) => (list.length ? part.length / list.length : 1);
  const score = Math.round(70 * share(reqs.found, required) + 20 * share(prefd.found, [...prefd.found, ...prefd.missing]) + (titleFound ? 10 : 0));

  const risks = [];
  if (req.minYears != null && years != null && years < req.minYears) {
    risks.push({ level: req.minYears - years >= 2 ? 'fail' : 'warn', text: `Asks for ${req.minYears}+ years; you have about ${years}. Many ATSs reject below the minimum.` });
  }
  if (req.minYears != null && years == null) risks.push({ level: 'warn', text: `Asks for ${req.minYears}+ years, and your resume dates don't show how many you have.` });
  if (req.degreeRequired && !profileData?.education?.length) risks.push({ level: 'warn', text: 'A degree is required and none is in your profile.' });
  const places = [...(prefs.cities ?? []), ...(prefs.countries ?? [])].map((p) => p.toLowerCase());
  const where = (job.locations ?? []).join(' ').toLowerCase();
  if (['onsite', 'hybrid'].includes(job.workMode) && places.length && !places.some((p) => where.includes(p))) {
    risks.push({ level: 'warn', text: `${job.workMode === 'onsite' ? 'On-site' : 'Hybrid'} in ${job.locations[0] ?? 'another city'}, not one of your places. A location question may filter you out.` });
  }
  if (!titleFound) risks.push({ level: 'warn', text: `The job title ("${job.title}") isn't in your resume. Recruiters often search by title: use it in your headline or summary if it fits.` });

  const tips = reqs.found.map((s) => SKILLS.find((k) => k.name === s) && wordingTip(text, s)).filter(Boolean);
  return { score, required: reqs, preferred: prefd, titleFound, risks, tips, minYears: req.minYears, degreeRequired: req.degreeRequired };
}
