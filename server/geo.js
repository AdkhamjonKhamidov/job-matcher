// Offline US geocoding from the bundled `zipcodes` dataset. No network calls.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { codes } = require('zipcodes/lib/codes.js');
const { full: STATE_FULL } = require('zipcodes/lib/states.js');

const norm = (s) => String(s || '').toLowerCase().replace(/\./g, '').replace(/\bsaint\b/g, 'st').replace(/\bfort\b/g, 'ft').replace(/\s+/g, ' ').trim();

const cityAcc = new Map(); // "dallas|TX" -> {lat, lon, n}
const stateAcc = new Map(); // "TX" -> {lat, lon, n}
for (const z of Object.values(codes)) {
  if (!z.state || !Number.isFinite(z.latitude)) continue;
  const key = `${norm(z.city)}|${z.state}`;
  for (const [map, k] of [[cityAcc, key], [stateAcc, z.state]]) {
    const a = map.get(k) || { lat: 0, lon: 0, n: 0 };
    a.lat += z.latitude; a.lon += z.longitude; a.n++;
    map.set(k, a);
  }
}
const avg = (a) => ({ lat: +(a.lat / a.n).toFixed(4), lon: +(a.lon / a.n).toFixed(4), n: a.n });
const CITIES = new Map([...cityAcc].map(([k, a]) => [k, avg(a)]));
const STATES = new Map([...stateAcc].map(([k, a]) => [k, avg(a)]));
// Alaska/Hawaii centroids from ZIP averages are fine; DC is its own "state" in the data.

const NAME_TO_ST = Object.fromEntries(Object.entries(STATE_FULL).filter(([, ab]) => STATES.has(ab)).map(([name, ab]) => [name.toLowerCase(), ab]));
const ST_TO_NAME = Object.fromEntries(Object.entries(NAME_TO_ST).map(([name, ab]) => [ab, name.replace(/\b\w/g, (c) => c.toUpperCase())]));

// Biggest city of a given name, for bare names typed into search ("Seattle").
const BY_NAME = new Map();
for (const [key, v] of CITIES) {
  const [name, st] = key.split('|');
  const prev = BY_NAME.get(name);
  if (!prev || v.n > prev.n) BY_NAME.set(name, { ...v, st });
}

// Bare city names that are safe to read from job posts without a state.
const HUBS = {
  'new york': 'new york|NY', nyc: 'new york|NY', 'new york city': 'new york|NY', manhattan: 'new york|NY', brooklyn: 'brooklyn|NY',
  'san francisco': 'san francisco|CA', sf: 'san francisco|CA', 'bay area': 'san francisco|CA', 'sf bay area': 'san francisco|CA', 'san francisco bay area': 'san francisco|CA',
  'silicon valley': 'san jose|CA', 'san jose': 'san jose|CA', 'palo alto': 'palo alto|CA', 'mountain view': 'mountain view|CA', 'menlo park': 'menlo park|CA', sunnyvale: 'sunnyvale|CA',
  'los angeles': 'los angeles|CA', 'san diego': 'san diego|CA', seattle: 'seattle|WA', redmond: 'redmond|WA', bellevue: 'bellevue|WA',
  austin: 'austin|TX', dallas: 'dallas|TX', houston: 'houston|TX', 'san antonio': 'san antonio|TX', boston: 'boston|MA', chicago: 'chicago|IL',
  denver: 'denver|CO', boulder: 'boulder|CO', atlanta: 'atlanta|GA', miami: 'miami|FL', orlando: 'orlando|FL', tampa: 'tampa|FL',
  washington: 'washington|DC', 'washington dc': 'washington|DC', 'washington d c': 'washington|DC', 'dc': 'washington|DC',
  phoenix: 'phoenix|AZ', philadelphia: 'philadelphia|PA', pittsburgh: 'pittsburgh|PA', minneapolis: 'minneapolis|MN', detroit: 'detroit|MI',
  nashville: 'nashville|TN', raleigh: 'raleigh|NC', durham: 'durham|NC', charlotte: 'charlotte|NC', 'salt lake city': 'salt lake city|UT',
  baltimore: 'baltimore|MD', 'st louis': 'st louis|MO', 'kansas city': 'kansas city|MO', 'las vegas': 'las vegas|NV', 'new orleans': 'new orleans|LA',
};

