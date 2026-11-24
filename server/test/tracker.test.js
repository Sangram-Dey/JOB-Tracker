import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCard, classify } from '../src/tracker/inbox.js';
import { isForward } from '../src/tracker/track.js';
import { summaryEmail } from '../src/tracker/summary.js';

const cards = [
  { company: 'Acme Corp', to: 'priya@acme.io', messageId: '<abc123@gmail.com>' },
  { company: 'Splitero', kind: 'form' },
  { company: 'Gmail Person', to: 'hr.someone@gmail.com' },
];
const msg = (m) => ({ fromName: '', subject: '', refs: [], ...m });

test('a reply is matched by thread, sender, company domain or ATS sender', () => {
  assert.equal(matchCard(msg({ from: 'x@other.com', refs: ['<ABC123@gmail.com>'] }), cards), cards[0]); // reply to your email
  assert.equal(matchCard(msg({ from: 'Priya@Acme.io' }), cards), cards[0]); // the HR person
  assert.equal(matchCard(msg({ from: 'talent@acme.io' }), cards), cards[0]); // someone else at the company
  assert.equal(matchCard(msg({ from: 'no-reply@greenhouse.io', subject: 'Thank you for applying to Splitero' }), cards), cards[1]);
  assert.equal(matchCard(msg({ from: 'friend@gmail.com' }), cards), null); // gmail.com is not a company domain
  assert.equal(matchCard(msg({ from: 'no-reply@greenhouse.io', subject: 'Your application to Other Co' }), cards), null);
  assert.equal(matchCard(msg({ from: 'news@random.com', subject: 'Splitero news' }), cards), null); // company name only counts from ATS senders
});

test('replies are sorted by their words', () => {
  assert.equal(classify('Unfortunately we have decided to move forward with other candidates'), 'rejected');
  assert.equal(classify('Thank you for applying! We would like to schedule a call — share your availability'), 'interview');
  assert.equal(classify('Thanks for applying. If your profile matches, we will contact you for an interview.'), 'applied');
  assert.equal(classify('We are pleased to offer you the role. Offer letter attached.'), 'offer');
  assert.equal(classify('Please complete the technical assessment by Friday'), 'interview');
  assert.equal(classify('Hey, got your email, will check with the team'), null);
});

test('the inbox only moves cards forward', () => {
  assert.equal(isForward('applied', 'replied'), true);
  assert.equal(isForward('interview', 'rejected'), true);
  assert.equal(isForward('interview', 'replied'), false);
  assert.equal(isForward('offer', 'rejected'), false);
});

test('the summary email lists only what is waiting', () => {
  const { text } = summaryEmail({ newJobs: 3, emailsReady: 0, appsReady: 2, newReplies: 1, interviews: 0, appliedThisWeek: 5 }, 'http://x');
  assert.match(text, /1 new reply/);
  assert.match(text, /2 applications/);
  assert.doesNotMatch(text, /HR emails ready/);
});
