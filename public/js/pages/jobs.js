import { state, $, $$, on, store, findJob, saveFilters } from '../core.js';
import { renderRail, filtered, resultSummary, emptyHint } from '../filters.js';
import { jobRow, postingDetail } from '../components.js';
import { loadFullText, updateTitle } from '../data.js';
import { navigate } from '../router.js';

export function render(el, id) {
  el.innerHTML = `
    <div class="page page-jobs">
      <aside class="rail" aria-label="Filters"></aside>
      <section class="feed" aria-label="Job postings">
        <div class="feed-head">
          <p class="count" aria-live="polite"></p>
          <label class="sort"><span>Sort</span>
            <select data-sort>
              <option value="new">Newest</option>
              <option value="match">Best match</option>
              <option value="near">Closest</option>
            </select>
          </label>
        </div>
        <ol class="job-list" role="listbox" aria-label="Job postings"></ol>
        <div class="empty" hidden></div>
      </section>
      <section class="detail" aria-label="Job detail" aria-live="polite"></section>
    </div>`;
  const rail = $('.rail', el), list = $('.job-list', el), detail = $('.detail', el), sortSel = $('[data-sort]', el);

  const drawList = () => {
    const jobs = filtered();
    $('.count', el).innerHTML = state.loading && !state.jobs.length ? 'Checking job boards...' : resultSummary(jobs);
    sortSel.value = state.filters.sort;
    sortSel.querySelector('[value="near"]').disabled = !(state.filters.loc?.kind === 'point');
    const empty = $('.empty', el);
    if (state.loading && !state.jobs.length) {
      list.innerHTML = Array.from({ length: 8 }, () => '<li class="skel" aria-hidden="true"></li>').join('');
      empty.hidden = true;
      return;
    }
    empty.hidden = jobs.length > 0;
    if (!jobs.length) empty.innerHTML = `<p class="big">Nothing matches yet</p><p>${emptyHint()}</p>`;
    list.innerHTML = jobs.slice(0, 400).map((j) => jobRow(j, { selected: j.id === state.selectedId })).join('');
  };

  const drawDetail = () => {
    const j = state.selectedId && findJob(state.selectedId);
    el.querySelector('.page-jobs').classList.toggle('has-detail', !!j);
    if (!j) {
      detail.innerHTML = state.selectedId && !state.loading
        ? '<div class="detail-empty"><p class="big">Posting not found</p><p>It may have dropped out of the date range or been removed by the employer.</p><a class="btn ghost" href="/" data-link>Back to jobs</a></div>'
        : `<div class="detail-empty"><p class="big">Pick a posting</p><p>Read it here, then press <b>Tailor and apply</b> to get a resume, cover letter, recruiter email and LinkedIn note written for that job.</p><p class="kbd-hint">Keys: <kbd>j</kbd> <kbd>k</kbd> move, <kbd>x</kbd> dismiss</p></div>`;
      return;
    }
    detail.innerHTML = postingDetail(j, { back: '/' });
  };

  const drawAll = () => { renderRail(rail, ({ keepRail } = {}) => { if (!keepRail) drawRailOnly(); drawList(); }); drawList(); drawDetail(); };
  const drawRailOnly = () => renderRail(rail, ({ keepRail } = {}) => { if (!keepRail) drawRailOnly(); drawList(); });

  const select = (jobId) => {
    const prev = state.selectedId;
    state.selectedId = jobId || null;
    // A job dismissed while open stays visible until you leave it; then hide it.
    if (prev && prev !== jobId && state.dismissed.has(prev) && state.filters.hideSeen) drawList();
    $$('.job', list).forEach((li) => li.setAttribute('aria-selected', String(li.dataset.id === state.selectedId)));
    drawDetail();
    detail.scrollTop = 0;
    const j = jobId && findJob(jobId);
    if (j) {
      loadFullText(j).catch(() => {});
      if (state.newIds.delete(j.id)) { updateTitle(); const li = $(`.job[data-id="${CSS.escape(j.id)}"]`, list); if (li) li.outerHTML = jobRow(j, { selected: true }); }
    }
  };

  list.addEventListener('click', (e) => {
    const li = e.target.closest('.job');
    if (li) navigate(`/jobs/${encodeURIComponent(li.dataset.id)}`);
  });
  sortSel.addEventListener('change', () => { state.filters.sort = sortSel.value; saveFilters(); drawList(); });
  detail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="dismiss"]');
    if (!b || !state.selectedId) return;
    const idv = state.selectedId;
    state.dismissed.has(idv) ? state.dismissed.delete(idv) : state.dismissed.add(idv);
    store.set('dismissed', [...state.dismissed].slice(-2000));
    drawList(); drawDetail();
  });

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const jobs = filtered();
    const i = jobs.findIndex((j) => j.id === state.selectedId);
    if (e.key === 'j' || e.key === 'k') {
      const next = jobs[Math.max(0, Math.min(jobs.length - 1, i + (e.key === 'j' ? 1 : -1)))];
      if (next) { navigate(`/jobs/${encodeURIComponent(next.id)}`, { replace: true }); $(`.job[data-id="${CSS.escape(next.id)}"]`, list)?.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'x' && state.selectedId) $('[data-act="dismiss"]', detail)?.click();
    else if (e.key === 'Escape' && state.selectedId) navigate('/');
  };
  document.addEventListener('keydown', onKey);

  const offs = [
    on('jobs', () => { drawAll(); if (state.selectedId) loadFullText(findJob(state.selectedId)).catch(() => {}); }),
    on('loading', () => { if (!state.jobs.length) drawList(); }),
    on('tick', drawList),
    on('job', (jid) => { if (jid === state.selectedId) drawDetail(); const j = findJob(jid); const li = j && $(`.job[data-id="${CSS.escape(jid)}"]`, list); if (li) li.outerHTML = jobRow(j, { selected: jid === state.selectedId }); }),
  ];

  state.selectedId = id || null;
  drawAll();
  if (id) select(id);

  return {
    update: (newId) => select(newId),
    destroy: () => { offs.forEach((off) => off()); document.removeEventListener('keydown', onKey); },
  };
}
