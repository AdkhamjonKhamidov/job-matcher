import { SOURCES, runSource } from './sources.js';
import { categorize, seniority, extractEmails, ageDays, requiredYears, entryHint } from './text.js';
import { parseLocation, geocode } from './geo.js';

export const DEFAULT_BOARDS = {
  greenhouse: ['cloudflare', 'gitlab', 'datadog', 'airbnb', 'figma', 'discord'],
  lever: ['palantir', 'plaid'],
  ashby: ['ramp', 'notion', 'linear', 'zapier'],
};

export function normalizeSettings(input = {}) {
  const maxAgeDays = Math.min(7, Math.max(1, Number(input.maxAgeDays) || 7));
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9._-]+$/.test(x)).slice(0, 40);
  const boards = input.boards || DEFAULT_BOARDS;
  return {
    maxAgeDays,
    adzuna: {
      appId: String(input.adzuna?.appId || process.env.ADZUNA_APP_ID || '').trim(),
      appKey: String(input.adzuna?.appKey || process.env.ADZUNA_APP_KEY || '').trim(),
      country: String(input.adzuna?.country || 'us').trim().toLowerCase().slice(0, 2),
      where: String(input.adzuna?.where || '').trim().slice(0, 80),
      distanceMiles: Math.min(100, Math.max(1, Number(input.adzuna?.distanceMiles) || 25)),
    },
    boards: { greenhouse: list(boards.greenhouse), lever: list(boards.lever), ashby: list(boards.ashby) },
    disabled: new Set(Array.isArray(input.disabledSources) ? input.disabledSources : []),
  };
}

export function enrich(j) {
  const years = requiredYears(j.description);
  const titleLevel = seniority(j.title);
  // Lists that only carry new-grad/intern roles set the level unless the title says senior.
  const level = j.srcLevel && titleLevel !== 'senior' && titleLevel !== 'intern' ? j.srcLevel : seniority(j.title, { years, entryHint: entryHint(j.description) });
  return { ...j, level, minYears: years, emails: extractEmails(j.description), ...locate(j) };
}

// US map points and states for a job. Adzuna supplies coordinates; others are parsed.
function locate(j) {
  const { places, states } = parseLocation(j.location);
  if (j.geo && j.area?.[0] === 'US') {
    const st = geocode(j.area[1] || '')?.state;
    const city = j.area.at(-1);
    if (st) {
      states.push(st);
      if (!places.length) places.push({ label: `${city}, ${st}`, lat: +j.geo.lat.toFixed(4), lon: +j.geo.lon.toFixed(4), state: st });
    }
  }
  return { places, states: [...new Set(states)], geo: undefined, area: undefined };
}

const dedupeKey =(j) => `${j.title}|${j.company}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');

export async function aggregate(rawSettings, { force = false } = {}) {
  const settings = normalizeSettings(rawSettings);
  const status = [];
  const tasks = SOURCES.map(async (src) => {
    const base = { id: src.id, name: src.name, home: src.home, kind: src.kind, needs: src.needs || null };
    if (settings.disabled.has(src.id)) return status.push({ ...base, state: 'off', count: 0 });
    if (src.enabled && !src.enabled(settings)) return status.push({ ...base, state: 'setup', count: 0 });
    try {
      const { data, fetchedAt, fromCache } = await runSource(src, settings, { force });
      const jobs = data.map((j) => ({ ...j, source: src.id, sourceName: src.name, sourceHome: src.home, srcLevel: src.level }));
      status.push({ ...base, state: 'ok', fetchedAt, fromCache, total: jobs.length });
      return jobs;
    } catch (err) {
      status.push({ ...base, state: 'error', error: String(err.message || err).slice(0, 200), count: 0 });
      return [];
    }
  });
  const all = (await Promise.all(tasks)).filter(Array.isArray).flat();

  const seen = new Map();
  for (const j of all) {
    if (!j.title || !j.url || ageDays(j.postedAt) > settings.maxAgeDays) continue;
    const category = categorize(j.title);
    if (!category) continue;
    const key = dedupeKey(j);
    const prev = seen.get(key);
    // Keep the copy with the longer description; remember other sources it appeared on.
    if (prev) {
      prev.alsoOn = [...new Set([...(prev.alsoOn || []), j.sourceName])];
      if ((j.description?.length || 0) > (prev.description?.length || 0) && !j.descriptionIsSnippet) {
        // Keep the entry-list level hint if either copy came from one.
        Object.assign(prev, enrich({ ...j, category, srcLevel: j.srcLevel || prev.srcLevel }), { alsoOn: prev.alsoOn });
      }
      continue;
    }
    seen.set(key, enrich({ ...j, category }));
  }
  const jobs = [...seen.values()].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  for (const s of status) if (s.state === 'ok') s.count = jobs.filter((j) => j.source === s.id).length;
  status.sort((a, b) => SOURCES.findIndex((x) => x.id === a.id) - SOURCES.findIndex((x) => x.id === b.id));
  return { jobs, sources: status, maxAgeDays: settings.maxAgeDays, generatedAt: new Date().toISOString() };
}
