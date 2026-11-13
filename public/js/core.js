// Shared state, storage and small helpers. Everything personal lives in this browser's localStorage.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ---------- storage (never throws) ----------
export const store = {
  get(k, fallback) { try { const v = localStorage.getItem('jm.' + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('jm.' + k, JSON.stringify(v)); return true; } catch { toast('Could not save in this browser (storage full or blocked).'); return false; } },
  wipe() { try { Object.keys(localStorage).filter((k) => k.startsWith('jm.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } },
};

export const CATS = [
  ['helpdesk', 'Helpdesk & Support'], ['it', 'IT & Sysadmin'], ['swe', 'Software'], ['devops', 'DevOps & Cloud'],
  ['security', 'Security'], ['data', 'Data & ML'], ['qa', 'QA & Test'],
];
export const CAT_LABEL = Object.fromEntries(CATS);
export const LEVELS = [['intern', 'Internship'], ['entry', 'Entry'], ['mid', 'Mid'], ['senior', 'Senior']];

const DEFAULT_SETTINGS = {
  geminiKey: '', model: 'auto', tone: 'professional and direct', maskContact: true, notes: '',
  profile: { name: '', email: '', phone: '', linkedin: '' },
  city: '', radius: 25, country: 'us', adzuna: { appId: '', appKey: '' },
  boards: null, disabledSources: [],
};

const DEFAULT_FILTERS = {
  days: 7, roles: [], levels: ['intern', 'entry'], where: 'all', loc: null, locRemote: true,
  regionOnly: true, hasEmail: false, hideSeen: true, sort: 'new',
};

function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
  s.profile = { ...DEFAULT_SETTINGS.profile, ...(s.profile || {}) };
  s.adzuna = { ...DEFAULT_SETTINGS.adzuna, ...(s.adzuna || {}) };
  if (!s.model || s.model === 'gemini-2.5-flash') s.model = 'auto'; // retired for new keys
  return s;
}

function loadFilters() {
  const saved = store.get('filters', null);
  const f = { ...DEFAULT_FILTERS, ...(saved || {}), q: '' };
  if (!saved) {
    // Carry over choices from the older single-page version.
    const old = store.get('settings', {});
    if (old.maxAgeDays) f.days = old.maxAgeDays;
    if (store.get('entryOnly', true) === false) f.levels = ['intern', 'entry', 'mid', 'senior'];
  }
  return f;
}

export const state = {
  config: null,
  settings: loadSettings(),
  filters: loadFilters(),
  resumes: store.get('resumes', []), // [{id, name, text, updatedAt}]
  activeResume: store.get('activeResume', null),
  dismissed: new Set(store.get('dismissed', [])),
  kits: store.get('kits', {}), // jobId -> {kit, at, resumeId, resumeName, job, edits, to}
  onboarded: store.get('onboarded', false),
  jobs: [], sources: [], loading: false, lastLoaded: 0, loadError: '',
  newIds: new Set(), fullText: {}, loadedDays: store.get('loadedDays', null),
  selectedId: null, tailoring: new Set(), mapSel: null, docTab: 'resume',
};

export const saveSettings = () => store.set('settings', state.settings);
export const saveFilters = () => { const { q, ...rest } = state.filters; store.set('filters', rest); };
export const currentResume = () => state.resumes.find((r) => r.id === state.activeResume) || state.resumes[0] || null;
export const findJob = (id) => state.jobs.find((j) => j.id === id) || state.kits[id]?.job || null;

export function saveKits() {
  const entries = Object.entries(state.kits).sort((a, b) => b[1].at - a[1].at).slice(0, 80);
  state.kits = Object.fromEntries(entries);
  store.set('kits', state.kits);
}

// ---------- tiny event bus: data changes -> pages re-render ----------
const listeners = {};
export const on = (ev, fn) => { (listeners[ev] ||= new Set()).add(fn); return () => listeners[ev].delete(fn); };
export const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

// ---------- toast ----------
let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

// ---------- API ----------
export async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- time & distance ----------
export function age(iso) {
  if (!iso) return { big: '?', small: 'unknown', hot: false };
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return { big: `${Math.max(1, Math.round(h * 60))}m`, small: 'ago', hot: true };
  if (h < 24) return { big: `${Math.round(h)}h`, small: 'ago', hot: h < 12 };
  const d = Math.floor(h / 24);
  return { big: `${d}d`, small: d === 1 ? 'yesterday' : 'ago', hot: false };
}

export function milesBetween(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function copy(text, okMsg = 'Copied.') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; } catch { toast('Clipboard blocked. Select the text and copy it manually.'); return false; }
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const fileSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
