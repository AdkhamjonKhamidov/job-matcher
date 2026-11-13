// /settings
import { state, $, $$, esc, safeUrl, api, toast, store, saveSettings, on } from '../core.js';
import { loadJobs } from '../data.js';
import { navigate } from '../router.js';

const AUTO = { id: 'auto', label: 'Auto: best available, falls back when busy' };

function modelOptions(models, selected) {
  const list = [AUTO, ...models.filter((m) => m.id !== 'auto')];
  if (selected && !list.some((m) => m.id === selected)) list.push({ id: selected, label: selected });
  return list.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.id === 'auto' ? m.label : m.id)}</option>`).join('');
}

function sourceRows() {
  const status = Object.fromEntries(state.sources.map((s) => [s.id, s]));
  return (state.config?.sources || []).map((src) => {
    const s = status[src.id];
    const on = !state.settings.disabledSources.includes(src.id);
    let st = 'not loaded yet', cls = '';
    if (s?.state === 'ok') st = `${s.count} tech jobs of ${s.total}`;
    else if (s?.state === 'error') { st = 'failed'; cls = 'err'; }
    else if (s?.state === 'setup') { st = 'needs a key'; cls = 'warn'; }
    else if (s?.state === 'off' || !on) st = 'off';
    return `<li><label class="check"><input type="checkbox" data-src="${esc(src.id)}" ${on ? 'checked' : ''}> <span><a href="${safeUrl(src.home)}" target="_blank" rel="noopener noreferrer">${esc(src.name)}</a></span></label><span class="st ${cls}" ${s?.error ? `title="${esc(s.error)}"` : ''}>${esc(st)}</span></li>`;
  }).join('');
}

export function render(el) {
  const s = state.settings;
  const boards = s.boards || state.config?.defaultBoards || {};
  el.innerHTML = `
    <div class="page page-narrow">
      <header class="page-head"><h1>Settings</h1><p class="muted">Saved only in this browser.</p></header>
      <form class="settings" data-form>
        <section class="card" id="gemini">
          <h2>Gemini</h2>
          <p class="muted">Writes your apply kits. Get a free key at aistudio.google.com/apikey.</p>
          <div class="row">
            <label class="field grow"><span>API key</span><input data-k="geminiKey" type="password" autocomplete="off" spellcheck="false" value="${esc(s.geminiKey)}" placeholder="${state.config?.serverGeminiKey ? 'Using the server key from .env' : 'Paste your key'}"></label>
            <label class="field grow"><span>Model</span><select data-k="model">${modelOptions([], s.model)}</select></label>
            <button type="button" class="btn ghost" data-act="checkKey">Check key</button>
          </div>
          <p class="status" data-model-status role="status"></p>
          <div class="row">
            <label class="field"><span>Tone</span><select data-k="tone">
              ${[['professional and direct', 'Professional'], ['warm and conversational', 'Warm'], ['concise and technical', 'Technical']].map(([v, l]) => `<option value="${v}" ${s.tone === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
            <label class="check"><input type="checkbox" data-k="maskContact" ${s.maskContact ? 'checked' : ''}> <span>Hide my email, phone and links from Gemini (they're put back afterwards)</span></label>
          </div>
          <label class="field"><span>Notes for every application (optional)</span><textarea data-k="notes" rows="2" placeholder="e.g. CompTIA A+ in progress, expected Jan 2027. Open to relocating.">${esc(s.notes)}</textarea></label>
        </section>

        <section class="card" id="profile">
          <h2>You</h2>
          <p class="muted">Used for email signatures and file names. Never sent to Gemini.</p>
          <div class="row">
            <label class="field grow"><span>Full name</span><input data-p="name" autocomplete="name" value="${esc(s.profile.name)}"></label>
            <label class="field grow"><span>Email</span><input data-p="email" type="email" autocomplete="email" value="${esc(s.profile.email)}"></label>
          </div>
          <div class="row">
            <label class="field grow"><span>Phone</span><input data-p="phone" autocomplete="tel" value="${esc(s.profile.phone)}"></label>
            <label class="field grow"><span>LinkedIn URL</span><input data-p="linkedin" placeholder="linkedin.com/in/you" value="${esc(s.profile.linkedin)}"></label>
          </div>
        </section>

        <section class="card" id="location">
          <h2>Location</h2>
          <p class="muted">For on-site jobs near you (most helpdesk and field IT roles), add a free Adzuna key from developer.adzuna.com.</p>
          <div class="row">
            <label class="field grow"><span>Home city or ZIP</span><input data-k="city" placeholder="e.g. Dallas, TX" value="${esc(s.city)}"></label>
            <label class="field"><span>Radius (miles)</span><input data-k="radius" type="number" min="1" max="100" value="${esc(s.radius)}"></label>
            <label class="field"><span>Country</span><select data-k="country">
              ${[['us', 'United States'], ['ca', 'Canada'], ['gb', 'United Kingdom'], ['au', 'Australia'], ['de', 'Germany'], ['in', 'India']].map(([v, l]) => `<option value="${v}" ${s.country === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
          </div>
          <div class="row">
            <label class="field grow"><span>Adzuna app ID</span><input data-a="appId" autocomplete="off" spellcheck="false" value="${esc(s.adzuna.appId)}"></label>
            <label class="field grow"><span>Adzuna app key</span><input data-a="appKey" type="password" autocomplete="off" spellcheck="false" value="${esc(s.adzuna.appKey)}"></label>
          </div>
        </section>

        <section class="card" id="sources">
          <h2>Job sources</h2>
          <p class="muted">Where postings come from, and how many fresh tech postings each one had on the last check.</p>
          <ul class="source-list" data-sources>${sourceRows()}</ul>
          <details class="boards">
            <summary>Company career pages</summary>
            <p class="muted">Add companies by the name in their careers link, separated by commas: boards.greenhouse.io/<b>name</b>, jobs.lever.co/<b>name</b>, jobs.ashbyhq.com/<b>name</b>.</p>
            <label class="field"><span>Greenhouse</span><input data-b="greenhouse" spellcheck="false" value="${esc((boards.greenhouse || []).join(', '))}"></label>
            <label class="field"><span>Lever</span><input data-b="lever" spellcheck="false" value="${esc((boards.lever || []).join(', '))}"></label>
            <label class="field"><span>Ashby</span><input data-b="ashby" spellcheck="false" value="${esc((boards.ashby || []).join(', '))}"></label>
          </details>
        </section>

        <div class="save-bar"><button type="submit" class="btn accent">Save settings</button></div>
      </form>

      <section class="card" id="data">
        <h2>Your data</h2>
        <div class="row">
          <a class="btn ghost" href="/welcome" data-link>Redo the setup questions</a>
          ${state.config?.hosted ? '' : '<button type="button" class="btn ghost" data-act="clearCache">Clear job cache</button>'}
          <button type="button" class="btn ghost danger" data-act="wipe">Erase everything in this browser</button>
        </div>
      </section>
    </div>`;

  const checkKey = async () => {
    const st = $('[data-model-status]', el);
    st.className = 'status'; st.textContent = 'Checking the key with Google...';
    try {
      const { models } = await api('/api/models', { apiKey: $('[data-k="geminiKey"]', el).value.trim() });
      const sel = $('[data-k="model"]', el);
      const keep = models.some((m) => m.id === sel.value) ? sel.value : 'auto';
      sel.innerHTML = modelOptions(models, keep);
      st.className = 'status ok';
      st.textContent = `Key works. ${keep === 'auto' ? `Auto starts with ${models[0]?.id} and moves on if it's busy.` : `Using ${keep}.`}`;
      return true;
    } catch (err) { st.className = 'status err'; st.textContent = err.message; return false; }
  };

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'checkKey') checkKey();
    if (act === 'clearCache') { await api('/api/cache/clear', {}); toast('Job cache cleared.'); loadJobs({ force: true }); }
    if (act === 'wipe' && confirm('Erase resumes, keys, settings and apply kits from this browser? This cannot be undone.')) { store.wipe(); location.href = '/welcome'; }
  });

  el.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    const v = (k) => $(`[data-k="${k}"]`, el);
    const split = (x) => x.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const before = JSON.stringify([s.adzuna, s.boards, s.disabledSources, s.country, s.city]);
    Object.assign(s, {
      geminiKey: v('geminiKey').value.trim(), model: v('model').value, tone: v('tone').value, maskContact: v('maskContact').checked, notes: v('notes').value.trim(),
      city: v('city').value.trim(), radius: Number(v('radius').value) || 25, country: v('country').value,
      profile: Object.fromEntries($$('[data-p]', el).map((i) => [i.dataset.p, i.value.trim()])),
      adzuna: Object.fromEntries($$('[data-a]', el).map((i) => [i.dataset.a, i.value.trim()])),
      boards: Object.fromEntries($$('[data-b]', el).map((i) => [i.dataset.b, split(i.value)])),
      disabledSources: $$('[data-src]', el).filter((i) => !i.checked).map((i) => i.dataset.src),
    });
    saveSettings();
    toast('Settings saved.');
    if (JSON.stringify([s.adzuna, s.boards, s.disabledSources, s.country, s.city]) !== before) loadJobs();
  });

  if (location.hash) setTimeout(() => $(location.hash, el)?.scrollIntoView({ block: 'start' }), 50);
  const off = on('jobs', () => { const ul = $('[data-sources]', el); if (ul) ul.innerHTML = sourceRows(); });
  return { destroy: off };
}

export { navigate };
