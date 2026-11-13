// Filtering rules and the filter panel shared by the Jobs and Map pages.
import { state, $, $$, esc, api, toast, saveFilters, CATS, LEVELS, milesBetween, currentResume, plural } from './core.js';
import { loadJobs, updateTitle } from './data.js';

// ---------- region / location ----------
const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
export const REGION = {
  us: { name: 'US', re: new RegExp(`\\b(us|u\\.s\\.?|usa|united states|americas?|north america|worldwide|anywhere|global)\\b|,\\s*(${STATES})\\b`, 'i') },
  ca: { name: 'Canada', re: /\b(canada|americas?|north america|worldwide|anywhere|global)\b|,\s*(ON|BC|AB|QC|MB|NS|SK)\b/i },
  gb: { name: 'UK', re: /\b(uk|united kingdom|england|scotland|wales|london|europe|emea|worldwide|anywhere|global)\b/i },
  au: { name: 'Australia', re: /\b(australia|apac|asia[- ]pacific|worldwide|anywhere|global|sydney|melbourne)\b/i },
  de: { name: 'Germany', re: /\b(germany|deutschland|dach|europe|eu|emea|worldwide|anywhere|global|berlin|munich|münchen|hamburg)\b/i },
  in: { name: 'India', re: /\b(india|apac|asia|worldwide|anywhere|global|bengaluru|bangalore|hyderabad|pune)\b/i },
};

function regionOk(job) {
  if (job.source === 'adzuna') return true; // already scoped to the chosen country
  if (state.settings.country === 'us' && (job.places || []).length) return true;
  const r = REGION[state.settings.country] || REGION.us;
  const loc = job.location || '';
  if (r.re.test(loc)) return true;
  if (job.remote) return loc.replace(/remote|\(|\)|\/|-|only|first|friendly|,/gi, '').trim().length === 0;
  return false;
}

// Closest distance in miles if the job is inside the searched place, else false.
export function inLocation(job, loc) {
  if (loc.kind === 'state' || loc.radius === 'state') return (job.states || []).includes(loc.state) ? 0 : false;
  let best = Infinity;
  for (const p of job.places || []) best = Math.min(best, milesBetween(loc, p));
  return best <= Number(loc.radius) ? best : false;
}

// Years of experience a level choice tolerates: entry 0-2, mid up to 4, senior anything.
function maxYears(levels) {
  if (!levels.length || levels.includes('senior')) return Infinity;
  return levels.includes('mid') ? 4 : 2;
}

export function passes(j, skip) {
  const f = state.filters;
  if (skip !== 'roles' && f.roles.length && !f.roles.includes(j.category)) return false;
  if (skip !== 'levels' && f.levels.length) {
    if (!f.levels.includes(j.level)) return false;
    if (j.minYears != null && j.minYears > maxYears(f.levels)) return false;
  }
  if (f.where === 'remote' && !j.remote) return false;
  if (f.where === 'onsite' && j.remote && !(j.places || []).length) return false;
  let near = false;
  if (f.loc) {
    const d = inLocation(j, f.loc);
    j._dist = d === false ? null : d;
    near = d !== false;
    if (!near && !(f.locRemote && j.remote && f.where !== 'onsite')) return false;
  }
  if (f.regionOnly && !near && !regionOk(j)) return false;
  if (f.hasEmail && !j.emails?.length) return false;
  if (f.hideSeen && state.dismissed.has(j.id) && j.id !== state.selectedId) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${j.title} ${j.company} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase();
    if (!q.split(/\s+/).every((t) => hay.includes(t) || j.description?.toLowerCase().includes(t))) return false;
  }
  return true;
}

export function filtered() {
  const list = state.jobs.filter((j) => passes(j));
  const sort = state.filters.sort;
  if (sort === 'match') {
    const score = (j) => state.kits[j.id]?.kit?.matchScore ?? (() => { const s = skillFit(j); return s ? Math.round((s.have / s.of) * 100) - 1 : -1; })();
    return list.map((j) => [score(j), j]).sort((a, b) => b[0] - a[0]).map(([, j]) => j);
  }
  if (sort === 'near' && state.filters.loc) return [...list].sort((a, b) => (a._dist ?? 1e9) - (b._dist ?? 1e9));
  return list;
}