const FOREIGN = /\b(canada|toronto|vancouver|montreal|ontario|uk|united kingdom|london|england|germany|berlin|munich|france|paris|spain|india|bengaluru|bangalore|singapore|australia|sydney|ireland|dublin|netherlands|amsterdam|poland|brazil|mexico|japan|tokyo|israel|tel aviv|emea|apac|latam|europe)\b/i;

function stateCode(token) {
  const t = String(token || '').trim();
  if (/^[A-Za-z]{2}$/.test(t) && STATES.has(t.toUpperCase())) return t.toUpperCase();
  return NAME_TO_ST[t.toLowerCase().replace(/\./g, '')] || null;
}

function place(cityKey, label) {
  const c = CITIES.get(cityKey);
  if (!c) return null;
  const st = cityKey.split('|')[1];
  return { label: label || `${cityKey.split('|')[0].replace(/\b\w/g, (m) => m.toUpperCase())}, ${st}`, lat: c.lat, lon: c.lon, state: st };
}

// Read every US city/state mentioned in a job's location string.
export function parseLocation(text) {
  const places = [];
  const states = new Set();
  const seen = new Set();
  const add = (p) => { if (p && !seen.has(p.label)) { seen.add(p.label); places.push(p); states.add(p.state); } };
  for (let seg of String(text || '').split(/\s*(?:\/|;|\||•|\n|\band\b|\bor\b|\s-\s|\+\d+)\s*/i)) {
    seg = seg.replace(/\([^)]*\)/g, ' ').replace(/\b(hq|hybrid|on-?site|in-office|office|remote|full[- ]time|anywhere)\b/gi, ' ').replace(/\s+/g, ' ').trim().replace(/^,|,$/g, '').trim();
    if (!seg || FOREIGN.test(seg)) continue;
    const parts = seg.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => !/^(united states( of america)?|usa|us)$/i.test(s));
    let matched = false;
    // "City, ST" or "City, State" (optionally followed by more parts).
    for (let i = 1; i < parts.length && !matched; i++) {
      const st = stateCode(parts[i]);
      if (!st) continue;
      const city = norm(parts[i - 1].replace(/\b(greater|metro(politan)?|area)\b/gi, ''));
      const p = place(`${city}|${st}`) || (HUBS[city]?.endsWith(`|${st}`) ? place(HUBS[city]) : null);
      if (p) add(p); else states.add(st);
      matched = true;
    }
    if (matched) continue;
    const whole = norm(parts.join(' ').replace(/\b(greater|metro(politan)?|area)\b/gi, ''));
    if (HUBS[whole]) { add(place(HUBS[whole])); continue; }
    const st = parts.length === 1 ? stateCode(parts[0]) : null;
    if (st) states.add(st);
  }
  return { places: places.slice(0, 8), states: [...states] };
}

// Turn a typed search ("Dallas, TX", "75201", "Texas", "seattle") into a point.
export function geocode(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  const zip = s.match(/^\d{5}$/)?.[0];
  if (zip && codes[zip]?.latitude) {
    const z = codes[zip];
    return { kind: 'point', label: `${z.city}, ${z.state} ${zip}`, lat: z.latitude, lon: z.longitude, state: z.state };
  }
  const st = stateCode(s);
  if (st) {
    const c = STATES.get(st);
    return { kind: 'state', label: ST_TO_NAME[st] || st, lat: c.lat, lon: c.lon, state: st };
  }
  const parsed = parseLocation(s);
  if (parsed.places[0]) return { kind: 'point', ...parsed.places[0] };
  const bare = BY_NAME.get(norm(s));
  if (bare) return { kind: 'point', label: `${s.replace(/\b\w/g, (m) => m.toUpperCase())}, ${bare.st}`, lat: bare.lat, lon: bare.lon, state: bare.st };
  return null;
}

export function stateName(st) { return ST_TO_NAME[st] || st; }

export function milesBetween(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
