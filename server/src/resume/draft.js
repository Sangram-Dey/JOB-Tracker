import { factIssues } from './factCheck.js';
import { skillsIn, hasSkill } from './atsCheck.js';

// The resume you edit on the Resume page: your structured profile, read as text the way an ATS would read the
// PDF this app exports, plus format checks done in plain code (free, instant, the same every time).

const DATES = (e) => [e.startDate, e.endDate].filter(Boolean).join(' – ');
const join = (parts, sep = ' | ') => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(sep);
const contactLine = (c = {}) => join([c.email, c.phone, c.location, c.linkedin, c.github, c.portfolio, ...(c.links ?? [])]);

// Same order and wording as the PDF (resumeHtml), so the live score matches what an ATS reads from the export.
export function resumeText(d) {
  const out = [d.contact?.name, d.headline, contactLine(d.contact)];
  if (d.summary) out.push('Summary', d.summary);
  if (d.skills?.length) out.push('Skills', d.skills.join(', '));
  if (d.experience?.length) out.push('Experience');
  for (const e of d.experience ?? []) out.push(join([join([e.title, e.company], ', '), e.location, DATES(e)]), ...(e.bullets ?? []));
  if (d.projects?.length) out.push('Projects');
  for (const p of d.projects ?? []) out.push(join([p.name, p.tech?.join(', '), p.link]), p.description, ...(p.bullets ?? []));
  if (d.education?.length) out.push('Education');
  for (const e of d.education ?? []) out.push(join([join([e.degree, e.field], ', '), e.institution, DATES(e), e.grade]));
  if (d.certifications?.length) out.push('Certifications', ...d.certifications);
  return out.filter((l) => String(l ?? '').trim()).join('\n');
}

// "[X]%", "[N] users": numbers the AI left for you to fill in. Never exported or saved as if real.
export const PLACEHOLDER = /\[(?:X|N|\d*\s*X)[^\]]{0,12}\]/i;
export function placeholdersIn(d) {
  const found = [];
  const walk = (v, path) => {
    if (typeof v === 'string') PLACEHOLDER.test(v) && found.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(d, '');
  return found;
}

export function getPath(obj, path) {
  return path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
}
function setPath(obj, [k, ...rest], value) {
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[k] = rest.length ? setPath(obj[k], rest, value) : value;
  return copy;
}

const WEAK = /^(responsible for|worked on|helped|assisted|involved in|duties included|tasked with)\b/i;
const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean).length;

