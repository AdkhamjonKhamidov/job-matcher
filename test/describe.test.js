import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredPosting } from '../server/describe.js';

test('parseStructuredPosting reads a job from JSON-LD @graph', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@graph': [{
      '@type': ['Thing', 'JobPosting'],
      title: 'Registered Nurse',
      hiringOrganization: { name: 'Community Hospital' },
      jobLocation: [{ address: { addressLocality: 'Baltimore', addressRegion: 'MD', postalCode: '21201' } }],
      datePosted: '2026-11-18',
      employmentType: ['FULL_TIME'],
      description: '<p>Provide safe patient care and complete clinical documentation.</p>',
    }],
  })}</script>`;
  const job = parseStructuredPosting(html, 'https://hospital.example/jobs/123');
  assert.equal(job.title, 'Registered Nurse');
  assert.equal(job.company, 'Community Hospital');
  assert.equal(job.location, 'Baltimore, MD, 21201');
  assert.equal(job.postedAt, '2026-11-18T00:00:00.000Z');
  assert.equal(job.description, 'Provide safe patient care and complete clinical documentation.');
  assert.deepEqual(job.tags, ['FULL_TIME']);
  assert.equal(job.url, 'https://hospital.example/jobs/123');
});

test('parseStructuredPosting supports remote jobs and rejects malformed or unrelated JSON-LD', () => {
  const remote = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting', title: 'Staff Accountant', jobLocationType: 'TELECOMMUTE',
    description: 'Prepare reports, reconciliations, and month-end close documentation.',
  })}</script>`;
  assert.equal(parseStructuredPosting(remote).remote, true);
  assert.equal(parseStructuredPosting('<script type="application/ld+json">{bad}</script>'), null);
  assert.equal(parseStructuredPosting(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Example' })}</script>`), null);
});
