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
    links: z.array(text).describe('LinkedIn, GitHub, portfolio and other URLs'),
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
