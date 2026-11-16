// Job descriptions are text written by strangers, and in Phase 3 they get sent to an AI.
// So: turn HTML into plain text, remove invisible characters, and flag lines that try to talk to an AI.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] !== '#' ? (NAMED[e.toLowerCase()] ?? m) : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)),
  );

// shortcut: regex tag stripping keeps text hidden with CSS (display:none); use a real HTML parser if flags show it matters.
export function htmlToText(html = '') {
  const s = decode(html) // Greenhouse escapes its HTML (&lt;p&gt;), so decode once to get real tags
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/ul)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(s); // the text's own entities (&amp; inside the content)
}

// Phrases aimed at an AI rather than a job seeker.
const SUSPICIOUS = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts|rules)/i,
  /disregard (all |any |the )?(previous|prior|above) /i,
  /\b(system|developer) prompt\b/i,
  /\b(if you are|as) an? (ai|llm|language model|assistant)\b/i,
  /<\/?(system|instructions?|prompt)>/i,
];

export function sanitizeDescription(text = '') {
  const description = text
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '') // zero-width and direction-control characters
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n\n')
    .trim()
    .slice(0, 20_000);
  const flags = description
    .split('\n')
    .filter((line) => SUSPICIOUS.some((re) => re.test(line)))
    .map((line) => line.trim().slice(0, 200));
  return { description, flags };
}
