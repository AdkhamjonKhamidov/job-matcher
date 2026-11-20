// /settings
import { state, $, $$, esc, safeUrl, api, toast, store, saveSettings, on, WORK_AUTH } from '../core.js';
import { loadJobs } from '../data.js';
import { navigate } from '../router.js';

const AUTO = { id: 'auto', label: 'Auto: best available, falls back when busy' };
const AI_PROVIDERS = {
  gemini: { name: 'Google Gemini', keyLabel: 'Gemini API key', keyUrl: 'https://aistudio.google.com/apikey', keyLink: 'Get a key from Google AI Studio' },
  openai: { name: 'OpenAI GPT', keyLabel: 'OpenAI API key', keyUrl: 'https://platform.openai.com/api-keys', keyLink: 'Get an API key from OpenAI' },
  anthropic: { name: 'Anthropic Claude', keyLabel: 'Anthropic API key', keyUrl: 'https://console.anthropic.com/settings/keys', keyLink: 'Get an API key from Anthropic' },
};

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
    if (s?.state === 'ok') st = `${s.count} matching jobs of ${s.total}`;
    else if (s?.state === 'error') { st = 'failed'; cls = 'err'; }
    else if (s?.state === 'setup') { st = /computer/.test(s.needs || '') ? 'local only' : src.id === 'adzuna' ? 'optional setup' : 'needs setup'; cls = 'warn'; }
    else if (s?.state === 'off' || !on) st = 'off';
    return `<li><label class="check"><input type="checkbox" data-src="${esc(src.id)}" ${on ? 'checked' : ''}> <span><a href="${safeUrl(src.home)}" target="_blank" rel="noopener noreferrer">${esc(src.name)}</a></span></label><span class="st ${cls}" ${s?.error || s?.needs ? `title="${esc(s.error || s.needs)}"` : ''}>${esc(st)}</span></li>`;
  }).join('');
}

