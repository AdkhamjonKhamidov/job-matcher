// /applications - browser-local application tracker and saved apply kits.
import { state, $, esc, safeUrl, saveKits, emit, age, CAT_LABEL, store, on } from '../core.js';
import { APPLICATION_STATUSES, downloadTracker, updateApplication } from '../tracker.js';

export function render(el) {
  let noteTimer;
  const draw = () => {
    const apps = [...state.applications].sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || ''));
    const kits = Object.entries(state.kits).sort((a, b) => b[1].at - a[1].at);
    el.innerHTML = `
      <div class="page page-narrow page-applications">
        <header class="page-head">
          <h1>Applications</h1>
          <p class="muted">Track jobs you opened and update progress. Your tracker stays in this browser.</p>
        </header>
        <section class="tracker-section" aria-labelledby="trackerTitle">
          <div class="tracker-head">
            <div><h2 id="trackerTitle">Application tracker</h2><p class="muted small">${apps.length} tracked job${apps.length === 1 ? '' : 's'} · Stored only on this device</p></div>
            <div class="row tracker-export">
              <button class="btn ghost" type="button" data-export="csv" ${apps.length ? '' : 'disabled'}>Download CSV</button>
              <button class="btn ghost" type="button" data-export="tsv" ${apps.length ? '' : 'disabled'}>Download TSV</button>
            </div>
          </div>
          ${apps.length ? `<div class="tracker-list">${apps.map((item) => {
            const opened = item.firstOpenedAt ? new Date(item.firstOpenedAt).toLocaleDateString() : '—';
            const applied = item.appliedAt ? ` · Applied ${new Date(item.appliedAt).toLocaleDateString()}` : '';
            const externalUrl = item.applyUrl || item.url;
            return `<article class="card tracker-card" data-tracker="${esc(item.id)}">
              <div class="tracker-main">
                <h3>${esc(item.title)}</h3>
                <p class="meta"><b>${esc(item.company || 'Unknown employer')}</b>${item.location ? ` · ${esc(item.location)}` : ''}${item.category ? ` · ${esc(CAT_LABEL[item.category] || item.category)}` : ''}</p>
                <p class="muted small">Opened ${esc(opened)}${applied}${item.openCount > 1 ? ` · Opened ${item.openCount} times` : ''}</p>
              </div>
              <label class="field tracker-status"><span>Application status</span><select data-status="${esc(item.id)}" aria-label="Status for ${esc(item.title)}">
                ${APPLICATION_STATUSES.map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select></label>
              <details class="tracker-notes">
                <summary>${item.notes ? 'Edit notes' : 'Add a note'}</summary>
                <label class="field"><span>Private note (optional)</span><textarea rows="2" maxlength="2000" data-notes="${esc(item.id)}">${esc(item.notes || '')}</textarea></label>
              </details>
              <div class="tracker-actions">
                ${externalUrl ? `<a class="btn ghost small" href="${safeUrl(externalUrl)}" target="_blank" rel="noopener noreferrer" data-apply-link="${esc(item.id)}">Open application site</a>` : ''}
                <a class="btn ghost small" href="/jobs/${encodeURIComponent(item.id)}" data-link>View posting</a>
                <button class="btn ghost small danger" type="button" data-remove="${esc(item.id)}">Remove</button>
              </div>
            </article>`;
          }).join('')}</div>` : `<div class="card tracker-empty"><p class="big">No applications tracked yet</p><p class="muted">Open a company's application link from a job posting. We’ll ask whether you finished, then keep the status here.</p><a class="btn accent" href="/" data-link>Find a job</a></div>`}
        </section>

        <section class="kits-section" aria-labelledby="kitsTitle">
          <h2 id="kitsTitle">Apply kits</h2>
          <p class="muted small">Tailored documents are saved separately from your tracker.</p>
          ${kits.length ? `<ul class="kit-list">${kits.map(([id, entry]) => {
            const job = entry.job || { title: 'Saved kit', company: '' };
            const made = age(entry.at);
            return `<li class="kit-row">
              <div class="kit-score" title="Match score">${entry.kit.matchScore}</div>
              <div class="kit-main">
                <a class="kit-title" href="/apply/${encodeURIComponent(id)}" data-link>${esc(job.title)}</a>
                <p class="meta"><b>${esc(job.company || '')}</b>${job.location ? ` · ${esc(job.location)}` : ''}${job.category ? ` · ${esc(CAT_LABEL[job.category] || '')}` : ''}</p>
                <p class="meta">Made ${made.small === 'ago' ? `${made.big} ago` : made.small}${entry.to ? ` · recruiter ${esc(entry.to)}` : ''}</p>
              </div>
              <div class="kit-actions">
                <a class="btn small" href="/apply/${encodeURIComponent(id)}" data-link>Open kit</a>
                ${job.applyUrl ? `<a class="btn ghost small" href="${safeUrl(job.applyUrl)}" target="_blank" rel="noopener noreferrer" data-apply-link="${esc(id)}">Company page</a>` : ''}
                <button class="btn ghost small danger" type="button" data-del="${esc(id)}">Delete</button>
              </div>
            </li>`;
          }).join('')}</ul>`
          : `<div class="card empty-card"><p class="muted">No apply kits yet. Tailoring is optional; tracking and job search work without AI.</p></div>`}
        </section>
      </div>`;
  };

  el.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button?.dataset.export) downloadTracker(button.dataset.export);
    if (button?.dataset.remove) {
      const item = state.applications.find((application) => application.id === button.dataset.remove);
      if (!confirm(`Remove "${item?.title || 'this job'}" from your tracker? This cannot be undone.`)) return;
      state.applications = state.applications.filter((item) => item.id !== button.dataset.remove);
      store.set('applications', state.applications);
      draw();
      return;
    }
    if (!button?.dataset.del) return;
    const entry = state.kits[button.dataset.del];
    if (!confirm(`Delete the apply kit for "${entry?.job?.title || 'this job'}"? This can't be undone.`)) return;
    delete state.kits[button.dataset.del];
    saveKits();
    emit('kits');
    draw();
  });
  el.addEventListener('change', (event) => {
    const select = event.target.closest('[data-status]');
    if (select) updateApplication(select.dataset.status, { status: select.value });
  });
  el.addEventListener('input', (event) => {
    const input = event.target.closest('[data-notes]');
    if (!input) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => updateApplication(input.dataset.notes, { notes: input.value }), 250);
  });
  draw();
  const offApplications = on('applications', draw);
  return { destroy: () => { clearTimeout(noteTimer); offApplications(); } };
}
