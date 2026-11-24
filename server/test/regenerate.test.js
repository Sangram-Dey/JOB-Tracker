import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSections } from '../src/resume/tailorJob.js';
import { withBusyRetry } from '../src/ai/gemini.js';

test('Remodify can be limited to chosen sections', () => {
  assert.equal(inSections('summary', ['summary']), true);
  assert.equal(inSections('headline', ['summary']), true);
  assert.equal(inSections('experience.0.bullets.2', ['experience']), true);
  assert.equal(inSections('projects.1.description', ['experience']), false);
  assert.equal(inSections('skills', ['skills', 'projects']), true);
  assert.equal(inSections('experience.0.bullets.0', []), true); // no choice = everything
});

test('a busy Gemini is tried once more; other errors are not', async () => {
  let calls = 0;
  let told = false;
  const busyOnce = () => (++calls === 1 ? Promise.reject(Object.assign(new Error('busy'), { busy: true })) : Promise.resolve('ok'));
  assert.equal(await withBusyRetry(busyOnce, { waitMs: 1, onBusy: () => (told = true) }), 'ok');
  assert.equal(calls, 2);
  assert.equal(told, true);

  calls = 0;
  const broken = () => (calls++, Promise.reject(new Error('bad request')));
  await assert.rejects(withBusyRetry(broken, { waitMs: 1 }), /bad request/);
  assert.equal(calls, 1);

  calls = 0;
  const alwaysBusy = () => (calls++, Promise.reject(Object.assign(new Error('busy'), { busy: true })));
  await assert.rejects(withBusyRetry(alwaysBusy, { waitMs: 1 }), /busy/);
  assert.equal(calls, 2); // one retry only
});
