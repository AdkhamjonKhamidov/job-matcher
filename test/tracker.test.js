import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, on } from '../public/js/core.js';
import { trackerExport, updateApplication } from '../public/js/tracker.js';

test('tracker exports spreadsheet-safe CSV and TSV with the same columns', () => {
  const records = [{
    company: 'Community, Inc.',
    title: '=HYPERLINK("https://example.com")',
    location: 'Baltimore, MD',
    status: 'applied',
    firstOpenedAt: '2026-11-20T12:00:00.000Z',
    lastOpenedAt: '2026-11-20T12:00:00.000Z',
    appliedAt: '2026-11-20T12:05:00.000Z',
    applyUrl: 'https://example.com/apply',
    url: 'https://example.com/job',
    sourceName: 'Example',
    notes: 'Asked for "references".',
  }];
  const csv = trackerExport('csv', records);
  const tsv = trackerExport('tsv', records);
  assert.match(csv, /"Company","Job title","Location"/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /"Community, Inc\."/);
  assert.match(csv, /"Asked for ""references""\."/);
  assert.ok(tsv.includes('"Company"\t"Job title"\t"Location"'));
  assert.equal(csv.split('\r\n').length, 2);
  assert.equal(tsv.split('\r\n').length, 2);
});

test('tracker status updates persist and notify the open Applications page', () => {
  const original = state.applications;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  state.applications = [{ id: 'job-1', status: 'opened', appliedAt: '', notes: '' }];
  let emitted;
  const off = on('applications', (record) => { emitted = record; });
  try {
    updateApplication('job-1', { status: 'applied' });
    const saved = JSON.parse(storage.get('jm.applications'))[0];
    assert.equal(saved.status, 'applied');
    assert.ok(saved.appliedAt);
    assert.equal(emitted, state.applications[0]);
  } finally {
    off();
    state.applications = original;
    delete globalThis.localStorage;
  }
});
