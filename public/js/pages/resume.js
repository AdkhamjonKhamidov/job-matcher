// /resume  -  upload and edit resumes. Files are read in the browser; only the text is kept.
import { state, $, esc, store, toast, currentResume } from '../core.js';
import { extractText } from '../docs.js';

export async function addResumeFromFile(file) {
  const text = await extractText(file);
  if (text.length < 80) throw new Error('Found almost no text. If this PDF is a scanned image, export it again as text, or paste the text in.');
  const r = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), text, updatedAt: Date.now() };
  state.resumes.push(r);
  state.activeResume = r.id;
  store.set('resumes', state.resumes);
  store.set('activeResume', r.id);
  return r;
}

export function dropZone(label = 'Drop your resume here') {
  return `<label class="drop" data-drop>
    <input type="file" accept=".pdf,.docx,.txt,.md" hidden data-file>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0l-4 4m4-4l4 4M5 16v3a1 1 0 001 1h12a1 1 0 001-1v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="drop-title">${esc(label)}</span>
    <span class="muted">PDF, Word or text. Click to choose a file.</span>
  </label>`;
}

export function bindDrop(root, onFile) {
  const drop = root.querySelector('[data-drop]');
  const input = root.querySelector('[data-file]');
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
}

export function render(el) {
  let status = '';
  const draw = () => {
    const r = currentResume();
    el.innerHTML = `
      <div class="page page-narrow">
        <header class="page-head">
          <h1>Resume</h1>
          <p class="muted">Keep one version per track (for example helpdesk and software) and pick which one Gemini uses. Files are read in this browser; only the text is saved, never the file.</p>
        </header>
        ${state.resumes.length ? `<div class="resume-tabs" role="tablist" aria-label="Your resumes">
          ${state.resumes.map((x) => `<button type="button" role="tab" data-res="${esc(x.id)}" aria-selected="${x.id === r?.id}">${esc(x.name)}${x.id === r?.id ? ' <span class="badge">in use</span>' : ''}</button>`).join('')}
        </div>` : ''}
        ${dropZone(state.resumes.length ? 'Add another resume' : 'Drop your resume here')}
        <p class="status${status.startsWith('!') ? ' err' : status ? ' ok' : ''}" role="status">${esc(status.replace(/^!/, ''))}</p>
        ${r ? `<form class="card resume-edit" data-form>
          <label class="field"><span>Name</span><input data-name value="${esc(r.name)}" maxlength="60"></label>
          <label class="field"><span>Text (fix anything the reader got wrong)</span><textarea data-text rows="18" spellcheck="false">${esc(r.text)}</textarea></label>
          <p class="muted small">${r.text.split(/\s+/).length} words · updated ${esc(new Date(r.updatedAt).toLocaleString())}</p>
          <div class="row end">
            <button type="button" class="btn ghost danger" data-delete>Delete</button>
            <button type="submit" class="btn">Save changes</button>
          </div>
        </form>` : ''}
      </div>`;
    bindDrop(el, async (file) => {
      status = `Reading ${file.name}...`; draw();
      try {
        const nr = await addResumeFromFile(file);
        status = `Read ${nr.text.split(/\s+/).length} words from ${file.name}. Check the text below.`;
      } catch (err) { status = `!${err.message}`; }
      draw();
    });
  };

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-res]');
    if (tab) { state.activeResume = tab.dataset.res; store.set('activeResume', state.activeResume); status = ''; draw(); return; }
    if (e.target.closest('[data-delete]')) {
      const r = currentResume();
      if (!r || !confirm(`Delete "${r.name}" from this browser?`)) return;
      state.resumes = state.resumes.filter((x) => x.id !== r.id);
      state.activeResume = state.resumes[0]?.id || null;
      store.set('resumes', state.resumes); store.set('activeResume', state.activeResume);
      status = ''; draw(); toast('Resume deleted.');
    }
  });
  el.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    const r = currentResume();
    const text = $('[data-text]', el).value.trim();
    if (text.length < 80) { status = '!That looks too short to be a resume.'; draw(); return; }
    Object.assign(r, { name: $('[data-name]', el).value.trim() || 'My resume', text, updatedAt: Date.now() });
    store.set('resumes', state.resumes);
    status = '';
    draw();
    toast(`Saved "${r.name}".`);
  });
  draw();
}
