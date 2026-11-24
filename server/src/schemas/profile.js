import { z } from 'zod';

// The single definition of what a profile looks like. It is used twice:
// 1. sent to Gemini as a JSON schema, so the AI must answer in exactly this shape;
// 2. used to validate data before saving (AI output and edits from the browser are both untrusted).
// Every field is required; a missing value is "" or [], which keeps the shape predictable.
const text = z.string();
const date = z.string().describe('As written in the resume, e.g. "Jan 2022", "2022" or "Present"; "" if missing');

export const ProfileSchema = z.object({
  contact: z.object({
    name: text,
    email: text,
    phone: text,
    location: text,
    // default: profiles saved before these fields existed still validate
    linkedin: text.default('').describe('LinkedIn profile URL, or ""'),
    github: text.default('').describe('GitHub profile URL, or ""'),
    portfolio: text.default('').describe('Personal website or portfolio URL, or ""'),
    links: z.array(text).describe('Any other URLs (not LinkedIn, GitHub or portfolio)'),
  }),
  headline: text.describe('Short professional title, e.g. "Full Stack Developer"'),
  summary: text,
  experience: z.array(
    z.object({
      company: text,
      title: text,
      location: text,
      startDate: date,
      endDate: date,
      bullets: z.array(text),
    }),
  ),
  education: z.array(
    z.object({
      institution: text,
      degree: text,
      field: text,
      startDate: date,
      endDate: date,
      grade: text,
    }),
  ),
  skills: z.array(text),
  projects: z.array(
    z.object({
      name: text,
      description: text,
      link: text,
      tech: z.array(text),
      bullets: z.array(text),
    }),
  ),
  certifications: z.array(text),
});

// Older profiles kept every URL in `links`: move LinkedIn / GitHub / the first other URL into their own fields.
export function withNamedLinks(data) {
  const c = data?.contact;
  if (!c) return data;
  const rest = [...(c.links ?? [])];
  const take = (current, re) => {
    if (current) return current;
    const i = rest.findIndex((l) => re.test(l));
    return i < 0 ? '' : rest.splice(i, 1)[0];
  };
  const linkedin = take(c.linkedin, /linkedin\.com/i);
  const github = take(c.github, /github\.com/i);
  const portfolio = take(c.portfolio, /./);
  return { ...data, contact: { ...c, linkedin, github, portfolio, links: rest } };
}

// Every link, named ones first: for email signatures and the AI.
export const allLinks = (c = {}) => [...new Set([c.linkedin, c.github, c.portfolio, ...(c.links ?? [])].filter(Boolean))];
