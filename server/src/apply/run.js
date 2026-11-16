import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../models/Job.js';
import { JobMatch } from '../models/JobMatch.js';
import { Profile } from '../models/Profile.js';
import { AutoApply } from '../models/AutoApply.js';
import { readPdf } from '../resume/storage.js';
import { formFor, launch, openForm, readForm, fillForm, CONFIRMED } from './form.js';
import { answerForm } from './answer.js';

// The work behind auto-apply, done in the background one form at a time per user:
//   prepare: open the form in a hidden browser, decide answers, fill it, screenshot it -> "prepared" (you review)
//   submit:  fill it again with your reviewed answers and press the company's Submit button -> "applied";
//            if it can't (a CAPTCHA, or a required answer still blank), a visible window opens for you -> "opened"

export const DAILY_APPLY_LIMIT = Number(process.env.DAILY_APPLY_LIMIT) || 15;
const queues = new Map(); // userId -> Promise chain, so one user's forms are handled one after another

export function enqueue(userId, task) {
  const next = (queues.get(userId) ?? Promise.resolve()).then(task).catch((err) => console.error('Auto-apply task failed:', err.message));
  queues.set(userId, next);
  return next;
}

async function fail(id, err) {
  const app = await AutoApply.findById(id);
  if (!app) return;
  Object.assign(app, { status: 'failed', error: String(err.message ?? err).slice(0, 300) });
  await app.save();
}

// The resume PDF from your Profile, as a file the browser can upload.
async function resumeFile(profile) {
  if (!profile?.resumePdf?.id) throw new Error('Upload your resume PDF on the Profile page first');
  const dir = await mkdtemp(join(tmpdir(), 'jt-apply-'));
  const file = join(dir, `${(profile.data?.contact?.name || 'Resume').replace(/[^\w .-]+/g, '')} - Resume.pdf`);
  await writeFile(file, await readPdf(profile.resumePdf.id));
  return file;
}

// Marks the jobs "preparing" at once (so the page shows them), then fills them one by one.
export async function queuePrepare(userId, matchIds) {
  const matches = await JobMatch.find({ _id: { $in: matchIds }, userId }).populate('jobId', 'title company url applyUrl');
  const queued = [];
  const skipped = [];
  for (const m of matches) {
    const form = m.jobId && formFor(m.jobId);
    if (!form) {
      skipped.push({ job: m.jobId?.title, reason: 'Not on a Greenhouse, Lever or Ashby form' });
      continue;
    }
    const app = (await AutoApply.findOne({ userId, jobId: m.jobId._id })) ?? new AutoApply({ userId, jobId: m.jobId._id });
    if (['applied', 'submitting', 'preparing'].includes(app.status) && !app.isNew) {
      skipped.push({ job: m.jobId.title, reason: app.status === 'applied' ? 'Already applied' : 'Already in progress' });
      continue;
    }
    Object.assign(app, { matchId: m._id, company: m.jobId.company, title: m.jobId.title, formUrl: form.url, ats: form.ats, status: 'preparing', error: undefined });
    await app.save();
    queued.push(app._id);
    enqueue(userId, () => prepareOne(app._id).catch((err) => fail(app._id, err)));
  }
  return { queued: queued.length, skipped };
}

async function prepareOne(id) {
  const app = await AutoApply.findById(id).populate('jobId', 'title company locations');
  const profile = await Profile.findOne({ userId: app.userId });
  if (!profile?.data) throw new Error('Upload your resume on the Profile page first');
  const resumePath = await resumeFile(profile);
  const browser = await launch(true);
  try {
    const page = await openForm(browser, app.formUrl);
    const questions = await readForm(page);
    if (!questions.length) throw new Error('No application form found on that page (the job may be closed)');
    const fields = await answerForm(questions, { profile: profile.data, answers: profile.applyAnswers, job: app.jobId });
    const missed = await fillForm(page, fields, resumePath);
    for (const f of fields) if (missed.includes(f.id)) f.needsYou = true;
    app.screenshot = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 60 });
    Object.assign(app, { fields, status: 'prepared', jobId: app.jobId._id });
    await app.save();
  } finally {
    await browser.close();
  }
}

