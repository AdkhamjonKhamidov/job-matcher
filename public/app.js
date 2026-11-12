// Job Matcher front end. Everything personal lives in this browser's localStorage.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');

// ---------- local storage (never throws) ----------
const store = {
  get(k, fallback) { try { const v = localStorage.getItem('jm.' + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('jm.' + k, JSON.stringify(v)); return true; } catch { toast('Could not save locally (storage full or blocked).'); return false; } },
  wipe() { try { Object.keys(localStorage).filter((k) => k.startsWith('jm.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } },
};

const CATS = [
  ['helpdesk', 'Helpdesk & Support'], ['it', 'IT & Sysadmin'], ['swe', 'Software Eng'], ['devops', 'DevOps & Cloud'],
  ['security', 'Security'], ['data', 'Data & ML'], ['qa', 'QA & Test'],
];
const CAT_LABEL = Object.fromEntries(CATS);
const LEVELS = [['intern', 'Intern'], ['entry', 'Entry'], ['mid', 'Mid'], ['senior', 'Senior']];

const DEFAULT_SETTINGS = {
  geminiKey: '', model: 'auto', tone: 'professional and direct', maskContact: true, notes: '',
  profile: { name: '', email: '', phone: '', linkedin: '' },
  city: '', radius: 25, country: 'us', adzuna: { appId: '', appKey: '' },
  boards: null, disabledSources: [], maxAgeDays: 7,
};

const state = {
  config: null,
  settings: (() => {
    const s = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
    if (!s.model || s.model === 'gemini-2.5-flash') s.model = 'auto'; // retired for new keys
    return s;
  })(),
  resumes: store.get('resumes', []), // [{id, name, text, updatedAt}]
  activeResume: store.get('activeResume', null),
  dismissed: new Set(store.get('dismissed', [])),
  kits: store.get('kits', {}), // jobId -> {kit, at, resumeId, mask}
  jobs: [], sources: [],
  filters: { q: '', cat: null, level: null, where: 'all', regionOnly: true, hasEmail: false, hideSeen: false, sort: 'new', entryOnly: store.get('entryOnly', true) },
  newIds: new Set(), fullText: {}, lastLoaded: 0, loadedDays: store.get('loadedDays', null),
  selectedId: null, tab: 'posting', docTab: 'resume',
  loading: false, tailoring: new Set(),
};

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- time ----------
function age(iso) {
  if (!iso) return { big: '?', small: 'unknown', hot: false };
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return { big: `${Math.max(1, Math.round(h * 60))}m`, small: 'ago', hot: true };
  if (h < 24) return { big: `${Math.round(h)}h`, small: 'ago', hot: h < 12 };
  const d = Math.floor(h / 24);
  return { big: `${d}d`, small: d === 1 ? 'yesterday' : 'ago', hot: false };
}

// ---------- region / location ----------
const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const REGION = {
  us: { name: 'US', re: new RegExp(`\\b(us|u\\.s\\.?|usa|united states|americas?|north america|worldwide|anywhere|global)\\b|,\\s*(${STATES})\\b`, 'i') },
  ca: { name: 'Canada', re: /\b(canada|americas?|north america|worldwide|anywhere|global)\b|,\s*(ON|BC|AB|QC|MB|NS|SK)\b/i },
  gb: { name: 'UK', re: /\b(uk|united kingdom|england|scotland|wales|london|europe|emea|worldwide|anywhere|global)\b/i },
  au: { name: 'Australia', re: /\b(australia|apac|asia[- ]pacific|worldwide|anywhere|global|sydney|melbourne)\b/i },
  de: { name: 'Germany', re: /\b(germany|deutschland|dach|europe|eu|emea|worldwide|anywhere|global|berlin|munich|münchen|hamburg)\b/i },
  in: { name: 'India', re: /\b(india|apac|asia|worldwide|anywhere|global|bengaluru|bangalore|hyderabad|pune)\b/i },
};

function regionOk(job) {
  if (job.source === 'adzuna') return true; // already scoped to the chosen country
  const r = REGION[state.settings.country] || REGION.us;
  const loc = job.location || '';
  if (r.re.test(loc)) return true;
  if (job.remote) {
    const rest = loc.replace(/remote|\(|\)|\/|-|only|first|friendly|,/gi, '').trim();
    return rest.length === 0;
  }
  return false;
}

function isLocal(job) {
  if (job.source === 'adzuna') return true;
  const city = (state.settings.city || '').split(',')[0].trim().toLowerCase();
  return !job.remote && city.length > 1 && (job.location || '').toLowerCase().includes(city);
}

// ---------- quick local skill overlap (no AI, no network) ----------
const SKILLS = ['active directory', 'azure ad', 'entra', 'office 365', 'microsoft 365', 'm365', 'intune', 'sccm', 'jamf', 'windows', 'macos', 'linux', 'ubuntu', 'powershell', 'bash', 'ticketing', 'servicenow', 'jira', 'zendesk', 'freshservice', 'itil', 'tcp/ip', 'dns', 'dhcp', 'vpn', 'lan', 'wan', 'firewall', 'cisco', 'networking', 'vmware', 'hyper-v', 'citrix', 'comptia', 'a+', 'network+', 'security+', 'ccna', 'printer', 'hardware', 'troubleshooting', 'imaging', 'okta', 'google workspace', 'gsuite', 'exchange', 'sharepoint', 'teams', 'remote desktop', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node', 'next.js', 'python', 'django', 'flask', 'fastapi', 'java', 'spring', 'kotlin', 'swift', 'c#', '.net', 'c++', 'golang', 'go', 'rust', 'ruby', 'rails', 'php', 'laravel', 'sql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'api', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ansible', 'ci/cd', 'github actions', 'jenkins', 'git', 'html', 'css', 'tailwind', 'figma', 'selenium', 'cypress', 'playwright', 'pytest', 'jest', 'spark', 'airflow', 'dbt', 'snowflake', 'pandas', 'tableau', 'power bi', 'excel', 'machine learning', 'pytorch', 'tensorflow', 'llm', 'siem', 'splunk', 'soc', 'incident response', 'vulnerability', 'nist', 'iso 27001', 'agile', 'scrum'];
const skillRe = (s) => new RegExp(`(^|[^a-z0-9+#.])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`, 'i');
const SKILL_RES = SKILLS.map((s) => [s, skillRe(s)]);
let resumeSkills = null;
function currentResume() { return state.resumes.find((r) => r.id === state.activeResume) || state.resumes[0] || null; }
function skillFit(job) {
  const r = currentResume();
  if (!r) return null;
  if (!resumeSkills || resumeSkills.id !== r.id || resumeSkills.at !== r.updatedAt) {
    resumeSkills = { id: r.id, at: r.updatedAt, set: new Set(SKILL_RES.filter(([, re]) => re.test(r.text)).map(([s]) => s)) };
  }
  if (job._skills === undefined) {
    const hay = `${job.title}\n${job.description}\n${(job.tags || []).join(' ')}`;
    job._skills = SKILL_RES.filter(([, re]) => re.test(hay)).map(([s]) => s);
  }
  if (!job._skills.length) return null;
  const have = job._skills.filter((s) => resumeSkills.set.has(s));
  return { have: have.length, of: job._skills.length, missing: job._skills.filter((s) => !resumeSkills.set.has(s)) };
}

// ---------- API ----------
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function jobSettings() {
  const s = state.settings;
  return {
    maxAgeDays: s.maxAgeDays,
    adzuna: { ...s.adzuna, country: s.country, where: s.city, distanceMiles: s.radius },
    boards: s.boards || state.config?.defaultBoards,
    disabledSources: s.disabledSources,
  };
}

// "New" = not seen in any earlier load in this browser. The first ever load marks nothing.
function markNew(announce, { absorb = false } = {}) {
  const known = new Set(store.get('knownIds', []));
  // First ever load, or a wider date window, brings in old postings: remember them without flagging.
  const firstRun = known.size === 0 || absorb;
  const fresh = state.jobs.filter((j) => !known.has(j.id));
  if (!firstRun) for (const j of fresh) state.newIds.add(j.id);
  if (fresh.length) store.set('knownIds', [...known, ...fresh.map((j) => j.id)].slice(-6000));
  const visibleNew = fresh.filter((j) => !firstRun && passesLevel(j));
  if (announce && visibleNew.length) toast(`${visibleNew.length} new ${state.filters.entryOnly ? 'entry-friendly ' : ''}posting${visibleNew.length === 1 ? '' : 's'} found.`);
  const count = state.jobs.filter((j) => state.newIds.has(j.id) && passesLevel(j)).length;
  document.title = count ? `(${count}) Job Matcher` : 'Job Matcher';
}

const AUTO_REFRESH_MS = 20 * 60 * 1000;
let autoTimer;
function scheduleAutoRefresh() {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => { if (!state.loading && !document.hidden) loadJobs(false, { silent: true }); }, AUTO_REFRESH_MS);
}

async function loadJobs(force = false, { silent = false } = {}) {
  state.loading = true;
  $('#refreshBtn').classList.add('spin');
  if (!state.jobs.length) {
    $('#jobList').innerHTML = Array.from({ length: 8 }, () => '<li class="skel" aria-hidden="true"></li>').join('');
    $('#feedCount').textContent = 'Checking job boards...';
  }
  try {
    const data = await api('/api/jobs', { settings: jobSettings(), force });
    for (const j of data.jobs) if (state.fullText[j.id]) applyFullText(j, state.fullText[j.id]);
    state.jobs = data.jobs;
    state.sources = data.sources;
    state.lastLoaded = Date.now();
    const widened = state.loadedDays != null && state.settings.maxAgeDays > state.loadedDays;
    state.loadedDays = Math.max(state.loadedDays ?? 0, state.settings.maxAgeDays);
    store.set('loadedDays', state.loadedDays);
    markNew(silent, { absorb: widened });
  } catch (err) {
    if (silent) return;
    toast(err.message);
    if (!state.jobs.length) {
      $('#jobList').innerHTML = '';
      showEmpty('Could not load jobs', `The local server said: ${esc(err.message)}. Is <code>npm start</code> still running?`);
    }
  } finally {
    state.loading = false;
    $('#refreshBtn').classList.remove('spin');
    renderAll();
  }
}

// ---------- filtering ----------
function passesLevel(j) {
  if (!state.filters.entryOnly) return true;
  return j.level !== 'senior' && !(j.minYears != null && j.minYears >= 3);
}

function baseFiltered(skip) {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return state.jobs.filter((j) => {
    if (skip !== 'cat' && f.cat && j.category !== f.cat) return false;
    if (skip !== 'level' && f.level && j.level !== f.level) return false;
    if (!passesLevel(j)) return false;
    if (f.where === 'remote' && !j.remote) return false;
    if (f.where === 'local' && !isLocal(j)) return false;
    if (f.regionOnly && !(f.where === 'local' && isLocal(j)) && !regionOk(j)) return false;
    if (f.hasEmail && !j.emails?.length) return false;
    if (f.hideSeen && state.dismissed.has(j.id)) return false;
    if (terms.length) {
      const hay = `${j.title} ${j.company} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t) || j.description?.toLowerCase().includes(t))) return false;
    }
    return true;
  });
}

function filtered() {
  const list = baseFiltered();
  if (state.filters.sort === 'match') {
    const score = (j) => state.kits[j.id]?.kit?.matchScore ?? (() => { const s = skillFit(j); return s ? Math.round((s.have / s.of) * 100) - 1 : -1; })();
    return list.map((j) => [score(j), j]).sort((a, b) => b[0] - a[0]).map(([, j]) => j);
  }
  return list;
}

// ---------- render: rail ----------
function renderFacets() {
  const forCat = baseFiltered('cat');
  const forLevel = baseFiltered('level');
  const count = (list, key, v) => list.filter((j) => j[key] === v).length;
  $('#catList').innerHTML = [`<button type="button" data-cat="" aria-pressed="${!state.filters.cat}"><span>All tech roles</span><span class="n">${forCat.length}</span></button>`]
    .concat(CATS.map(([id, label]) => `<button type="button" data-cat="${id}" aria-pressed="${state.filters.cat === id}"><span>${label}</span><span class="n">${count(forCat, 'category', id)}</span></button>`)).join('');
  $('#levelList').innerHTML = [`<button type="button" data-level="" aria-pressed="${!state.filters.level}"><span>Any level</span><span class="n">${forLevel.length}</span></button>`]
    .concat(LEVELS.map(([id, label]) => `<button type="button" data-level="${id}" aria-pressed="${state.filters.level === id}"><span>${label}</span><span class="n">${count(forLevel, 'level', id)}</span></button>`)).join('');
  $('#countryName').textContent = (REGION[state.settings.country] || REGION.us).name;
}

function renderSources() {
  const list = state.sources.length ? state.sources : (state.config?.sources || []).map((s) => ({ ...s, state: 'wait' }));
  $('#sourceList').innerHTML = list.map((s) => {
    let st = '';
    if (s.state === 'ok') st = `<span class="st" title="${s.total} fetched, ${s.count} fresh tech roles${s.fromCache ? ' (cached)' : ''}">${s.count}</span>`;
    else if (s.state === 'error') st = `<span class="st err" title="${esc(s.error)}">failed</span>`;
    else if (s.state === 'setup') st = `<span class="st setup" title="${esc(s.needs || 'Needs setup in Settings')}">setup</span>`;
    else if (s.state === 'off') st = '<span class="st">off</span>';
    else st = '<span class="st">...</span>';
    return `<li><a href="${safeUrl(s.home)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>${st}</li>`;
  }).join('');
}

// ---------- render: feed ----------
function showEmpty(title, html) {
  const el = $('#feedEmpty');
  el.innerHTML = `<p class="big">${esc(title)}</p><p>${html}</p>`;
  el.hidden = false;
}

function jobRow(j) {
  const a = age(j.postedAt);
  const kit = state.kits[j.id]?.kit;
  const fit = !kit && skillFit(j);
  const tags = [
    state.newIds.has(j.id) ? '<span class="tag new">new</span>' : '',
    `<span class="tag cat">${esc(CAT_LABEL[j.category] || j.category)}</span>`,
    j.remote ? '<span class="tag remote">remote</span>' : '',
    j.emails?.length ? '<span class="tag mail">recruiter email</span>' : '',
    kit ? `<span class="tag score">match ${kit.matchScore}</span>` : fit ? `<span class="tag" title="Skills in this posting found in your resume">skills ${fit.have}/${fit.of}</span>` : '',
    j.minYears != null ? `<span class="tag yrs${j.minYears >= 3 ? ' hi' : ''}" title="Years of experience the posting asks for">needs ${j.minYears}+ yrs</span>` : '',
    j.level === 'entry' || j.level === 'intern' ? `<span class="tag">${j.level === 'intern' ? 'internship' : 'entry level'}</span>` : '',
    j.salary ? `<span class="tag">${esc(j.salary)}</span>` : '',
  ].join('');
  return `<li class="job${state.dismissed.has(j.id) ? ' dismissed' : ''}" data-id="${esc(j.id)}" role="option" tabindex="-1" aria-selected="${state.selectedId === j.id}">
    <div class="age${a.hot ? ' hot' : ''}" title="${esc(j.postedAt || '')}">${a.big}<small>${a.small}</small></div>
    <div>
      <h3>${esc(j.title)}</h3>
      <p class="meta"><b>${esc(j.company || 'Unknown company')}</b> · ${esc(j.location || 'Location not listed')} · ${esc(j.sourceName)}</p>
      <div class="tags">${tags}</div>
    </div>
  </li>`;
}

function renderFeed() {
  const list = filtered();
  const ul = $('#jobList');
  ul.setAttribute('role', 'listbox');
  ul.setAttribute('aria-label', 'Job postings');
  $('#feedEmpty').hidden = true;
  const days = state.settings.maxAgeDays;
  const mins = state.lastLoaded ? Math.round((Date.now() - state.lastLoaded) / 60000) : null;
  $('#feedCount').innerHTML = `<b>${list.length}</b> postings from the last ${days === 1 ? '24 hours' : `${days} days`}${mins != null ? `<span class="refresh-note" title="Checks for new postings every 20 minutes while this tab is open">updated ${mins ? `${mins}m ago` : 'just now'}, auto every 20m</span>` : ''}`;
  if (!list.length && !state.loading) {
    ul.innerHTML = '';
    if (!state.jobs.length) showEmpty('No postings yet', 'Every source came back empty or failed. Check Sources on the left, then press refresh.');
    else showEmpty('Nothing matches these filters', 'Try "All" under Where, widen to 7 days, or untick "Open to my country only".');
    return;
  }
  ul.innerHTML = list.slice(0, 400).map(jobRow).join('');
}

function renderResumeChip() {
  const r = currentResume();
  $('#resumeDot').classList.toggle('on', !!r);
  $('#resumeChipText').textContent = r ? r.name : 'Add resume';
  $('#resumeChip').title = r ? `Using: ${r.name}` : 'No resume loaded';
}

function renderAll() {
  renderFacets();
  renderSources();
  renderFeed();
  renderResumeChip();
  if (state.selectedId) renderDetail();
}

// ---------- detail ----------
const selectedJob = () => state.jobs.find((j) => j.id === state.selectedId);

function select(id, { focusDetail = false } = {}) {
  state.selectedId = id;
  state.tab = state.kits[id] ? 'kit' : 'posting';
  $$('.job').forEach((li) => li.setAttribute('aria-selected', String(li.dataset.id === id)));
  renderDetail();
  $('#detail').classList.add('open');
  $('#detail').scrollTop = 0;
  if (focusDetail) $('#detail h2')?.focus();
  const j = selectedJob();
  if (j?.needsFullText && !j.fullTextLoaded) loadFullText(j).catch(() => {});
}

function applyFullText(j, info) {
  j.description = info.text;
  j.descriptionIsSnippet = false;
  j.fullTextLoaded = true;
  j._skills = undefined;
  if (info.minYears != null) j.minYears = info.minYears;
  if (info.emails?.length) j.emails = info.emails;
}

// Lists like Simplify only carry a title and link; pull the posting text when it's opened.
const fullTextInflight = {};
function loadFullText(j) {
  if (fullTextInflight[j.id]) return fullTextInflight[j.id];
  j.fullTextState = 'loading';
  if (state.selectedId === j.id && state.tab === 'posting') renderDetail();
  fullTextInflight[j.id] = api('/api/describe', { url: j.applyUrl || j.url })
    .then((info) => {
      state.fullText[j.id] = info;
      applyFullText(j, info);
      j.fullTextState = 'ok';
    })
    .catch((err) => { j.fullTextState = 'error'; j.fullTextError = err.message; throw err; })
    .finally(() => {
      delete fullTextInflight[j.id];
      if (state.selectedId === j.id) renderDetail();
      const li = $(`.job[data-id="${CSS.escape(j.id)}"]`);
      if (li) li.outerHTML = jobRow(j);
    });
  return fullTextInflight[j.id];
}

function closeDetail() {
  $('#detail').classList.remove('open');
}

function renderDetail() {
  const j = selectedJob();
  const d = $('#detail');
  if (!j) return;
  const a = age(j.postedAt);
  const posted = j.postedAt ? new Date(j.postedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown';
  d.innerHTML = `
    <div class="d-head">
      <button class="btn ghost small d-back" type="button" data-act="back">Back to list</button>
      <h2 tabindex="-1">${esc(j.title)}</h2>
      <p class="meta"><b>${esc(j.company || 'Unknown company')}</b> · ${esc(j.location || 'Location not listed')}${j.salary ? ` · ${esc(j.salary)}` : ''}</p>
      <p class="meta">Posted ${a.big} ${a.small === 'ago' ? 'ago' : `(${a.small})`} · ${esc(posted)}</p>
      <div class="d-actions">
        <a class="btn accent" href="${safeUrl(j.applyUrl)}" target="_blank" rel="noopener noreferrer">Open application page</a>
        <button class="btn" type="button" data-act="tailor">${state.kits[j.id] ? 'Re-tailor with Gemini' : 'Tailor with Gemini'}</button>
        <button class="btn ghost" type="button" data-act="dismiss">${state.dismissed.has(j.id) ? 'Restore' : 'Dismiss'}</button>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button role="tab" type="button" data-tab="posting" aria-selected="${state.tab === 'posting'}">Posting</button>
      <button role="tab" type="button" data-tab="kit" aria-selected="${state.tab === 'kit'}">Apply kit${state.kits[j.id] ? ` (${state.kits[j.id].kit.matchScore})` : ''}</button>
    </div>
    <div class="panel" role="tabpanel">${state.tab === 'posting' ? postingPanel(j) : kitPanel(j)}</div>`;
}

function postingPanel(j) {
  const fit = skillFit(j);
  return `
    <p class="source-note">From <a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.sourceName)}</a>${j.alsoOn?.length ? `, also on ${esc(j.alsoOn.join(', '))}` : ''}.
    ${j.fullTextState === 'loading' ? ' Loading the full posting from the company site...' : j.fullTextState === 'error' ? ` Could not load the full posting (${esc(j.fullTextError)}).` : j.descriptionIsSnippet ? ' This board only shares a snippet; open the posting for the full text.' : ''}
    ${j.minYears != null ? ` Asks for ${j.minYears}+ years of experience.` : ''}
    ${j.emails?.length ? ` Contact in posting: ${j.emails.map((e) => `<b>${esc(e)}</b>`).join(', ')}.` : ''}</p>
    ${fit ? `<p class="source-note">Skills it mentions: ${fit.of}. In your resume: ${fit.have}.${fit.missing.length ? ` Not found: ${esc(fit.missing.slice(0, 10).join(', '))}.` : ''}</p>` : ''}
    <div class="posting">${esc(j.description || 'No description provided.')}</div>`;
}

// ---------- apply kit ----------
const DOCS = [
  ['resume', 'Resume'], ['coverLetter', 'Cover letter'], ['email', 'Recruiter email'],
  ['linkedinNote', 'LinkedIn note'], ['linkedinMessage', 'LinkedIn message'], ['answers', 'Screening answers'],
];

function readiness() {
  const s = state.settings;
  return [
    { ok: !!currentResume(), text: 'A resume is loaded', act: 'resume' },
    { ok: !!(s.geminiKey || state.config?.serverGeminiKey), text: 'A Gemini API key is set', act: 'settings' },
    { ok: !!s.profile?.name, text: 'Your name is set (for signatures)', act: 'settings', optional: true },
  ];
}

function kitPanel(j) {
  const entry = state.kits[j.id];
  if (state.tailoring.has(j.id)) {
    return `<div class="kit-start"><h3>Tailoring for ${esc(j.company)}</h3><div class="loading-bar"></div><p class="muted">Gemini is reading the posting and your resume. This usually takes 10 to 40 seconds.</p></div>`;
  }
  if (!entry) {
    const checks = readiness();
    const ready = checks.filter((c) => !c.optional).every((c) => c.ok);
    const resumes = state.resumes.map((r) => `<option value="${esc(r.id)}" ${r.id === currentResume()?.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    return `<div class="kit-start">
      <h3>Build an apply kit</h3>
      <p class="muted">Gemini rewrites your resume for this posting using only what is already in it, then drafts a cover letter, a recruiter email, LinkedIn messages and likely screening answers.</p>
      <ul class="checklist">${checks.map((c) => `<li class="${c.ok ? 'ok' : ''}">${esc(c.text)}${c.ok ? '' : ` <button type="button" class="btn ghost small" data-act="${c.act}">${c.act === 'resume' ? 'Add resume' : 'Open settings'}</button>`}${c.optional && !c.ok ? ' <span class="muted">(optional)</span>' : ''}</li>`).join('')}</ul>
      ${state.resumes.length > 1 ? `<label class="field"><span>Resume to use</span><select data-act="pickResume">${resumes}</select></label>` : ''}
      <label class="field"><span>Notes for this job only (optional)</span><textarea id="jobNotes" rows="2" placeholder="e.g. I used their product at my last job."></textarea></label>
      <button class="btn accent" type="button" data-act="tailor" ${ready ? '' : 'disabled'}>Tailor with Gemini</button>
    </div>`;
  }
  const k = entry.kit;
  const email = j.emails?.[0] || entry.to || '';
  return `
    <div class="score-band">
      <div class="num">${k.matchScore}<small>/100</small></div>
      <p>${esc(k.matchSummary)}</p>
    </div>
    <div class="lists">
      <div><h4>Strengths</h4><ul>${(k.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
      <div><h4>Gaps to be honest about</h4><ul>${(k.gaps || []).map((s) => `<li>${esc(s)}</li>`).join('') || '<li>None flagged</li>'}</ul></div>
    </div>
    ${k.keywords?.length ? `<div class="kw">${k.keywords.map((w) => `<span class="tag">${esc(w)}</span>`).join('')}</div>` : ''}

    <div class="send">
      <h4>Send it</h4>
      <div class="send-grid">
        <div class="send-step">
          <span class="lbl">1. Apply</span>
          <p>Download the resume PDF, then open the real application form.</p>
          <button class="btn ghost small" type="button" data-act="pdf" data-doc="resume">Save resume as PDF</button>
          <a class="btn small" href="${safeUrl(j.applyUrl)}" target="_blank" rel="noopener noreferrer" data-act="applyCopy">Open form, copy cover letter</a>
        </div>
        <div class="send-step">
          <span class="lbl">2. Email recruiter</span>
          <input type="email" id="toEmail" placeholder="recruiter@company.com" value="${esc(email)}" aria-label="Recruiter email address">
          <button class="btn small" type="button" data-act="mailto">Open in my mail app</button>
          <button class="btn ghost small" type="button" data-act="gmail">Open in Gmail</button>
        </div>
        <div class="send-step">
          <span class="lbl">3. LinkedIn</span>
          <p>Copies your note, then opens a recruiter search at ${esc(j.company || 'the company')}.</p>
          <button class="btn small" type="button" data-act="linkedin">Find recruiters</button>
          <button class="btn ghost small" type="button" data-act="linkedinJob">Find this job on LinkedIn</button>
        </div>
      </div>
    </div>

    <div class="doc-tabs" role="group" aria-label="Documents">
      ${DOCS.map(([id, label]) => `<button type="button" data-doc-tab="${id}" aria-pressed="${state.docTab === id}">${label}</button>`).join('')}
    </div>
    ${docEditor(entry)}
    <p class="muted" style="font-size:12.5px">Generated ${esc(new Date(entry.at).toLocaleString())} from "${esc(entry.resumeName || 'resume')}"${entry.kit.model ? ` by ${esc(entry.kit.model)}` : ''}. Edits save in this browser. Read everything before sending.</p>`;
}

function docText(entry, id) {
  const k = entry.kit;
  if (entry.edits?.[id] != null) return entry.edits[id];
  switch (id) {
    case 'resume': return k.resume;
    case 'coverLetter': return k.coverLetter;
    case 'email': return `Subject: ${k.recruiterEmailSubject}\n\n${k.recruiterEmailBody}${signature()}`;
    case 'linkedinNote': return k.linkedinNote;
    case 'linkedinMessage': return k.linkedinMessage;
    case 'answers': return (k.screeningAnswers || []).map((x) => `Q: ${x.question}\nA: ${x.answer}`).join('\n\n');
    default: return '';
  }
}

function signature() {
  const p = state.settings.profile || {};
  const lines = [p.name, p.phone, p.email, p.linkedin].filter(Boolean);
  return lines.length ? `\n\nBest regards,\n${lines.join('\n')}` : '';
}

function docEditor(entry) {
  const id = state.docTab;
  const text = docText(entry, id);
  const limit = id === 'linkedinNote' ? 300 : null;
  return `<div class="doc">
    <label class="sr-only" for="docText">${esc(DOCS.find((d) => d[0] === id)?.[1])}</label>
    <textarea id="docText" data-doc="${id}" spellcheck="true">${esc(text)}</textarea>
    <div class="doc-actions">
      <span class="count" id="docCount">${text.length} chars${limit ? ` / ${limit}` : ''}</span>
      <span class="inline">
        <button class="btn ghost small" type="button" data-act="copy">Copy</button>
        <button class="btn ghost small" type="button" data-act="download">Download .txt</button>
        ${id === 'resume' || id === 'coverLetter' ? `<button class="btn ghost small" type="button" data-act="pdf" data-doc="${id}">Save as PDF</button>` : ''}
        ${entry.edits?.[id] != null ? '<button class="btn ghost small" type="button" data-act="revert">Revert edits</button>' : ''}
      </span>
    </div>
  </div>`;
}

// Mask contact details before sending to Gemini; restore them locally afterwards.
function maskText(text) {
  const map = {};
  let n = 0;
  const swap = (re, label) => {
    text = text.replace(re, (m) => {
      const existing = Object.keys(map).find((k) => map[k] === m);
      if (existing) return existing;
      const key = `[${label}${n++ ? n : ''}]`;
      map[key] = m;
      return key;
    });
  };
  swap(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'EMAIL');
  swap(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com)\/[^\s)]+/gi, 'LINK');
  swap(/(?<![\w])(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])/g, 'PHONE');
  return { text, map };
}
function unmask(value, map) {
  if (typeof value === 'string') return Object.entries(map).reduce((s, [k, v]) => s.split(k).join(v), value);
  if (Array.isArray(value)) return value.map((v) => unmask(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmask(v, map)]));
  return value;
}

function saveKits() {
  const entries = Object.entries(state.kits).sort((a, b) => b[1].at - a[1].at).slice(0, 80);
  state.kits = Object.fromEntries(entries);
  store.set('kits', state.kits);
}

async function tailorJob(j) {
  const resume = currentResume();
  if (!resume) { openResume(); return; }
  if (!state.settings.geminiKey && !state.config?.serverGeminiKey) { openSettings(); toast('Add your Gemini API key first.'); return; }
  const notes = [state.settings.notes, $('#jobNotes')?.value].filter(Boolean).join(' ');
  const { text, map } = state.settings.maskContact ? maskText(resume.text) : { text: resume.text, map: {} };
  state.tailoring.add(j.id);
  state.tab = 'kit';
  renderDetail();
  try {
    // Gemini needs the real posting, not just a title from a list.
    if (j.needsFullText && !j.fullTextLoaded) await loadFullText(j).catch(() => toast('Could not load the full posting; tailoring from the title only.'));
    const kit = await api('/api/tailor', {
      apiKey: state.settings.geminiKey, model: state.settings.model, tone: state.settings.tone, notes,
      resumeText: text,
      job: { title: j.title, company: j.company, location: j.location, salary: j.salary, description: j.description, descriptionIsSnippet: j.descriptionIsSnippet },
    });
    kit.matchScore = Math.max(0, Math.min(100, Math.round(Number(kit.matchScore) || 0)));
    state.kits[j.id] = { kit: unmask(kit, map), at: Date.now(), resumeId: resume.id, resumeName: resume.name };
    state.docTab = 'resume';
    saveKits();
    toast(`Apply kit ready for ${j.company || j.title}.`);
  } catch (err) {
    toast(err.message);
    if (/model/i.test(err.message) && /not found|not supported/i.test(err.message)) toast('That model is unavailable. Open Settings and press "Check key" to pick another.');
  } finally {
    state.tailoring.delete(j.id);
    if (state.selectedId === j.id) renderDetail();
    renderFeed();
  }
}

async function copy(text, okMsg = 'Copied.') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; } catch { toast('Clipboard blocked. Select the text and copy it manually.'); return false; }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Render light markdown into a print-only node and open the browser's print dialog (Save as PDF).
function printDoc(text, title) {
  const html = esc(text).split('\n').map((line) => {
    if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`;
    if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
    if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
    if (/^\s*[-*] /.test(line)) return `<li>${line.replace(/^\s*[-*] /, '')}</li>`;
    if (!line.trim()) return '<br>';
    return `<p>${line}</p>`;
  }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  const node = document.createElement('div');
  node.className = 'print-doc';
  node.innerHTML = `<style>
    @page { margin: 16mm; }
    .print-doc { font: 10.5pt/1.45 'Archivo', sans-serif; color: #111; }
    .print-doc h1 { font: 900 20pt/1.1 'Archivo', sans-serif; margin: 0 0 4pt; color: #1F06AC; }
    .print-doc h2 { font: 800 11.5pt 'Archivo', sans-serif; margin: 12pt 0 4pt; padding-bottom: 2pt; border-bottom: 1.5pt solid #1F06AC; color: #1F06AC; }
    .print-doc h3 { font: 800 10.5pt 'Archivo', sans-serif; margin: 8pt 0 2pt; }
    .print-doc p { margin: 0 0 3pt; } .print-doc ul { margin: 2pt 0 4pt; padding-left: 14pt; } .print-doc br { line-height: 0.6; }
    @media screen { .print-doc { display: none; } }
  </style>${html}`;
  document.body.appendChild(node);
  const prevTitle = document.title;
  document.title = title;
  window.print();
  document.title = prevTitle;
  node.remove();
}

// ---------- resume dialog ----------
let pdfjs;
async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    pdfjs ??= await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      // Rebuild lines from y positions so bullets and sections survive.
      let lastY = null, line = '';
      const lines = [];
      for (const item of content.items) {
        const y = Math.round(item.transform?.[5] ?? 0);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += item.str + (item.hasEOL ? '' : '');
        lastY = y;
      }
      lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
    }
    return pages.join('\n\n');
  }
  if (name.endsWith('.docx')) {
    if (!window.mammoth) throw new Error('DOCX reader did not load.');
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (/\.(txt|md)$/.test(name)) return (await file.text()).trim();
  throw new Error('Use a PDF, DOCX, TXT or MD file.');
}

function fillResumeEditor() {
  const r = currentResume();
  $('#resumeSel').innerHTML = state.resumes.length
    ? state.resumes.map((x) => `<option value="${esc(x.id)}" ${x.id === r?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    : '<option value="">No resumes yet</option>';
  $('#resumeName').value = r?.name || '';
  $('#resumeText').value = r?.text || '';
  $('#resumeDelete').hidden = !r;
}

function openResume() {
  fillResumeEditor();
  $('#resumeStatus').textContent = '';
  $('#resumeDlg').showModal();
}

async function handleResumeFile(file) {
  const status = $('#resumeStatus');
  status.className = 'status'; status.textContent = `Reading ${file.name}...`;
  try {
    const text = await extractText(file);
    if (text.length < 80) throw new Error('Found almost no text. If this PDF is a scanned image, export it again as text or paste the text below.');
    const r = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), text, updatedAt: Date.now() };
    state.resumes.push(r);
    state.activeResume = r.id;
    store.set('resumes', state.resumes);
    store.set('activeResume', r.id);
    fillResumeEditor();
    status.className = 'status ok';
    status.textContent = `Read ${text.split(/\s+/).length} words. Check the text below; the original file was not stored.`;
    renderAll();
  } catch (err) {
    status.className = 'status err';
    status.textContent = err.message;
  }
}

// ---------- settings dialog ----------
function openSettings() {
  const s = state.settings;
  const boards = s.boards || state.config?.defaultBoards || {};
  $('#geminiKey').value = s.geminiKey;
  setModelOptions(s.model === 'auto' ? [] : [{ id: s.model }], s.model);
  $('#tone').value = s.tone;
  $('#maskContact').checked = s.maskContact;
  $('#notes').value = s.notes;
  $('#pName').value = s.profile.name; $('#pEmail').value = s.profile.email; $('#pPhone').value = s.profile.phone; $('#pLinkedin').value = s.profile.linkedin;
  $('#city').value = s.city; $('#radius').value = s.radius; $('#country').value = s.country;
  $('#adzId').value = s.adzuna.appId; $('#adzKey').value = s.adzuna.appKey;
  $('#bGreenhouse').value = (boards.greenhouse || []).join(', ');
  $('#bLever').value = (boards.lever || []).join(', ');
  $('#bAshby').value = (boards.ashby || []).join(', ');
  $('#sourceToggles').innerHTML = (state.config?.sources || []).map((src) => `<label class="check"><input type="checkbox" data-src="${esc(src.id)}" ${s.disabledSources.includes(src.id) ? '' : 'checked'}> <span>${esc(src.name)}</span></label>`).join('');
  $('#modelStatus').textContent = state.config?.serverGeminiKey ? 'A key is also set on the server (GEMINI_API_KEY); it is used when this field is empty.' : '';
  $('#settingsDlg').showModal();
}

const AUTO = { id: 'auto', label: 'Auto: best available, falls back when busy' };

function setModelOptions(models, selected) {
  models = [AUTO, ...models.filter((m) => m.id !== 'auto')];
  if (selected && !models.some((m) => m.id === selected)) models.push({ id: selected, label: `${selected} (not in your key's list)` });
  $('#geminiModel').innerHTML = models.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.id === 'auto' ? m.label : m.id)}</option>`).join('');
}

async function checkKey() {
  const st = $('#modelStatus');
  st.className = 'status'; st.textContent = 'Checking key with Google...';
  try {
    const { models } = await api('/api/models', { apiKey: $('#geminiKey').value.trim() });
    const current = $('#geminiModel').value;
    const pick = models.some((m) => m.id === current) ? current : 'auto';
    setModelOptions(models, pick);
    st.className = 'status ok';
    st.textContent = `Key works. ${models.length} models available. ${pick === 'auto' ? `Auto starts with ${models[0]?.id} and moves down the list if it is busy.` : `Using ${pick}; busy or retired models fall back automatically.`}`;
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  }
}

function saveSettings() {
  const split = (v) => v.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const prev = state.settings;
  const next = {
    ...prev,
    geminiKey: $('#geminiKey').value.trim(), model: $('#geminiModel').value || prev.model, tone: $('#tone').value,
    maskContact: $('#maskContact').checked, notes: $('#notes').value.trim(),
    profile: { name: $('#pName').value.trim(), email: $('#pEmail').value.trim(), phone: $('#pPhone').value.trim(), linkedin: $('#pLinkedin').value.trim() },
    city: $('#city').value.trim(), radius: Number($('#radius').value) || 25, country: $('#country').value,
    adzuna: { appId: $('#adzId').value.trim(), appKey: $('#adzKey').value.trim() },
    boards: { greenhouse: split($('#bGreenhouse').value), lever: split($('#bLever').value), ashby: split($('#bAshby').value) },
    disabledSources: $$('#sourceToggles input').filter((i) => !i.checked).map((i) => i.dataset.src),
  };
  state.settings = next;
  store.set('settings', next);
  $('#settingsDlg').close();
  toast('Settings saved.');
  loadJobs();
}

// ---------- events ----------
function bind() {
  // Freshness
  $$('input[name="age"]').forEach((r) => {
    r.checked = Number(r.value) === state.settings.maxAgeDays;
    r.addEventListener('change', () => {
      state.settings.maxAgeDays = Number(r.value);
      store.set('settings', state.settings);
      loadJobs();
    });
  });

  let qTimer;
  $('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.filters.q = e.target.value; renderFacets(); renderFeed(); }, 150); });
  $('#catList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.filters.cat = b.dataset.cat || null; renderFacets(); renderFeed(); });
  $('#levelList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.filters.level = b.dataset.level || null; renderFacets(); renderFeed(); });
  $('#whereSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v === 'local' && !state.settings.city) { toast('Set your city in Settings to see jobs near you.'); openSettings(); return; }
    state.filters.where = b.dataset.v;
    $$('#whereSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderFacets(); renderFeed();
  });
  $('#entryOnly').checked = state.filters.entryOnly;
  $('#entryOnly').addEventListener('change', (e) => {
    state.filters.entryOnly = e.target.checked;
    store.set('entryOnly', e.target.checked);
    renderFacets(); renderFeed(); markNew(false);
  });
  for (const [id, key] of [['regionOnly', 'regionOnly'], ['hasEmail', 'hasEmail'], ['hideSeen', 'hideSeen']]) {
    $('#' + id).addEventListener('change', (e) => { state.filters[key] = e.target.checked; renderFacets(); renderFeed(); });
  }
  $('#sortSel').addEventListener('change', (e) => { state.filters.sort = e.target.value; renderFeed(); });

  $('#jobList').addEventListener('click', (e) => { const li = e.target.closest('.job'); if (li) select(li.dataset.id); });

  $('#refreshBtn').addEventListener('click', () => loadJobs(true));
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#resumeChip').addEventListener('click', openResume);

  // Detail actions
  const detail = $('#detail');
  detail.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act],[data-tab],[data-doc-tab]');
    if (!t) return;
    const j = selectedJob();
    if (!j) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderDetail(); return; }
    if (t.dataset.docTab) { state.docTab = t.dataset.docTab; renderDetail(); return; }
    const entry = state.kits[j.id];
    const current = () => $('#docText')?.value ?? '';
    switch (t.dataset.act) {
      case 'back': closeDetail(); break;
      case 'tailor': tailorJob(j); break;
      case 'resume': openResume(); break;
      case 'settings': openSettings(); break;
      case 'dismiss':
        state.dismissed.has(j.id) ? state.dismissed.delete(j.id) : state.dismissed.add(j.id);
        store.set('dismissed', [...state.dismissed].slice(-2000));
        renderFeed(); renderDetail(); break;
      case 'copy': copy(current()); break;
      case 'download': download(`${fileSlug(j.company)}-${state.docTab}.txt`, current()); break;
      case 'revert': delete entry.edits[state.docTab]; saveKits(); renderDetail(); break;
      case 'pdf': {
        const doc = t.dataset.doc;
        const name = state.settings.profile.name || 'Resume';
        printDoc(docText(entry, doc), `${name} - ${doc === 'resume' ? 'Resume' : 'Cover letter'} - ${j.company}`);
        break;
      }
      case 'applyCopy': copy(docText(entry, 'coverLetter'), 'Cover letter copied. Paste it into the form.'); break;
      case 'mailto':
      case 'gmail': {
        const to = $('#toEmail').value.trim();
        const raw = docText(entry, 'email');
        const m = raw.match(/^Subject:\s*(.*)\n+/);
        const subject = m ? m[1] : entry.kit.recruiterEmailSubject;
        const body = m ? raw.slice(m[0].length) : raw;
        if (to) { entry.to = to; saveKits(); }
        const url = t.dataset.act === 'mailto'
          ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
          : `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        if (!to) toast('No recruiter address. Add one, or fill it in your mail app.');
        window.open(url, t.dataset.act === 'mailto' ? '_self' : '_blank', 'noopener');
        toast('Attach your resume PDF before sending.');
        break;
      }
      case 'linkedin':
        await copy(docText(entry, 'linkedinNote'), 'LinkedIn note copied. Paste it when you click Connect, then Add a note.');
        window.open(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${j.company} recruiter`)}`, '_blank', 'noopener');
        break;
      case 'linkedinJob':
        window.open(`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${j.title} ${j.company}`)}&f_TPR=r604800`, '_blank', 'noopener');
        break;
    }
  });
  detail.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'pickResume') { state.activeResume = e.target.value; store.set('activeResume', state.activeResume); renderResumeChip(); }
  });
  let editTimer;
  detail.addEventListener('input', (e) => {
    if (e.target.id !== 'docText') return;
    const j = selectedJob(); const entry = state.kits[j.id];
    const limit = state.docTab === 'linkedinNote' ? 300 : null;
    $('#docCount').textContent = `${e.target.value.length} chars${limit ? ` / ${limit}` : ''}`;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => { entry.edits = { ...(entry.edits || {}), [state.docTab]: e.target.value }; saveKits(); }, 400);
  });

  // Resume dialog
  const drop = $('#drop');
  $('#resumeFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) handleResumeFile(f); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleResumeFile(f); });
  $('#resumeSel').addEventListener('change', (e) => { state.activeResume = e.target.value; store.set('activeResume', state.activeResume); fillResumeEditor(); renderAll(); });
  $('#resumeSave').addEventListener('click', () => {
    const text = $('#resumeText').value.trim();
    const name = $('#resumeName').value.trim() || 'My resume';
    if (text.length < 80) { $('#resumeStatus').className = 'status err'; $('#resumeStatus').textContent = 'Paste or upload a full resume first.'; return; }
    let r = currentResume();
    if (!r) { r = { id: crypto.randomUUID() }; state.resumes.push(r); state.activeResume = r.id; store.set('activeResume', r.id); }
    Object.assign(r, { name, text, updatedAt: Date.now() });
    store.set('resumes', state.resumes);
    $('#resumeStatus').className = 'status ok'; $('#resumeStatus').textContent = 'Saved in this browser.';
    fillResumeEditor(); renderAll();
  });
  $('#resumeDelete').addEventListener('click', () => {
    const r = currentResume(); if (!r || !confirm(`Delete "${r.name}" from this browser?`)) return;
    state.resumes = state.resumes.filter((x) => x.id !== r.id);
    state.activeResume = state.resumes[0]?.id || null;
    store.set('resumes', state.resumes); store.set('activeResume', state.activeResume);
    fillResumeEditor(); renderAll();
  });

  // Settings dialog
  // Enter inside a <form method="dialog"> would close it silently; make Enter save instead.
  $('#settingsForm').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'close') return;
    e.preventDefault();
    saveSettings();
  });
  $('#resumeDlg form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'close') return;
    e.preventDefault();
    $('#resumeSave').click();
  });
  $('#loadModels').addEventListener('click', checkKey);
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#clearCache').addEventListener('click', async () => { await api('/api/cache/clear', {}); toast('Job cache cleared.'); });
  $('#wipeAll').addEventListener('click', () => {
    if (!confirm('Erase resumes, keys, settings and apply kits from this browser? This cannot be undone.')) return;
    store.wipe(); location.reload();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = filtered();
    const i = list.findIndex((j) => j.id === state.selectedId);
    if (e.key === 'j' || e.key === 'k') {
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'j' ? 1 : -1)))];
      if (next) { select(next.id); $(`.job[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 't' && selectedJob()) tailorJob(selectedJob());
    else if (e.key === 'x' && selectedJob()) $('[data-act="dismiss"]')?.click();
    else if (e.key === 'Escape') closeDetail();
  });
}

async function init() {
  bind();
  renderResumeChip();
  try {
    state.config = await api('/api/config');
  } catch {
    showEmpty('Server not reachable', 'Start it with <code>npm start</code> in the project folder, then reload.');
    return;
  }
  if (state.config.hosted) {
    $('.privacy p').innerHTML = '<b>Private by design.</b> No accounts, analytics, cookies or remote assets. Your resume, keys and kits are stored only in this browser. When you press Tailor, the job and your resume text (contact details masked) pass through this site\'s server to Gemini and are not stored or logged. For fully local use, run it on your own computer with <code>npm start</code>.';
  }
  renderSources();
  // Refresh relative ages every minute without refetching.
  setInterval(() => { if (!state.loading) renderFeed(); }, 60000);
  scheduleAutoRefresh();
  // Catch up right away when you come back to a tab that missed refreshes.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.loading && Date.now() - state.lastLoaded > AUTO_REFRESH_MS) loadJobs(false, { silent: true });
  });
  loadJobs();
}

init();
