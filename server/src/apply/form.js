import { chromium } from 'playwright-core';

// Opens an application form, reads its questions, and fills them. Works on Greenhouse, Lever and Ashby forms,
// which need no login. It never presses Submit: you do that yourself in the visible window (apply/session.js).
// Uses the Edge already installed on Windows; on a Linux server set APPLY_BROWSER_CHANNEL=chromium after
// `npx playwright install chromium`.

const ATS = [
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['lever', /(^|\.)lever\.co$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
];

// The form's address for a job, or null when the job isn't on a supported form. Only these three hosts are ever
// opened, so a job's link can't send the browser anywhere else.
export function formFor(job) {
  for (const link of [job.applyUrl, job.url]) {
    let u;
    try {
      u = new URL(link);
    } catch {
      continue;
    }
    const ats = ATS.find(([, re]) => re.test(u.hostname))?.[0];
    if (!ats || u.protocol !== 'https:') continue;
    const path = u.pathname.replace(/\/$/, '');
    if (ats === 'lever' && !path.endsWith('/apply')) return { ats, url: `${u.origin}${path}/apply` };
    if (ats === 'ashby' && !path.endsWith('/application')) return { ats, url: `${u.origin}${path}/application` };
    return { ats, url: `${u.origin}${path}${ats === 'greenhouse' ? u.search.replace(/[?&]utm_[^&]*/g, '').replace(/^&/, '?') : ''}` };
  }
  return null;
}

export const launch = (headless) => chromium.launch({ channel: process.env.APPLY_BROWSER_CHANNEL || 'msedge', headless });

export async function openForm(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}); // forms are built by scripts
  return page;
}

// Runs inside the page: every question on the form, each tagged with data-jt="<n>" so it can be filled later.
function readFormInPage() {
  const clean = (s) => (s ?? '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim().slice(0, 300);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return clean(l.innerText);
    }
    const by = el.getAttribute('aria-labelledby');
    if (by) return clean(by.split(' ').map((id) => document.getElementById(id)?.innerText ?? '').join(' '));
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const box = el.closest('fieldset, .field, .application-question, [class*=question], [class*=Field], [class*=field]');
    const text = box?.querySelector('legend, label, .application-label, [class*=label], [class*=Label]')?.innerText;
    return clean(text || el.placeholder || el.name);
  };
  const fields = [];
  let n = 0;
  const seenGroups = new Set();
  for (const el of document.querySelectorAll('input, textarea, select, [role=combobox]')) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'search', 'image', 'reset'].includes(type) || el.name === 'g-recaptcha-response' || el.name?.startsWith('h-captcha')) continue;
    const required = el.required || el.getAttribute('aria-required') === 'true';
    if (type === 'radio' || type === 'checkbox') {
      if (seenGroups.has(el.name)) continue;
      seenGroups.add(el.name);
      const group = el.name ? [...document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)] : [el];
      const box = el.closest('fieldset, [role=radiogroup], [role=group], .application-question, [class*=question], [class*=Field]');
      const question = clean(box?.querySelector('legend, .application-label, [class*=label], [class*=Label], label')?.innerText);
      const options = group.map((g, i) => {
        g.setAttribute('data-jt', `${n}:${i}`);
        return labelOf(g) || clean(g.closest('label')?.innerText) || g.value;
      });
      fields.push({ id: String(n++), kind: type, label: question || options.join(' / '), required, options });
      continue;
    }
    if (type === 'file') {
      // upload buttons are often just labelled "Attach": the nearest heading says whether it's the resume or cover letter
      let label = '';
      for (let a = el.parentElement, i = 0; a && i < 5 && !label; a = a.parentElement, i++) {
        label = a.innerText?.match(/resume|\bcv\b|cover letter/i)?.[0] ?? '';
      }
      el.setAttribute('data-jt', String(n));
      fields.push({ id: String(n++), kind: 'file', label: clean(label || labelOf(el)).slice(0, 80), required, options: [] });
      continue;
    }
    if (!visible(el) && el.getAttribute('role') !== 'combobox') continue; // hidden twins of custom dropdowns
    const kind = el.getAttribute('role') === 'combobox' ? 'combobox' : el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : 'text';
    el.setAttribute('data-jt', String(n));
    const options = kind === 'select' ? [...el.options].map((o) => clean(o.text)).filter((t) => t && !/^(select|choose|please select|--)/i.test(t)) : [];
    fields.push({ id: String(n++), kind, label: labelOf(el), required, options });
  }
  return fields;
}

// Reads the questions. Custom dropdowns only show their choices when opened, so each is opened and closed once.
export async function readForm(page) {
  const fields = await page.evaluate(readFormInPage);
  for (const f of fields.filter((x) => x.kind === 'combobox')) {
    try {
      const box = page.locator(`[data-jt="${f.id}"]`);
      await box.click({ timeout: 3000 });
      await page.waitForTimeout(300);
      // only this dropdown's list: other lists (like the phone country picker) can sit in the page all the time
      const list = await box.getAttribute('aria-controls');
      const options = list ? page.locator(`[id="${list}"] [role=option]`) : page.locator('[role=option]:visible');
      f.options = (await options.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      if (f.options.length > 40) f.options = []; // long lists (countries) are searchable: the answer is typed, not picked
      await page.keyboard.press('Escape');
    } catch {
      f.options = [];
    }
  }
  return fields.filter((f) => f.label || f.kind === 'file');
}

// Fills every answered field. Returns the ids it couldn't fill (left for you).
export async function fillForm(page, fields, resumePath) {
  const missed = [];
  for (const f of fields) {
    const v = f.value;
    if (f.kind !== 'file' && (v == null || v === '' || (Array.isArray(v) && !v.length))) continue;
    const el = page.locator(`[data-jt="${f.id}"]`);
    try {
      if (f.kind === 'file') {
        if (f.source === 'resume' && resumePath) await el.setInputFiles(resumePath);
      } else if (f.kind === 'text' || f.kind === 'textarea') await el.fill(String(v));
      else if (f.kind === 'select') await el.selectOption({ label: String(v) });
      else if (f.kind === 'combobox') {
        await el.click({ timeout: 3000 });
        await el.pressSequentially(String(v).slice(0, 60), { delay: 20 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
      } else {
        const wanted = [v].flat().map((x) => String(x).toLowerCase());
        for (const [i, option] of f.options.entries()) {
          if (wanted.includes(option.toLowerCase())) await page.locator(`[data-jt="${f.id}:${i}"]`).check({ force: true });
        }
      }
    } catch {
      missed.push(f.id);
    }
  }
  return missed;
}

// The company's "thank you" page after you press Submit.
export const CONFIRMED = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully submitted/i;