// Marks them "submitting", then submits one by one.
export async function queueSubmit(userId, ids) {
  const today = await AutoApply.countDocuments({ userId, status: { $in: ['submitting', 'opened', 'applied'] }, updatedAt: { $gt: new Date(Date.now() - 86_400_000) } });
  const apps = await AutoApply.find({ _id: { $in: ids }, userId, status: { $in: ['prepared', 'opened', 'failed'] }, 'fields.0': { $exists: true } });
  const allowed = apps.slice(0, Math.max(0, DAILY_APPLY_LIMIT - today));
  for (const app of allowed) {
    app.status = 'submitting';
    app.error = undefined;
    await app.save();
    enqueue(userId, () => submitOne(app._id).catch((err) => fail(app._id, err)));
  }
  return { queued: allowed.length, overLimit: apps.length - allowed.length, dailyLimit: DAILY_APPLY_LIMIT };
}

const blankRequired = (app) => app.fields.filter((f) => f.required && f.kind !== 'file' && (f.value == null || f.value === '' || (Array.isArray(f.value) && !f.value.length)));

async function submitOne(id) {
  const app = await AutoApply.findById(id);
  const profile = await Profile.findOne({ userId: app.userId });
  const resumePath = await resumeFile(profile);
  // A required answer is still blank: the company's form would reject it, so hand it to you.
  if (blankRequired(app).length) return openForYou(app, resumePath, `${blankRequired(app).length} required question(s) still need your answer`);

  const browser = await launch(true);
  let reason;
  try {
    const page = await openForm(browser, app.formUrl);
    await readForm(page);
    await fillForm(page, app.fields, resumePath);
    await page.waitForTimeout(1500); // uploads finish
    const captcha = await page.locator('iframe[src*="recaptcha/api2/anchor"], iframe[src*="hcaptcha"], iframe[title*="challenge" i]').count();
    const submit = page.getByRole('button', { name: /submit( your)? application|^submit$|^apply( now)?$/i }).last();
    if (!(await submit.count())) reason = 'No Submit button found';
    else {
      await submit.click({ timeout: 10_000 });
      // the confirmation page, or nothing (validation errors, an invisible CAPTCHA challenge…)
      const confirmed = await page
        .waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), CONFIRMED.source, { timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      if (confirmed) {
        Object.assign(app, { status: 'applied', appliedAt: new Date(), confirmation: await page.screenshot({ type: 'jpeg', quality: 60 }) });
        await app.save();
        return;
      }
      reason = captcha ? 'The form asked for a CAPTCHA' : 'The form did not confirm (it may show an error or a CAPTCHA)';
    }
  } finally {
    await browser.close();
  }
  return openForYou(app, resumePath, reason);
}

// Fallback: a visible window with the form filled; you finish it and press Submit. The "thank you" page marks it applied.
// shortcut: the window opens on the computer running the server (your PC); a hosted server needs another way.
async function openForYou(app, resumePath, reason) {
  const browser = await launch(false);
  const page = await openForm(browser, app.formUrl);
  await readForm(page);
  await fillForm(page, app.fields, resumePath);
  Object.assign(app, { status: 'opened', error: `${reason}. A window opened: finish it and press Submit.` });
  await app.save();
  watchForConfirmation(browser, page, app._id).catch((err) => console.error('Apply window watcher:', err.message));
}

async function watchForConfirmation(browser, page, id) {
  const until = Date.now() + 30 * 60_000;
  while (Date.now() < until && browser.isConnected() && !page.isClosed()) {
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (CONFIRMED.test(text)) {
      const confirmation = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => undefined);
      const app = await AutoApply.findById(id);
      Object.assign(app, { status: 'applied', appliedAt: new Date(), confirmation, error: undefined });
      await app.save();
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (Date.now() >= until) await browser.close().catch(() => {});
}

// "Open to submit" by hand (any status but applied).
export async function openNow(app) {
  const profile = await Profile.findOne({ userId: app.userId });
  await openForYou(app, await resumeFile(profile), 'Opened by you');
}

// A restart stops the background queue: anything mid-way is marked failed so you can retry it.
export const recoverInterrupted = () =>
  AutoApply.updateMany({ status: { $in: ['preparing', 'submitting'] } }, { $set: { status: 'failed', error: 'Interrupted by a server restart; try again' } });
