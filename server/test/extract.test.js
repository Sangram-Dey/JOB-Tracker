import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalaryText, parseYears, normalizeSalary, platformOf } from '../src/jobs/extract.js';

test('pay written in Indian formats', () => {
  assert.deepEqual(parseSalaryText('CTC: 12-18 LPA plus bonus'), { min: 1_200_000, max: 1_800_000, currency: 'INR', lpa: 18, fromText: true });
  assert.equal(parseSalaryText('Salary 8 lakhs per annum').lpa, 8);
  assert.equal(parseSalaryText('₹12,00,000 - ₹18,00,000 per annum').lpa, 18);
  assert.equal(parseSalaryText('Rs. 50,000 - 70,000 per month').lpa, 8.4);
  assert.equal(parseSalaryText('We raised ₹50 crore last year'), undefined);
});

test('pay in other currencies, with periods', () => {
  assert.equal(parseSalaryText('$120k–$150k').max, 150_000);
  assert.equal(parseSalaryText('$3.5k–$5k/month').max, 60_000);
  assert.equal(parseSalaryText('$50-$75 /hour').max, 156_000);
  assert.equal(parseSalaryText('€60,000 - €75,000').currency, 'EUR');
  assert.equal(parseSalaryText('We raised $5-10M in funding'), undefined);
  assert.equal(parseSalaryText('Team of 10-20 people'), undefined);
});

test('junk salary numbers from feeds are dropped', () => {
  assert.equal(normalizeSalary({ min: 21, max: 21, currency: 'USD' }), undefined);
  assert.equal(normalizeSalary({ min: 114_000_000, max: 140_000_000, currency: 'USD' }), undefined);
  assert.equal(normalizeSalary({ min: 152_405, max: 179_300, currency: 'USD' }).lpa, 157.8);
  assert.equal(normalizeSalary({ min: 100, max: 200, currency: 'XYZ' }), undefined);
});

test('years of experience: the lowest stated requirement', () => {
  assert.equal(parseYears('We need 3+ years of experience with React.'), 3);
  assert.equal(parseYears('Experience: 2-5 years'), 2);
  assert.equal(parseYears('Minimum 4 years in backend. 6 years of experience preferred.'), 4);
  assert.equal(parseYears('A 4-year degree is required.'), undefined);
  assert.equal(parseYears('Founded 25 years ago'), undefined);
});

test('platform names are unified', () => {
  assert.equal(platformOf('jsearch', 'Naukri.com'), 'naukri');
  assert.equal(platformOf('freehire', 'naukri'), 'naukri');
  assert.equal(platformOf('remoteok'), 'remoteok');
  assert.equal(platformOf('jsearch', 'Indeed'), 'indeed');
});

test('junk postings are recognised, real ones are not', async () => {
  const { junkReasons } = await import('../src/jobs/extract.js');
  const real = { title: 'Full Stack Developer', company: 'Acme', description: 'Build React and Node.js services. '.repeat(10), platform: 'naukri', source: 'freehire' };
  assert.deepEqual(junkReasons(real), []);
  assert.match(junkReasons({ ...real, description: real.description + ' Registration fee of Rs 500 applies.' })[0], /fees/);
  assert.match(junkReasons({ ...real, description: real.description + ' Contact us on WhatsApp us at 98765.' })[0], /WhatsApp/);
  assert.match(junkReasons({ ...real, platform: 'whatjobsuk' })[0], /Ad-network/);
  assert.match(junkReasons({ ...real, title: '🔥 HIRING NOW!!' }).join(), /Spammy/);
  assert.match(junkReasons({ ...real, description: 'Apply now.' })[0], /description/);
  assert.deepEqual(junkReasons({ ...real, description: 'Short.', source: 'lever' }), []); // company boards are trusted
  assert.deepEqual(junkReasons({ ...real, title: 'Senior Software Engineer (AWS)' }), []);
  assert.deepEqual(junkReasons({ ...real, title: 'DESARROLLADOR FULL STACK' }), []); // capitals alone are fine
});
