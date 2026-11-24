import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, cleanPassword } from '../src/mail/send.js';

test('app passwords are stored encrypted and read back only with the same key', () => {
  process.env.MAIL_SECRET_KEY = 'a'.repeat(64);
  const stored = encrypt('abcdefghijklmnop');
  assert.ok(!stored.includes('abcdefghijklmnop'));
  assert.notEqual(encrypt('abcdefghijklmnop'), stored); // a fresh random IV each time
  assert.equal(decrypt(stored), 'abcdefghijklmnop');
  process.env.MAIL_SECRET_KEY = 'b'.repeat(64);
  assert.throws(() => decrypt(stored)); // wrong key: refused, not garbage
});

test('a missing or short MAIL_SECRET_KEY is a clear error', () => {
  process.env.MAIL_SECRET_KEY = 'short';
  assert.throws(() => encrypt('x'), /MAIL_SECRET_KEY/);
});

test('app password spaces are removed', () => {
  assert.equal(cleanPassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
});
