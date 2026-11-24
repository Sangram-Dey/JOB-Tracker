import { allLinks } from '../schemas/profile.js';

// Email bodies are written in a tiny format you can edit as plain text:
//   blank line = new paragraph, "- " at the start of a line = bullet, **words** = bold.
// They go out as HTML (formatted) with a plain-text copy for mail apps that don't show HTML.
// The signature is added here from your Profile, so it's always correct and never written by the AI.

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bold = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const href = (link) => (/^https?:\/\//i.test(link) ? link : `https://${link}`);

export function signatureOf(profile) {
  const c = profile?.contact ?? {};
  return { name: c.name, line: [c.phone, c.email].filter(Boolean).join(' · '), links: allLinks(c).slice(0, 3) };
}

export function toHtml(body, profile) {
  const blocks = body.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-•*]\s+/.test(l))) return `<ul style="margin:0 0 12px;padding-left:20px">${lines.map((l) => `<li>${bold(escape(l.replace(/^[-•*]\s+/, '')))}</li>`).join('')}</ul>`;
    return `<p style="margin:0 0 12px">${lines.map((l) => bold(escape(l))).join('<br>')}</p>`;
  });
  const sig = signatureOf(profile);
  const signature = [
    sig.name && `<b>${escape(sig.name)}</b>`,
    sig.line && escape(sig.line),
    sig.links.length && sig.links.map((l) => `<a href="${escape(href(l))}" style="color:#2563eb">${escape(l.replace(/^https?:\/\/(www\.)?/i, ''))}</a>`).join(' · '),
  ].filter(Boolean);
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;max-width:600px">` +
    blocks.join('') +
    (signature.length ? `<p style="margin:16px 0 0;color:#4b5563">${signature.join('<br>')}</p>` : '') +
    `</div>`
  );
}

export function toText(body, profile) {
  const sig = signatureOf(profile);
  const signature = [sig.name, sig.line, ...sig.links].filter(Boolean).join('\n');
  return `${body.trim().replace(/\*\*(.+?)\*\*/g, '$1')}${signature ? `\n\n${signature}` : ''}`;
}
