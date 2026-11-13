// /applications  -  every apply kit made in this browser.
import { state, esc, safeUrl, saveKits, emit, age, CAT_LABEL } from '../core.js';

export function render(el) {
  const draw = () => {
    const kits = Object.entries(state.kits).sort((a, b) => b[1].at - a[1].at);
    el.innerHTML = `
      <div class="page page-narrow">
        <header class="page-head">
          <h1>Applications</h1>
          <p class="muted">Apply kits you've made. They live only in this browser.</p>
        </header>
        ${kits.length ? `<ul class="kit-list">${kits.map(([id, e]) => {
          const j = e.job || { title: 'Saved kit', company: '' };
          const a = age(e.at);
          return `<li class="kit-row">
            <div class="kit-score" title="Match score">${e.kit.matchScore}</div>
            <div class="kit-main">
              <a class="kit-title" href="/apply/${encodeURIComponent(id)}" data-link>${esc(j.title)}</a>
              <p class="meta"><b>${esc(j.company || '')}</b>${j.location ? ` · ${esc(j.location)}` : ''}${j.category ? ` · ${esc(CAT_LABEL[j.category] || '')}` : ''}</p>
              <p class="meta">Made ${a.big} ${a.small === 'ago' ? 'ago' : a.small}${e.to ? ` · recruiter ${esc(e.to)}` : ''}</p>
            </div>
            <div class="kit-actions">
              <a class="btn small" href="/apply/${encodeURIComponent(id)}" data-link>Open kit</a>
              ${j.applyUrl ? `<a class="btn ghost small" href="${safeUrl(j.applyUrl)}" target="_blank" rel="noopener noreferrer">Company page</a>` : ''}
              <button class="btn ghost small danger" type="button" data-del="${esc(id)}">Delete</button>
            </div>
          </li>`;
        }).join('')}</ul>`
        : `<div class="card empty-card"><p class="big">No apply kits yet</p><p class="muted">Open a posting and press <b>Tailor and apply</b>. Gemini writes a resume, cover letter, recruiter email and LinkedIn note for it, and the kit shows up here.</p><a class="btn" href="/" data-link>Browse jobs</a></div>`}
      </div>`;
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const e2 = state.kits[b.dataset.del];
    if (!confirm(`Delete the apply kit for "${e2?.job?.title || 'this job'}"? This can't be undone.`)) return;
    delete state.kits[b.dataset.del];
    saveKits();
    emit('kits');
    draw();
  });
  draw();
}
