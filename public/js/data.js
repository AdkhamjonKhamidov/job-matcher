// Loading postings, "new" markers, auto-refresh and on-demand full posting text.
import { state, store, api, emit, toast } from './core.js';
import { passes } from './filters.js';

export function jobSettings() {
  const s = state.settings;
  const loc = state.filters.loc;
  return {
    maxAgeDays: state.filters.days,
    // A location search also points Adzuna's local search at that place.
    adzuna: {
      ...s.adzuna, country: s.country,
      where: loc ? loc.label.replace(/\s\d{5}$/, '') : s.city,
      distanceMiles: loc && loc.radius !== 'state' ? Number(loc.radius) : s.radius,
    },
    boards: s.boards || state.config?.defaultBoards,
    disabledSources: s.disabledSources,
  };
}

// "New" = not seen in an earlier load in this browser. First load, or widening the date range, flags nothing.
function markNew(announce, absorb) {
  const known = new Set(store.get('knownIds', []));
  const quiet = known.size === 0 || absorb;
  const fresh = state.jobs.filter((j) => !known.has(j.id));
  if (!quiet) for (const j of fresh) state.newIds.add(j.id);
  if (fresh.length) store.set('knownIds', [...known, ...fresh.map((j) => j.id)].slice(-6000));
  updateTitle();
  const shown = fresh.filter((j) => !quiet && passes(j));
  if (announce && shown.length) toast(`${shown.length} new matching posting${shown.length === 1 ? '' : 's'} found.`);
}

export function updateTitle() {
  const n = state.jobs.filter((j) => state.newIds.has(j.id) && passes(j)).length;
  document.title = `${n ? `(${n}) ` : ''}Job Matcher`;
}

let inflight = null;
export async function loadJobs({ force = false, silent = false } = {}) {
  if (inflight) return inflight;
  state.loading = true;
  emit('loading');
  inflight = (async () => {
    try {
      const data = await api('/api/jobs', { settings: jobSettings(), force });
      for (const j of data.jobs) if (state.fullText[j.id]) applyFullText(j, state.fullText[j.id]);
      state.jobs = data.jobs;
      state.sources = data.sources;
      state.lastLoaded = Date.now();
      state.loadError = '';
      const widened = state.loadedDays != null && state.filters.days > state.loadedDays;
      state.loadedDays = Math.max(state.loadedDays ?? 0, state.filters.days);
      store.set('loadedDays', state.loadedDays);
      markNew(silent, widened);
    } catch (err) {
      state.loadError = err.message;
      if (!silent) toast(err.message);
    } finally {
      state.loading = false;
      inflight = null;
      emit('jobs');
    }
  })();
  return inflight;
}

const AUTO_REFRESH_MS = 20 * 60 * 1000;
export function startAutoRefresh() {
  setInterval(() => { if (!state.loading && !document.hidden) loadJobs({ silent: true }); }, AUTO_REFRESH_MS);
  // Catch up when you come back to a tab that missed refreshes.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.loading && Date.now() - state.lastLoaded > AUTO_REFRESH_MS) loadJobs({ silent: true });
  });
  // Keep "2h ago" labels current without refetching.
  setInterval(() => emit('tick'), 60000);
}

export function applyFullText(j, info) {
  j.description = info.text;
  j.descriptionIsSnippet = false;
  j.fullTextLoaded = true;
  j._skills = undefined;
  if (info.minYears != null) j.minYears = info.minYears;
  if (info.emails?.length) j.emails = info.emails;
}

// Lists like Simplify only carry a title and link; fetch the posting text when it's opened.
const textInflight = {};
export function loadFullText(j) {
  if (!j?.needsFullText || j.fullTextLoaded) return Promise.resolve();
  if (textInflight[j.id]) return textInflight[j.id];
  j.fullTextState = 'loading';
  emit('job', j.id);
  textInflight[j.id] = api('/api/describe', { url: j.applyUrl || j.url })
    .then((info) => { state.fullText[j.id] = info; applyFullText(j, info); j.fullTextState = 'ok'; })
    .catch((err) => { j.fullTextState = 'error'; j.fullTextError = err.message; throw err; })
    .finally(() => { delete textInflight[j.id]; emit('job', j.id); });
  return textInflight[j.id];
}
