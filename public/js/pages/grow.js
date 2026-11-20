// /grow  -  what to build and which certifications to get, tracked locally.
import { state, $, $$, esc, on, api, store, toast, copy, currentResume, CAT_LABEL, LEVELS, WORK_AUTH, activeAIKey, activeAIProvider } from '../core.js';
import { passes } from '../filters.js';
import { loadFullText } from '../data.js';
import { maskText } from '../docs.js';
import { demandFor } from '../demand.js';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
const PROJECT_STATUS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
const CERT_STATUS = [['todo', 'Not started'], ['doing', 'Studying'], ['booked', 'Exam booked'], ['done', 'Passed']];

function load() {
  return store.get('plan', null);
}
function save(p) { store.set('plan', p); }

function targetsText() {
  const f = state.filters;
  const roles = f.roles.length ? f.roles.map((r) => CAT_LABEL[r]).join(', ') : 'any career field';
  const level = f.levels.length ? LEVELS.filter(([id]) => f.levels.includes(id)).map(([, l]) => l).join(' / ') : 'any level';
  const location = f.loc ? `${f.loc.label}${f.locRemote ? ' or remote' : ''}` : f.where === 'remote' ? 'remote' : state.settings.city || 'anywhere in the US';
  return { roles, level, location, workAuth: WORK_AUTH[state.settings.workAuth]?.note || '' };
}

