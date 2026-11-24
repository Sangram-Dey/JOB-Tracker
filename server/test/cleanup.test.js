import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionsToKeep } from '../src/jobs/cleanup.js';

const v = (id) => ({ pdfId: id });

test('tailored versions: keeps the current one, the last two and any that was sent', () => {
  const versions = [v('a'), v('b'), v('c'), v('d'), v('e'), v('f')];
  // current is version 2 ("c"), "a" was sent: drop b and d
  assert.deepEqual(versionsToKeep(versions, 2, ['a']), { keep: [0, 2, 4, 5], current: 1 });
});

test('tailored versions: few versions or your original in use', () => {
  assert.deepEqual(versionsToKeep([v('a'), v('b')], 1, []), { keep: [0, 1], current: 1 });
  assert.deepEqual(versionsToKeep([v('a'), v('b'), v('c')], -1, []), { keep: [1, 2], current: -1 });
});
