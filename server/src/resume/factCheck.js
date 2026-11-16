// Fact check: lists anything in a resume that isn't in your own history (your Profile and what you uploaded).
// It doesn't block: your own edits can add true things. It makes sure nothing unverified slips in unnoticed,
// whether the AI wrote it or a typo did.

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const flat = (v) => (Array.isArray(v) ? v.flatMap(flat) : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : v ? [String(v)] : []);

export function factIssues(content, sources) {
  const known = norm(sources.flatMap(flat).join(' \n '));
  const knownNumbers = new Set(known.match(/\d+(?:[.,]\d+)?/g) ?? []);
  const issues = [];
  const check = (path, text, reason) => {
    if (text && !known.includes(norm(text))) issues.push({ path, text, reason });
  };

  (content.experience ?? []).forEach((e, i) => {
    check(`experience.${i}.company`, e.company, 'Employer not in your history');
    check(`experience.${i}.title`, e.title, 'Job title not in your history');
  });
  (content.education ?? []).forEach((e, i) => {
    check(`education.${i}.institution`, e.institution, 'Institution not in your history');
    check(`education.${i}.degree`, e.degree, 'Degree not in your history');
  });
  (content.certifications ?? []).forEach((c, i) => check(`certifications.${i}`, c, 'Certification not in your history'));
  (content.skills ?? []).forEach((s, i) => check(`skills.${i}`, s, 'Skill not in your history'));

  // Numbers in summary and bullets ("40%", "2M requests") must come from you, not be made up.
  const prose = [
    ['summary', content.summary],
    ...(content.experience ?? []).flatMap((e, i) => (e.bullets ?? []).map((b, j) => [`experience.${i}.bullets.${j}`, b])),
    ...(content.projects ?? []).flatMap((p, i) => (p.bullets ?? []).map((b, j) => [`projects.${i}.bullets.${j}`, b])),
  ];
  for (const [path, text] of prose) {
    for (const n of String(text ?? '').match(/\d+(?:[.,]\d+)?/g) ?? []) {
      if (!knownNumbers.has(n)) issues.push({ path, text: n, reason: 'Number not in your history' });
    }
    if (/\[[^\]]*\]/.test(text ?? '')) issues.push({ path, text: text.match(/\[[^\]]*\]/)[0], reason: 'Placeholder still to fill in' });
  }
  return issues;
}
