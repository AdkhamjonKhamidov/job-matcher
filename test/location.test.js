import test from 'node:test';
import assert from 'node:assert/strict';
import { state, milesBetween } from '../public/js/core.js';
import { filtered, inLocation, passes } from '../public/js/filters.js';

test('location radius excludes distant and unlocated remote jobs unless remote is enabled', () => {
  const previous = { ...state.filters };
  const oldJobs = state.jobs;
  const oldDismissed = state.dismissed;
  const loc = { kind: 'point', label: 'Dallas, TX', lat: 32.7767, lon: -96.797, radius: '10' };
  const nearby = {
    id: 'nearby', category: 'data', level: 'entry', remote: false, states: ['TX'],
    places: [{ label: 'Dallas, TX', lat: 32.8, lon: -96.8, state: 'TX' }],
  };
  const distant = {
    id: 'distant', category: 'data', level: 'entry', remote: false, states: ['TX'],
    places: [{ label: 'Austin, TX', lat: 30.2672, lon: -97.7431, state: 'TX' }],
  };
  const midrange = {
    id: 'midrange', category: 'data', level: 'entry', remote: false, states: ['TX'],
    places: [{ label: 'North Texas', lat: 33.4, lon: -96.8, state: 'TX' }],
  };
  const remote = { id: 'remote', category: 'data', level: 'entry', remote: true, states: [], places: [] };

  Object.assign(state.filters, {
    roles: [], levels: [], where: 'all', loc, locRemote: false, regionOnly: false,
    hasEmail: false, eligibleOnly: false, hideSeen: false, q: '', sort: 'near',
  });
  state.jobs = [distant, remote, midrange, nearby];
  state.dismissed = new Set();

  try {
    assert.ok(milesBetween(loc, nearby.places[0]) < 10);
    assert.equal(inLocation(distant, loc), false);
    assert.deepEqual(filtered().map((job) => job.id), ['nearby']);

    state.filters.loc = { ...loc, radius: '50' };
    assert.ok(inLocation(midrange, state.filters.loc) < 50);
    assert.deepEqual(filtered().map((job) => job.id), ['nearby', 'midrange']);

    state.filters.locRemote = true;
    assert.deepEqual(filtered().map((job) => job.id), ['nearby', 'midrange', 'remote']);
    assert.equal(passes(remote), true);
  } finally {
    Object.assign(state.filters, previous);
    state.jobs = oldJobs;
    state.dismissed = oldDismissed;
  }
});

test('distance searches default to nearby postings only', () => {
  assert.equal(state.filters.locRemote, false);
});
