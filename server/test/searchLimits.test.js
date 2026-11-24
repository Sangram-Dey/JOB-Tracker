import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairShare, isPaid } from '../src/jobs/scrape.js';
import * as jsearch from '../src/sources/jsearch.js';
import * as apify from '../src/sources/apify.js';
import * as freehire from '../src/sources/freehire.js';
import { remotive } from '../src/sources/remoteFeeds.js';

test('only budgeted sources count as paid (run by the 6-hour schedule only)', () => {
  assert.equal(isPaid(jsearch), true);
  assert.equal(isPaid(apify), true);
  assert.equal(isPaid(freehire), false);
  assert.equal(isPaid(remotive), false);
  assert.equal(freehire.minGapMs, 3600_000); // free sources: once an hour
});

test('a shared monthly budget is split fairly between active users', () => {
  assert.equal(fairShare(150, new Map(), 'a'), 150); // alone: all of it
  assert.equal(fairShare(150, new Map([['b', 10]]), 'a'), 75); // two users: half each
  assert.equal(fairShare(150, new Map([['a', 70], ['b', 10]]), 'a'), 5); // 75 share, 70 used
  assert.equal(fairShare(60, new Map([['a', 0], ['b', 30], ['c', 25]]), 'a'), 5); // only 5 left overall
  assert.equal(fairShare(60, new Map([['a', 40]]), 'a'), 20);
  assert.equal(fairShare(10, new Map([['a', 20]]), 'a'), 0); // never negative
});