// ---------- quick local skill overlap (no AI, no network) ----------
const SKILLS = ['active directory', 'azure ad', 'entra', 'office 365', 'microsoft 365', 'm365', 'intune', 'sccm', 'jamf', 'windows', 'macos', 'linux', 'ubuntu', 'powershell', 'bash', 'ticketing', 'servicenow', 'jira', 'zendesk', 'freshservice', 'itil', 'tcp/ip', 'dns', 'dhcp', 'vpn', 'lan', 'wan', 'firewall', 'cisco', 'networking', 'vmware', 'hyper-v', 'citrix', 'comptia', 'a+', 'network+', 'security+', 'ccna', 'printer', 'hardware', 'troubleshooting', 'imaging', 'okta', 'google workspace', 'exchange', 'sharepoint', 'remote desktop', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node', 'next.js', 'python', 'django', 'flask', 'fastapi', 'java', 'spring', 'kotlin', 'swift', 'c#', '.net', 'c++', 'golang', 'rust', 'ruby', 'rails', 'php', 'laravel', 'sql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'api', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ansible', 'ci/cd', 'github actions', 'jenkins', 'git', 'html', 'css', 'tailwind', 'figma', 'selenium', 'cypress', 'playwright', 'pytest', 'jest', 'spark', 'airflow', 'dbt', 'snowflake', 'pandas', 'tableau', 'power bi', 'excel', 'machine learning', 'pytorch', 'tensorflow', 'llm', 'siem', 'splunk', 'soc', 'incident response', 'vulnerability', 'nist', 'iso 27001', 'agile', 'scrum'];
const SKILL_RES = SKILLS.map((s) => [s, new RegExp(`(^|[^a-z0-9+#.])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`, 'i')]);
let resumeSkills = null;
export function skillFit(job) {
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

// Guess role interests from resume text (used to pre-tick onboarding choices).
export function suggestRoles(text = '') {
  const t = text.toLowerCase();
  const hits = [];
  if (/help ?desk|service desk|technical support|it support|desktop support|ticket/.test(t)) hits.push('helpdesk');
  if (/active directory|system administrat|sysadmin|network|intune|microsoft 365|m365/.test(t)) hits.push('it');
  if (/software|developer|javascript|typescript|python|java\b|react|node/.test(t)) hits.push('swe');
  if (/devops|kubernetes|docker|terraform|aws|azure|gcp|ci\/cd/.test(t)) hits.push('devops');
  if (/security|soc\b|siem|cyber|security\+/.test(t)) hits.push('security');
  if (/data (analyst|engineer|scien)|machine learning|sql|pandas|tableau|power bi/.test(t)) hits.push('data');
  if (/\bqa\b|quality assurance|selenium|cypress|test automation/.test(t)) hits.push('qa');
  return hits;
}

// ---------- location search ----------
export async function setLocation(query, radius, { reload = true } = {}) {
  const q = String(query || '').trim();
  if (!q) return clearLocation({ reload });
  const hit = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
  state.filters.loc = { ...hit, q, radius: hit.kind === 'state' ? 'state' : String(radius || 25) };
  if (state.filters.sort === 'new' && hit.kind === 'point') state.filters.sort = 'near';
  state.mapSel = null;
  saveFilters();
  if (reload && state.settings.adzuna?.appId) loadJobs();
  return state.filters.loc;
}

export function clearLocation({ reload = true } = {}) {
  state.filters.loc = null;
  if (state.filters.sort === 'near') state.filters.sort = 'new';
  saveFilters();
  if (reload && state.settings.adzuna?.appId) loadJobs();
}

export const locLabel = (loc) => (loc.kind === 'state' || loc.radius === 'state' ? `In ${loc.kind === 'state' ? loc.label : `${loc.state} (whole state)`}` : `Within ${loc.radius} mi of ${loc.label}`);

// ---------- the filter panel ----------
const chip = (attr, id, label, on, n) => `<button type="button" class="fchip" ${attr}="${id}" aria-pressed="${on}"><span>${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ''}</button>`;

export function renderRail(el, onChange) {
  const f = state.filters;
  const count = (skip, key, v) => state.jobs.filter((j) => j[key] === v && passes(j, skip)).length;
  const loading = state.loading && !state.jobs.length;
  // On phones the panel collapses behind a button that summarises what's on.
  const summary = [
    f.roles.length ? `${f.roles.length} role${f.roles.length > 1 ? 's' : ''}` : '',
    f.levels.length && f.levels.length < 4 ? LEVELS.filter(([id]) => f.levels.includes(id)).map(([, l]) => l).join(' + ') : '',
    f.where !== 'all' ? (f.where === 'remote' ? 'Remote' : 'On-site') : '',
    f.loc ? f.loc.label.replace(/\s\d{5}$/, '') : '',
    f.days !== 7 ? (f.days === 1 ? '24h' : '3 days') : '',
  ].filter(Boolean).join(' · ');
  const open = el.dataset.open === 'true';
  el.innerHTML = `
    <label class="search">
      <span class="sr-only">Search jobs</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input data-f="q" type="search" placeholder="Title, company, skill" autocomplete="off" value="${esc(f.q)}">
    </label>
    <button type="button" class="rail-toggle" data-rail-toggle aria-expanded="${open}"><b>Filters</b><span>${esc(summary || 'none')}</span></button>
    <div class="rail-body">

    <section class="rail-group">
      <h2>Posted within</h2>
      <div class="seg" role="group" aria-label="Posted within">
        ${[[1, '24 hours'], [3, '3 days'], [7, '7 days']].map(([d, l]) => `<button type="button" data-days="${d}" aria-pressed="${f.days === d}">${l}</button>`).join('')}
      </div>
    </section>

    <section class="rail-group">
      <h2>Role <span class="hint">${f.roles.length ? '' : 'all'}</span></h2>
      <div class="chips">${CATS.map(([id, label]) => chip('data-role', id, label, f.roles.includes(id), loading ? null : count('roles', 'category', id))).join('')}</div>
    </section>

    <section class="rail-group">
      <h2>Level <span class="hint">${f.levels.length && !f.levels.includes('senior') ? `hides ${f.levels.includes('mid') ? '5' : '3'}+ yrs required` : ''}</span></h2>
      <div class="chips">${LEVELS.map(([id, label]) => chip('data-level', id, label, f.levels.includes(id), loading ? null : count('levels', 'level', id))).join('')}</div>
    </section>

    <section class="rail-group">
      <h2>Where</h2>
      <div class="seg" role="group" aria-label="Where">
        ${[['all', 'Anywhere'], ['remote', 'Remote'], ['onsite', 'On-site']].map(([v, l]) => `<button type="button" data-where="${v}" aria-pressed="${f.where === v}">${l}</button>`).join('')}
      </div>
      <form class="loc-form" data-loc-form autocomplete="off">
        <label class="sr-only" for="locQ">City, state or ZIP</label>
        <input id="locQ" placeholder="City, state or ZIP" maxlength="80" value="${esc(f.loc?.q || (!f.loc ? state.settings.city : '') || '')}">
        <label class="sr-only" for="locRadius">Distance</label>
        <select id="locRadius">${['10', '25', '50', '100'].map((r) => `<option value="${r}" ${String(f.loc?.radius || 25) === r ? 'selected' : ''}>${r} mi</option>`).join('')}<option value="state" ${f.loc?.radius === 'state' ? 'selected' : ''}>Whole state</option></select>
        <button type="submit" class="btn small">Search</button>
      </form>
      ${f.loc ? `<div class="loc-chip"><span>${esc(locLabel(f.loc))}</span><button type="button" data-loc-clear aria-label="Clear location">&times;</button></div>
      ${f.where !== 'onsite' ? `<label class="check"><input type="checkbox" data-f="locRemote" ${f.locRemote ? 'checked' : ''}> <span>Include remote jobs too</span></label>` : ''}` : ''}
    </section>

    <details class="more rail-group" ${f.hasEmail || !f.regionOnly || !f.hideSeen ? 'open' : ''}>
      <summary>More filters</summary>
      <label class="check"><input type="checkbox" data-f="regionOnly" ${f.regionOnly ? 'checked' : ''}> <span>Only jobs open to ${esc((REGION[state.settings.country] || REGION.us).name)} applicants</span></label>
      <label class="check"><input type="checkbox" data-f="hasEmail" ${f.hasEmail ? 'checked' : ''}> <span>Has a recruiter email</span></label>
      <label class="check"><input type="checkbox" data-f="hideSeen" ${f.hideSeen ? 'checked' : ''}> <span>Hide jobs I dismissed</span></label>
    </details>
    </div>`;

  // The panel is redrawn often; its container listeners are attached once and
  // always call the latest onChange, so one click never fires twice.
  el._railOnChange = onChange;
  if (el._railBound) return;
  el._railBound = true;
  const changed = ({ reload = false } = {}) => {
    saveFilters();
    updateTitle();
    if (reload) loadJobs();
    el._railOnChange();
  };
  let qTimer;
  el.addEventListener('input', (e) => {
    if (e.target.dataset.f !== 'q') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.filters.q = e.target.value; el._railOnChange({ keepRail: true }); }, 150);
  });
  el.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-loc-form]')) return;
    e.preventDefault();
    submitLoc();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-rail-toggle')) {
      const nowOpen = el.dataset.open !== 'true';
      el.dataset.open = String(nowOpen);
      b.setAttribute('aria-expanded', String(nowOpen));
      return;
    }
    if (b.dataset.days) { state.filters.days = Number(b.dataset.days); changed({ reload: true }); }
    else if (b.dataset.role) { toggle(state.filters.roles, b.dataset.role); changed(); }
    else if (b.dataset.level) { toggle(state.filters.levels, b.dataset.level); changed(); }
    else if (b.dataset.where) { state.filters.where = b.dataset.where; changed(); }
    else if (b.hasAttribute('data-loc-clear')) { clearLocation(); changed(); }
  });
  el.addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (k && k !== 'q') { state.filters[k] = e.target.checked; changed(); }
    if (e.target.id === 'locRadius' && state.filters.loc) submitLoc();
  });
  const submitLoc = async () => {
    try {
      await setLocation(el.querySelector('#locQ').value, el.querySelector('#locRadius').value);
      changed();
    } catch (err) { toast(err.message); }
  };
}

function toggle(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}

export function resultSummary(list) {
  const f = state.filters;
  const days = f.days === 1 ? '24 hours' : `${f.days} days`;
  return `<b>${list.length}</b> ${list.length === 1 ? 'posting' : 'postings'} from the last ${days}${f.loc ? `, ${esc(locLabel(f.loc).replace(/^\w+/, (w) => w.toLowerCase()))}` : ''}`;
}

export const emptyHint = () => {
  if (!state.jobs.length) return state.loadError ? `The server said: ${esc(state.loadError)}` : 'Every source came back empty. Try refreshing in a minute.';
  const tips = [];
  if (state.filters.loc) tips.push('a bigger distance');
  if (state.filters.days < 7) tips.push('7 days');
  if (state.filters.roles.length) tips.push('more roles');
  if (state.filters.levels.length && !state.filters.levels.includes('mid')) tips.push('adding Mid level');
  return `Try ${tips.join(', ') || 'clearing the search box'}.${state.filters.loc && !state.settings.adzuna?.appId ? ' A free Adzuna key in Settings adds many more local on-site jobs.' : ''}`;
};

export { plural };
