import test from 'node:test';
import assert from 'node:assert/strict';
import { majorCities } from '../server/geo.js';

test('major city labels include ranked, valid coordinates across states', () => {
  const cities = majorCities();
  const byState = new Map();
  for (const city of cities) {
    assert.ok(city.name);
    assert.ok(Number.isFinite(city.lat) && Number.isFinite(city.lon));
    const list = byState.get(city.state) || [];
    list.push(city);
    byState.set(city.state, list);
  }

  assert.ok(byState.size >= 50);
  assert.ok([...byState.values()].every((list) => list.length <= 6));
  assert.ok(byState.get('TX').some((city) => city.name === 'Dallas'));
  assert.ok(byState.get('TX').some((city) => city.name === 'Austin'));
  assert.ok(byState.get('CA').some((city) => city.name === 'San Jose'));
  assert.ok(byState.get('NY').some((city) => city.name === 'New York'));
});