// Format checks on the content itself. Each finding is { level: 'ok' | 'warn' | 'fail', text } like readability().
export function draftChecks(d) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const c = d.contact ?? {};
  if (!c.name) add('fail', 'Add your name: an ATS reads it from the first line.');
  add(c.email ? 'ok' : 'fail', c.email ? 'Email is there.' : 'Add your email: recruiters can’t contact you without it.');
  add(c.phone ? 'ok' : 'warn', c.phone ? 'Phone is there.' : 'Add a phone number, written like +91 98765 43210.');

  const sw = words(d.summary);
  if (!sw) add('warn', 'No summary: 2–3 lines with your role, years and main stack help recruiters and ATS searches.');
  else if (sw > 80) add('warn', `Summary is ${sw} words: keep it under 60–80 so it gets read.`);
  else add('ok', `Summary is ${sw} words.`);

  const skills = d.skills ?? [];
  if (skills.length < 6) add('warn', `Only ${skills.length} skills listed: list the tools you really use (6–25), named the way job posts write them.`);
  else if (skills.length > 30) add('warn', `${skills.length} skills: past ~25 it reads like keyword stuffing. Keep the ones you’d be happy to be asked about.`);
  else add('ok', `${skills.length} skills listed.`);

  const roles = d.experience ?? [];
  const bullets = [...roles.flatMap((e) => e.bullets ?? []), ...(d.projects ?? []).flatMap((p) => p.bullets ?? [])];
  roles.forEach((e) => {
    const name = e.company || e.title || 'A role';
    if (!e.startDate) add('warn', `${name}: add dates like "Jul 2023 – Present"; ATSs count your years from them.`);
    if (!e.bullets?.length) add('warn', `${name}: no bullet points. Add 2–5 lines on what you built and its result.`);
  });
  const long = bullets.filter((b) => words(b) > 35).length;
  if (long) add('warn', `${long} bullet${long > 1 ? 's are' : ' is'} over 35 words: split or shorten to 1–2 lines.`);
  const weak = bullets.filter((b) => WEAK.test(b.trim())).length;
  if (weak) add('warn', `${weak} bullet${weak > 1 ? 's start' : ' starts'} with "Responsible for" / "Worked on": start with a strong verb (Built, Cut, Led…).`);
  const noNumber = bullets.filter((b) => !/\d/.test(b)).length;
  if (bullets.length && noNumber / bullets.length > 0.6) add('warn', `${noNumber} of ${bullets.length} bullets have no number. Add a real result (users, %, time saved) where you know it.`);
  else if (bullets.length) add('ok', `${bullets.length - noNumber} of ${bullets.length} bullets show a measurable result.`);

  const total = words(resumeText(d));
  if (total > 900) add('warn', `About ${total} words: likely over 2 pages. Cut older or weaker lines.`);
  else add('ok', `About ${total} words: ${total > 500 ? '1–2 pages' : '1 page'}.`);
  const ph = placeholdersIn(d).length;
  if (ph) add('fail', `${ph} placeholder${ph > 1 ? 's' : ''} like [X]% still to fill in with a real number, or remove.`);
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const list = (items) => (items?.filter((b) => b.trim()).length ? `<ul>${items.filter((b) => b.trim()).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '');
const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');

// One column, standard headings, a common font, real text, no tables, icons or images: what every ATS reads cleanly.
// Dates sit on the same line as the role (not right-aligned in a second column) so the text never splits into columns.
export function resumeHtml(d) {
  const c = d.contact ?? {};
  const head = (bold, rest) => `<p class="item"><b>${esc(bold)}</b>${rest ? ` | ${esc(rest)}` : ''}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.name)} Resume</title><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0; } .headline { font-size: 11.5pt; margin: 2px 0 0; } .contact { margin: 4px 0 0; font-size: 9.5pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #555; margin: 12px 0 4px; padding-bottom: 2px; }
  p { margin: 2px 0; } .item { margin-top: 6px; } ul { margin: 2px 0 0; padding-left: 16px; } li { margin: 1px 0; }
  a { color: inherit; text-decoration: none; }
  </style></head><body>
  <h1>${esc(c.name)}</h1>${d.headline ? `<p class="headline">${esc(d.headline)}</p>` : ''}
  <p class="contact">${esc(contactLine(c))}</p>
  ${section('Summary', d.summary && `<p>${esc(d.summary)}</p>`)}
  ${section('Skills', d.skills?.length && `<p>${esc(d.skills.join(', '))}</p>`)}
  ${section('Experience', (d.experience ?? []).map((e) => head(join([e.title, e.company], ', '), join([e.location, DATES(e)])) + list(e.bullets)).join(''))}
  ${section('Projects', (d.projects ?? []).map((p) => head(p.name, join([p.tech?.join(', '), p.link])) + (p.description ? `<p>${esc(p.description)}</p>` : '') + list(p.bullets)).join(''))}
  ${section('Education', (d.education ?? []).map((e) => head(join([e.degree, e.field], ', '), join([e.institution, DATES(e), e.grade]))).join(''))}
  ${section('Certifications', list(d.certifications))}
  </body></html>`;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// AI output is untrusted: keep only edits that point at a real text field (with its real current text) or add to a
// list of text, and attach anything the fact check can't find in your history. kind: 'rewrite' | 'add'.
export function checkSuggestions(list, data, history) {
  const out = [];
  for (const s of list) {
    if (!/^[a-z]+(\.[a-z0-9]+)*$/i.test(s.path)) continue; // letters, digits and dots only: no __proto__
    const at = getPath(data, s.path);
    let kind;
    if (typeof at === 'string') {
      if (s.before && norm(s.before) !== norm(at)) continue; // the AI misread which field it is
      if (norm(s.after) === norm(at)) continue;
      kind = 'rewrite';
    } else if (Array.isArray(at) && at.every((x) => typeof x === 'string')) {
      if (at.some((x) => norm(x) === norm(s.after))) continue; // already there
      kind = 'add';
    } else continue;
    // checked as prose (numbers, placeholders) and, for skills, as a skill
    const probe = s.path.startsWith('skills') ? { skills: [s.after] } : { summary: s.after };
    const warnings = factIssues(probe, [history]).map((i) => `${i.reason}: ${i.text}`);
    out.push({ ...s, before: kind === 'rewrite' ? at : '', kind, warnings, needsConfirmation: s.needsConfirmation || warnings.length > 0 });
  }
  return out;
}

// Auto-apply tailoring: applies only the edits that need no human check. No warning, no [X], nothing the AI marked
// "confirm", and no tool or skill your history doesn't show. Returns the new resume and the list of what changed.
export function applySafe(data, suggestions, historyText) {
  let out = data;
  const changes = [];
  for (const s of suggestions) {
    if (s.needsConfirmation || s.warnings.length || PLACEHOLDER.test(s.after)) continue;
    if (skillsIn(s.after).some((k) => !hasSkill(historyText, k))) continue;
    const at = getPath(out, s.path);
    if (s.kind === 'rewrite' && (typeof at !== 'string' || norm(at) !== norm(s.before))) continue; // an earlier edit changed it
    if (s.kind === 'add' && !Array.isArray(at)) continue;
    out = setPath(out, s.path.split('.'), s.kind === 'add' ? [...at, s.after] : s.after);
    changes.push({ path: s.path, kind: s.kind, before: s.before, after: s.after, reason: s.reason, keyword: s.keyword ?? '' });
  }
  return { data: out, changes };
}

// Applies a saved list of changes again, in order, skipping any whose line has changed since: used to undo one change.
export function replayChanges(data, changes) {
  let out = data;
  for (const c of changes) {
    const at = getPath(out, c.path);
    if (c.kind === 'add' && Array.isArray(at)) out = setPath(out, c.path.split('.'), [...at, c.after]);
    else if (c.kind === 'rewrite' && typeof at === 'string' && norm(at) === norm(c.before)) out = setPath(out, c.path.split('.'), c.after);
  }
  return out;
}

// What tailoring did to the job's keywords. was / now: jobMatch() of the original resume and the tailored one.
//   added: in the job, missing before, there now. strengthened: already there, and worked into more lines.
//   missing: still not there: not in your history, so left out on purpose.
export function keywordReport(was, now, changes) {
  const found = (r) => [...r.required.found, ...r.preferred.found];
  const before = new Set(found(was));
  const added = found(now).filter((k) => !before.has(k));
  const touched = new Set(changes.map((c) => c.keyword?.toLowerCase()).filter(Boolean)); // the AI's spelling may differ in case
  const strengthened = found(was).filter((k) => touched.has(k.toLowerCase()));
  return { added, strengthened, missing: [...now.required.missing, ...now.preferred.missing] };
}