export function render(el) {
  let reading = false, generating = false, readNote = '';

  // Demand is counted across your roles and level nationwide (not just your search area),
  // so the plan rests on enough postings to mean something.
  const matching = () => {
    const f = state.filters;
    return state.jobs.filter((j) => (!f.roles.length || f.roles.includes(j.category)) && (!f.levels.length || f.levels.includes(j.level)));
  };

  // Pull full text for title-only postings so the skill counts mean something.
  const readPostings = async () => {
    const need = matching().filter((j) => j.needsFullText && !j.fullTextLoaded).slice(0, 24);
    if (!need.length) return;
    reading = true; readNote = `Reading ${need.length} postings...`; draw();
    let done = 0;
    const queue = [...need];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const j = queue.shift();
        await loadFullText(j).catch(() => {});
        done++;
        if (el.isConnected) { readNote = `Reading postings: ${done} of ${need.length}`; const n = $('[data-read-note]', el); if (n) n.textContent = readNote; }
      }
    }));
    reading = false; readNote = '';
    if (el.isConnected) draw();
  };

  const bars = (items, key, total) => items.length ? `<ul class="bars">${items.map((x) => `
    <li class="${x.inResume ? 'b-have' : 'b-miss'}">
      <span class="bar-label">${esc(x[key])}</span>
      <span class="bar"><i style="width:${Math.max(4, Math.round((x.count / Math.max(1, items[0].count)) * 100))}%"></i></span>
      <span class="bar-n">${x.count}</span>
      <span class="bar-flag">${x.inResume ? 'on your resume' : 'missing'}</span>
    </li>`).join('')}</ul>` : '<p class="muted">None mentioned yet.</p>';

  const statusSelect = (key, options, value) => `<select class="pi-status" data-status="${esc(key)}" aria-label="Status">${options.map(([v, l]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

  const progressOf = (p) => {
    const keys = [...p.plan.projects.map((x) => `p:${slug(x.title)}`), ...p.plan.certifications.map((x) => `c:${slug(x.name)}`)];
    const done = keys.filter((k) => p.progress?.[k] === 'done').length;
    return { done, total: keys.length };
  };

  const planView = (p) => {
    const pr = progressOf(p);
    const steps = (key, list) => `<ol class="check-steps">${list.map((s, i) => `<li><label><input type="checkbox" data-step="${esc(key)}" data-i="${i}" ${p.steps?.[key]?.[i] ? 'checked' : ''}> <span>${esc(s)}</span></label></li>`).join('')}</ol>`;
    return `
      <section class="plan-top">
        <div class="score-band"><div class="num">${p.plan.readiness}<small>/100</small></div><p>${esc(p.plan.summary)}</p></div>
        <div class="progress-card">
          <b>${pr.done} of ${pr.total} done</b>
          <div class="progress"><span style="width:${pr.total ? (pr.done / pr.total) * 100 : 0}%"></span></div>
          <p class="muted small">Plan for ${esc(p.targets.roles)} (${esc(p.targets.level)}), made ${esc(new Date(p.at).toLocaleDateString())}${p.plan.model ? ` by ${esc(p.plan.model)}` : ''}.</p>
        </div>
      </section>

      <h2 class="plan-h">Build these projects</h2>
      <div class="plan-list">${p.plan.projects.map((x) => {
        const key = `p:${slug(x.title)}`;
        const st = p.progress?.[key] || 'todo';
        return `<article class="plan-item ${st}">
          <header class="pi-head"><h3>${esc(x.title)}</h3>${statusSelect(key, PROJECT_STATUS, st)}</header>
          <p>${esc(x.why)}</p>
          <div class="tags">${(x.demonstrates || []).map((d) => `<span class="tag cat">${esc(d)}</span>`).join('')}</div>
          <p class="meta">${esc(x.time)} · ${esc(x.cost)} · ${esc(x.difficulty)}</p>
          ${steps(key, x.steps || [])}
          <p><b>Show employers:</b> ${esc(x.deliverable)}</p>
          <div class="bullet-box"><span><b>${st === 'done' ? 'Add to your resume:' : 'Resume line once it\'s done:'}</b> ${esc(x.resumeBullet)}</span><button type="button" class="btn ghost small" data-copy="${esc(x.resumeBullet)}">Copy</button></div>
        </article>`;
      }).join('')}</div>

      <h2 class="plan-h">Get these certifications</h2>
      <div class="plan-list">${p.plan.certifications.map((x) => {
        const key = `c:${slug(x.name)}`;
        const st = p.progress?.[key] || 'todo';
        return `<article class="plan-item ${st}">
          <header class="pi-head"><h3><span class="prio">${x.priority}</span> ${esc(x.name)}</h3>${statusSelect(key, CERT_STATUS, st)}</header>
          <p class="meta">${esc(x.issuer)} · ${esc(x.studyTime)} · ${esc(x.cost)}</p>
          <p>${esc(x.why)}</p>
          <p><b>Qualifies you for:</b> ${esc(x.unlocks)}</p>
          ${x.prerequisites ? `<p><b>Before you start:</b> ${esc(x.prerequisites)}</p>` : ''}
          ${steps(key, x.studyPlan || [])}
          <label class="field exam"><span>Exam date</span><input type="date" data-exam="${esc(key)}" value="${esc(p.exam?.[key] || '')}"></label>
        </article>`;
      }).join('')}</div>

      <div class="plan-cols">
        <section class="card"><h2 class="plan-h small">Quick wins for your resume</h2><ul class="check-steps">${(p.plan.quickWins || []).map((q, i) => `<li><label><input type="checkbox" data-step="q:quick" data-i="${i}" ${p.steps?.['q:quick']?.[i] ? 'checked' : ''}> <span>${esc(q)}</span></label></li>`).join('')}</ul></section>
        <section class="card"><h2 class="plan-h small">Skip for now</h2><ul class="plain">${(p.plan.skipForNow || []).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>
      </div>`;
  };

  const draw = () => {
    const jobs = matching();
    const d = demandFor(jobs, currentResume()?.text || '');
    const t = targetsText();
    const p = load();
    const provider = activeAIProvider();
    const hasKey = !!(activeAIKey() || state.config?.serverAiProviders?.[provider]);
    const r = currentResume();
    el.innerHTML = `
      <div class="page page-narrow page-grow">
        <header class="page-head">
          <h1>Grow</h1>
          <p class="muted">What to build and which certifications to get for <b>${esc(t.roles)}</b> (${esc(t.level)}), based on what current postings ask for and what your resume already shows. Change the target with the filters on the Jobs page.</p>
        </header>

        <section class="card demand">
          <div class="demand-head">
            <h2>What employers ask for</h2>
            <p class="muted small" data-read-note>${state.loading && !state.jobs.length ? 'Loading postings...' : reading ? esc(readNote) : `From ${d.total} postings for these roles and levels across the US in the last ${state.filters.days} days (${d.withText} with full text).`}</p>
          </div>
          <div class="demand-grid">
            <div><h3>Skills</h3>${bars(d.skills.slice(0, 12), 'skill', d.total)}</div>
            <div><h3>Certifications</h3>${bars(d.certs, 'name', d.total)}</div>
          </div>
        </section>

        ${generating ? `<section class="card"><h2>Making your plan</h2><div class="loading-bar"></div><p class="muted">Your selected AI provider is comparing your resume with these postings. This may take a minute.</p></section>`
          : p ? `${p.targets.roles !== t.roles || p.targets.level !== t.level ? `<p class="warn-box plan-stale">This plan was made for <b>${esc(p.targets.roles)}</b> (${esc(p.targets.level)}). Your filters now target <b>${esc(t.roles)}</b> (${esc(t.level)}). Make a new plan below to match, or change the filters back on the Jobs page.</p>` : ''}${planView(p)}<p class="regen"><button type="button" class="btn ghost" data-act="plan" ${hasKey && r ? '' : 'disabled'}>Make a new plan</button> <span class="muted small">Your progress on items with the same name is kept.</span></p>`
          : `<section class="card start">
              <h2>Make your plan</h2>
              <p class="muted">Your selected AI provider reads your resume and the demand above, then lists projects that prove missing skills, certifications worth getting, and quick resume fixes. You can check things off as you go.</p>
              <ul class="checklist">
                <li class="${r ? 'ok' : ''}">${r ? `Resume: <b>${esc(r.name)}</b>` : 'No resume yet <a class="btn ghost small" href="/resume" data-link>Add resume</a>'}</li>
                <li class="${hasKey ? 'ok' : ''}">${hasKey ? 'AI writing is ready' : 'AI writing is optional <a class="btn ghost small" href="/settings#gemini" data-link>Set up AI writing</a>'}</li>
              </ul>
              <button type="button" class="btn accent big" data-act="plan" ${hasKey && r && !reading ? '' : 'disabled'}>Make my plan</button>
            </section>`}
      </div>`;
  };

  const generatePlan = async () => {
    const r = currentResume();
    if (!r) return;
    await readPostings();
    const d = demandFor(matching(), r.text);
    const { text } = state.settings.maskContact ? maskText(r.text) : { text: r.text };
    generating = true; draw();
    try {
      const targets = targetsText();
      const plan = await api('/api/plan', { provider: activeAIProvider(), apiKey: activeAIKey(), model: state.settings.model, resumeText: text, targets, demand: d });
      const prev = load();
      save({ plan, targets, at: Date.now(), progress: prev?.progress || {}, steps: prev?.steps || {}, exam: prev?.exam || {} });
      toast('Your plan is ready.');
    } catch (err) {
      toast(err.message);
    } finally {
      generating = false;
      if (el.isConnected) draw();
    }
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="plan"]');
    if (b) return generatePlan();
    const c = e.target.closest('[data-copy]');
    if (c) copy(c.dataset.copy, 'Copied. Add it to your resume once the project is done.');
  });
  el.addEventListener('change', (e) => {
    const p = load();
    if (!p) return;
    const t = e.target;
    if (t.dataset.status) {
      p.progress = { ...(p.progress || {}), [t.dataset.status]: t.value };
      save(p);
      draw();
      if (t.value === 'done') toast(t.dataset.status.startsWith('c:') ? 'Nice. Add the certification to your resume.' : 'Nice. Copy the resume line for this project.');
    } else if (t.dataset.step) {
      const arr = [...(p.steps?.[t.dataset.step] || [])];
      arr[Number(t.dataset.i)] = t.checked;
      p.steps = { ...(p.steps || {}), [t.dataset.step]: arr };
      save(p);
    } else if (t.dataset.exam) {
      p.exam = { ...(p.exam || {}), [t.dataset.exam]: t.value };
      save(p);
    }
  });

  draw();
  if (state.jobs.length) readPostings();
  const offs = [on('jobs', () => { if (!generating) { draw(); readPostings(); } })];
  return { destroy: () => offs.forEach((off) => off()) };
}
