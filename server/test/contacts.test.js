import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phonesIn } from '../src/jobs/contacts.js';
import { toContacts, cleanDomain } from '../src/sources/hunter.js';
import { Contact } from '../src/models/Contact.js';

test('phones: real numbers found once, IDs and salaries ignored', () => {
  assert.deepEqual(phonesIn('Call HR at 98765 43210 or +91-98765-43210'), ['98765 43210']);
  assert.deepEqual(phonesIn('US office +1 (415) 555-0134'), ['+1 (415) 555-0134']);
  assert.deepEqual(phonesIn('Order 1234567890123 shipped in 2024. CTC 1200000 to 1800000.'), []);
});

test('Hunter results become contacts; domains are cleaned', () => {
  assert.equal(cleanDomain('https://www.Acme.com/careers?x=1'), 'acme.com');
  const [c] = toContacts({ domain: 'acme.com', emails: [{ value: 'Priya@acme.com', type: 'personal', confidence: 92, first_name: 'Priya', position: 'Talent Acquisition', verification: { status: 'valid' } }] }, { userId: 'u', company: 'Acme' });
  assert.equal(c.email, 'priya@acme.com');
  assert.equal(c.kind, 'person');
  assert.equal(c.source, 'hunter');
});

test('only trustworthy addresses can be emailed', () => {
  const sendable = (fields) => new Contact({ userId: 'u', company: 'Acme', ...fields }).sendable;
  assert.equal(sendable({ email: 'hr@acme.com', source: 'company site' }), true);
  assert.equal(sendable({ email: 'p@acme.com', source: 'hunter', confidence: 60, verified: 'unknown' }), false);
  assert.equal(sendable({ email: 'p@acme.com', source: 'hunter', confidence: 60, verified: 'valid' }), true);
  assert.equal(sendable({ email: 'p@acme.com', source: 'hunter', confidence: 85 }), true);
  assert.equal(sendable({ phone: '98765 43210', source: 'job post' }), false);
});