export function render(el) {
  const s = state.settings;
  const boards = s.boards || state.config?.defaultBoards || {};
  const pendingKeys = { ...s.aiKeys, gemini: s.aiKeys.gemini || s.geminiKey || '' };
  let activeProvider = s.aiProvider;
  el.innerHTML = `
    <div class="page page-narrow">
      <header class="page-head"><h1>Settings</h1><p class="muted">Saved only in this browser.</p></header>
      <form class="settings" data-form>
        <section class="card" id="gemini">
          <h2>AI writing (optional)</h2>
          <p class="muted">Job search, tracking and exports work without AI. For tailored documents and growth plans, choose Gemini, GPT or Claude, then add that provider's API key. A paid ChatGPT or Claude chat subscription does not include API access.</p>
          <p class="muted small">Keys stay in this browser and are not encrypted at rest. HTTPS protects them in transit; avoid saving them on shared devices or browser profiles.</p>
          <div class="row">
            <label class="field grow"><span>AI provider</span><select data-ai-provider>${Object.entries(AI_PROVIDERS).map(([id, provider]) => `<option value="${id}" ${s.aiProvider === id ? 'selected' : ''}>${provider.name}</option>`).join('')}</select></label>
            <label class="field grow"><span data-key-label>${AI_PROVIDERS[s.aiProvider].keyLabel}</span><input data-ai-key type="password" autocomplete="off" spellcheck="false" value="${esc(pendingKeys[s.aiProvider])}" placeholder="${state.config?.serverAiProviders?.[s.aiProvider] ? 'Using a server key' : 'Optional; paste your provider key'}"></label>
            <label class="field grow"><span>Model</span><select data-k="model">${modelOptions([], s.model)}</select></label>
            <button type="button" class="btn ghost" data-act="checkKey">Check key</button>
          </div>
          <p class="muted small" data-provider-help><a href="${AI_PROVIDERS[s.aiProvider].keyUrl}" target="_blank" rel="noopener noreferrer">${AI_PROVIDERS[s.aiProvider].keyLink}</a></p>
          <p class="status" data-model-status role="status"></p>
          <div class="row">
            <label class="field"><span>Tone</span><select data-k="tone">
              ${[['professional and direct', 'Professional'], ['warm and conversational', 'Warm'], ['concise and technical', 'Technical']].map(([v, l]) => `<option value="${v}" ${s.tone === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
            <label class="check"><input type="checkbox" data-k="maskContact" ${s.maskContact ? 'checked' : ''}> <span>Hide my email, phone and links from the selected AI provider (they're put back afterwards)</span></label>
          </div>
          <label class="field"><span>Notes for every application (optional)</span><textarea data-k="notes" rows="2" placeholder="e.g. CompTIA A+ in progress, expected Jan 2027. Open to relocating.">${esc(s.notes)}</textarea></label>
        </section>

        <section class="card" id="profile">
          <h2>You</h2>
          <p class="muted">Used for email signatures and file names. Never sent to an AI provider.</p>
          <div class="row">
            <label class="field grow"><span>Full name</span><input data-p="name" autocomplete="name" value="${esc(s.profile.name)}"></label>
            <label class="field grow"><span>Email</span><input data-p="email" type="email" autocomplete="email" value="${esc(s.profile.email)}"></label>
          </div>
          <div class="row">
            <label class="field grow"><span>Phone</span><input data-p="phone" autocomplete="tel" value="${esc(s.profile.phone)}"></label>
            <label class="field grow"><span>LinkedIn URL</span><input data-p="linkedin" placeholder="linkedin.com/in/you" value="${esc(s.profile.linkedin)}"></label>
          </div>
          <label class="field"><span>Work authorization (hides jobs you can't apply for; the AI is told this so it answers honestly)</span>
            <select data-k="workAuth">
              <option value="" ${!s.workAuth ? 'selected' : ''}>Not set</option>
              ${Object.entries(WORK_AUTH).map(([v, a]) => `<option value="${v}" ${s.workAuth === v ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
            </select>
          </label>
        </section>

        <section class="card" id="location">
          <h2>Location</h2>
          <p class="muted">Optional: remote job search works without signing up. For more local on-site jobs, connect a free <a href="https://developer.adzuna.com/" target="_blank" rel="noopener noreferrer">Adzuna account</a>.</p>
          <div class="row">
            <label class="field grow"><span>Home city or ZIP</span><input data-k="city" placeholder="e.g. Dallas, TX" value="${esc(s.city)}"></label>
            <label class="field"><span>Radius (miles)</span><input data-k="radius" type="number" min="1" max="100" value="${esc(s.radius)}"></label>
            <label class="field"><span>Country</span><select data-k="country">
              ${[['us', 'United States'], ['ca', 'Canada'], ['gb', 'United Kingdom'], ['au', 'Australia'], ['de', 'Germany'], ['in', 'India']].map(([v, l]) => `<option value="${v}" ${s.country === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
          </div>
          <div class="row">
            <label class="field grow"><span>Adzuna app ID (from your account)</span><input data-a="appId" autocomplete="off" spellcheck="false" value="${esc(s.adzuna.appId)}"></label>
            <label class="field grow"><span>Adzuna app key (from your account)</span><input data-a="appKey" type="password" autocomplete="off" spellcheck="false" value="${esc(s.adzuna.appKey)}"></label>
          </div>
        </section>

        <section class="card" id="sources">
          <h2>Job sources</h2>
          <p class="muted">Where postings come from, and how many matching jobs each source had on the last check.</p>
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
    const providerId = $('[data-ai-provider]', el).value;
    st.className = 'status'; st.textContent = `Checking the key with ${AI_PROVIDERS[providerId].name}...`;
    try {
      const { models } = await api('/api/models', { provider: providerId, apiKey: $('[data-ai-key]', el).value.trim() });
      const sel = $('[data-k="model"]', el);
      const keep = models.some((m) => m.id === sel.value) ? sel.value : 'auto';
      sel.innerHTML = modelOptions(models, keep);
      st.className = 'status ok';
      st.textContent = `Key works. ${keep === 'auto' ? `Auto starts with ${models[0]?.id} and falls back if busy.` : `Using ${keep}.`}`;
      return true;
    } catch (err) { st.className = 'status err'; st.textContent = err.message; return false; }
  };

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'checkKey') checkKey();
    if (act === 'clearCache') { await api('/api/cache/clear', {}); toast('Job cache cleared.'); loadJobs({ force: true }); }
    if (act === 'wipe' && confirm('Erase resumes, keys, settings and apply kits from this browser? This cannot be undone.')) { store.wipe(); location.href = '/welcome'; }
  });

  el.addEventListener('change', (e) => {
    if (!e.target.matches('[data-ai-provider]')) return;
    const providerId = e.target.value;
    pendingKeys[activeProvider] = $('[data-ai-key]', el).value.trim();
    activeProvider = providerId;
    $('[data-ai-key]', el).value = pendingKeys[providerId] || '';
    $('[data-key-label]', el).textContent = AI_PROVIDERS[providerId].keyLabel;
    $('[data-ai-key]', el).placeholder = state.config?.serverAiProviders?.[providerId] ? 'Using a server key' : 'Optional; paste your provider key';
    $('[data-provider-help]', el).innerHTML = `<a href="${AI_PROVIDERS[providerId].keyUrl}" target="_blank" rel="noopener noreferrer">${AI_PROVIDERS[providerId].keyLink}</a>`;
    $('[data-k="model"]', el).innerHTML = modelOptions([], 'auto');
    $('[data-model-status]', el).textContent = '';
  });

  el.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    const v = (k) => $(`[data-k="${k}"]`, el);
    const split = (x) => x.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const before = JSON.stringify([s.adzuna, s.boards, s.disabledSources, s.country, s.city]);
    const provider = $('[data-ai-provider]', el).value;
    pendingKeys[provider] = $('[data-ai-key]', el).value.trim();
    Object.assign(s, {
      aiProvider: provider, aiKeys: { ...s.aiKeys, ...pendingKeys }, geminiKey: pendingKeys.gemini || '',
      model: v('model').value, tone: v('tone').value, maskContact: v('maskContact').checked, notes: v('notes').value.trim(),
      city: v('city').value.trim(), radius: Number(v('radius').value) || 25, country: v('country').value, workAuth: v('workAuth').value,
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
