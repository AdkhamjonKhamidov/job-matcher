// /apply/:id - tailor with the selected AI provider, edit the documents, then send.
import { state, $, esc, safeUrl, on, emit, api, toast, copy, download, fileSlug, saveKits, currentResume, findJob, store, WORK_AUTH, activeAIKey, activeAIProvider } from '../core.js';
import { loadFullText } from '../data.js';
import { maskText, unmask, printDoc, renderMarkdown } from '../docs.js';

const DOCS = [
  ['resume', 'Resume'], ['coverLetter', 'Cover letter'], ['email', 'Recruiter email'],
  ['linkedinNote', 'LinkedIn note'], ['linkedinMessage', 'LinkedIn message'], ['answers', 'Screening answers'],
];

function signature() {
  const p = state.settings.profile || {};
  const lines = [p.name, p.phone, p.email, p.linkedin].filter(Boolean);
  return lines.length ? `\n\nBest regards,\n${lines.join('\n')}` : '';
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

// What the kit keeps about the job, so it still opens after the posting leaves the feed.
const snapshot = (j) => ({
  id: j.id, title: j.title, company: j.company, location: j.location, salary: j.salary, applyUrl: j.applyUrl, url: j.url,
  sourceName: j.sourceName, postedAt: j.postedAt, category: j.category, level: j.level, minYears: j.minYears,
  emails: j.emails, description: String(j.description || '').slice(0, 20000), descriptionIsSnippet: j.descriptionIsSnippet,
});

export function render(el, id) {
  let preview = true; // documents open formatted; Edit switches to the text box
  const draw = () => {
    const j = findJob(id);
    if (!j) {
      el.innerHTML = `<div class="page page-narrow"><div class="card">${state.loading || !state.lastLoaded
        ? '<p class="big">Loading the posting...</p><div class="loading-bar"></div>'
        : '<p class="big">Posting not found</p><p class="muted">It may have dropped out of the date range. Kits you already made are under Applications.</p><a class="btn" href="/" data-link>Back to jobs</a>'}</div></div>`;
      return;
    }
    const entry = state.kits[id];
    el.innerHTML = `
      <div class="page page-apply">
        <header class="apply-head">
          <a class="btn ghost small" href="/jobs/${encodeURIComponent(id)}" data-link>Back to posting</a>
          <div>
            <h1>${esc(j.title)}</h1>
            <p class="meta"><b>${esc(j.company || 'Unknown company')}</b> · ${esc(j.location || 'Location not listed')}${j.salary ? ` · ${esc(j.salary)}` : ''}</p>
          </div>
        </header>
        ${state.tailoring.has(id) ? working(j) : entry ? kitView(j, entry) : startView(j)}
      </div>`;
  };

  const startView = (j) => {
    const s = state.settings;
    const provider = activeAIProvider();
    const hasKey = !!(activeAIKey() || state.config?.serverAiProviders?.[provider]);
    const r = currentResume();
    const ready = hasKey && r;
    return `
      <div class="card start">
        <h2>Build your apply kit</h2>
        <p class="muted">Your selected AI provider tailors your resume using only what's already in it, then drafts a cover letter, recruiter email, LinkedIn messages and likely screening questions. It may take up to a minute.</p>
        <ul class="checklist">
          <li class="${r ? 'ok' : ''}">${r ? `Resume: <b>${esc(r.name)}</b>` : 'No resume yet'} ${r ? '' : '<a class="btn ghost small" href="/resume" data-link>Add resume</a>'}</li>
          <li class="${hasKey ? 'ok' : ''}">${hasKey ? 'AI writing is ready' : 'AI writing is optional'} ${hasKey ? '' : '<a class="btn ghost small" href="/settings#gemini" data-link>Set up AI writing</a>'}</li>
          ${s.profile?.name ? '' : '<li class="opt">Optional: add your name in <a href="/settings" data-link>Settings</a> for email signatures</li>'}
        </ul>
        ${state.resumes.length > 1 ? `<label class="field"><span>Resume to use</span><select data-pick-resume>${state.resumes.map((x) => `<option value="${esc(x.id)}" ${x.id === r?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Anything the AI should know for this job? (optional)</span><textarea data-job-notes rows="2" placeholder="e.g. I used their product at my last job."></textarea></label>
        <button class="btn accent big" type="button" data-act="tailor" ${ready ? '' : 'disabled'}>Tailor with ${esc(state.settings.aiProvider === 'openai' ? 'GPT' : state.settings.aiProvider === 'anthropic' ? 'Claude' : 'Gemini')}</button>
      </div>`;
  };

  const working = (j) => `
    <div class="card start">
      <h2>Tailoring for ${esc(j.company || j.title)}</h2>
      <div class="loading-bar"></div>
      <p class="muted">Reading the posting and your resume. If the selected model is busy, another available model may be tried.</p>
    </div>`;

  const kitView = (j, entry) => {
    const k = entry.kit;
    const id2 = state.docTab;
    const text = docText(entry, id2);
    const limit = id2 === 'linkedinNote' ? 300 : null;
    return `
      <div class="apply-grid">
        <aside class="apply-side">
          <div class="score-band"><div class="num">${k.matchScore}<small>/100</small></div><p>${esc(k.matchSummary)}</p></div>
          <div class="lists">
            <div><h4>Strengths</h4><ul>${(k.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
            <div><h4>Gaps to be honest about</h4><ul>${(k.gaps || []).map((s) => `<li>${esc(s)}</li>`).join('') || '<li>None flagged</li>'}</ul></div>
          </div>
          <section class="send">
            <h3>Send it</h3>
            <ol class="steps">
              <li>
                <b>Apply on the company site</b>
                <p>Save the resume as PDF, then open the form. The cover letter is copied so you can paste it.</p>
                <div class="row"><button class="btn ghost small" type="button" data-act="pdf" data-doc="resume">Save resume PDF</button>
                ${j.applyUrl ? `<a class="btn small" href="${safeUrl(j.applyUrl)}" target="_blank" rel="noopener noreferrer" data-act="applyCopy" data-apply-link="${esc(j.id)}">Open application</a>` : ''}</div>
              </li>
              <li>
                <b>Email the recruiter</b>
                <input type="email" data-to placeholder="recruiter@company.com" value="${esc(j.emails?.[0] || entry.to || '')}" aria-label="Recruiter email address">
                <div class="row"><button class="btn small" type="button" data-act="mailto">Mail app</button><button class="btn ghost small" type="button" data-act="gmail">Gmail</button></div>
              </li>
              <li>
                <b>Reach out on LinkedIn</b>
                <p>Copies your note and opens a recruiter search at ${esc(j.company || 'the company')}.</p>
                <div class="row"><button class="btn small" type="button" data-act="linkedin">Find recruiters</button><button class="btn ghost small" type="button" data-act="linkedinJob">Job on LinkedIn</button></div>
              </li>
            </ol>
          </section>
          <p class="muted small">Made ${esc(new Date(entry.at).toLocaleString())} from "${esc(entry.resumeName || 'resume')}"${k.model ? ` by ${esc(k.model)}` : ''}. <button class="linkish" type="button" data-act="tailor">Make a new version</button></p>
        </aside>
        <section class="doc">
          <div class="doc-bar">
            <div class="doc-tabs" role="tablist" aria-label="Documents">
              ${DOCS.map(([d, label]) => `<button type="button" role="tab" data-doc-tab="${d}" aria-selected="${id2 === d}">${label}</button>`).join('')}
            </div>
            <div class="seg doc-mode" role="group" aria-label="View">
              <button type="button" data-mode="preview" aria-pressed="${preview}">Preview</button>
              <button type="button" data-mode="edit" aria-pressed="${!preview}">Edit</button>
            </div>
          </div>
          ${preview
            ? `<div class="doc-preview" tabindex="0" aria-label="${esc(DOCS.find((d) => d[0] === id2)[1])} preview">${id2 === 'resume' || id2 === 'coverLetter' ? renderMarkdown(text) : `<div class="plain-text">${esc(text)}</div>`}</div>`
            : `<label class="sr-only" for="docText">${esc(DOCS.find((d) => d[0] === id2)[1])}</label>
          <textarea id="docText" spellcheck="true">${esc(text)}</textarea>`}
          <div class="doc-actions">
            <span class="count" data-count>${text.length} characters${limit ? ` of ${limit}` : ''}</span>
            <span class="row">
              <button class="btn ghost small" type="button" data-act="copy">Copy</button>
              <button class="btn ghost small" type="button" data-act="download">Download .txt</button>
              ${id2 === 'resume' || id2 === 'coverLetter' ? `<button class="btn ghost small" type="button" data-act="pdf" data-doc="${id2}">Save as PDF</button>` : ''}
              ${entry.edits?.[id2] != null ? '<button class="btn ghost small" type="button" data-act="revert">Undo my edits</button>' : ''}
            </span>
          </div>
          <p class="muted small">Edits save in this browser. Read everything before you send it.</p>
        </section>
      </div>`;
  };

  async function tailor() {
    const j = findJob(id);
    const resume = currentResume();
    if (!j || !resume) return;
    const notes = [WORK_AUTH[state.settings.workAuth]?.note, state.settings.notes, $('[data-job-notes]', el)?.value].filter(Boolean).join(' ');
    const { text, map } = state.settings.maskContact ? maskText(resume.text) : { text: resume.text, map: {} };
    state.tailoring.add(id);
    draw();
    try {
      // The selected provider needs the real posting, not just a title from a list.
      await loadFullText(j).catch(() => toast('Could not load the full posting; tailoring from the summary only.'));
      const kit = await api('/api/tailor', {
        provider: activeAIProvider(), apiKey: activeAIKey(), model: state.settings.model, tone: state.settings.tone, notes, resumeText: text,
        job: { title: j.title, company: j.company, location: j.location, salary: j.salary, description: j.description, descriptionIsSnippet: j.descriptionIsSnippet },
      });
      kit.matchScore = Math.max(0, Math.min(100, Math.round(Number(kit.matchScore) || 0)));
      state.kits[id] = { kit: unmask(kit, map), at: Date.now(), resumeId: resume.id, resumeName: resume.name, job: snapshot(j) };
      state.docTab = 'resume';
      saveKits();
      emit('kits');
      toast(`Apply kit ready for ${j.company || j.title}.`);
    } catch (err) {
      toast(err.message);
    } finally {
      state.tailoring.delete(id);
      if (el.isConnected) draw();
    }
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act],[data-doc-tab],[data-mode]');
    if (!t) return;
    const j = findJob(id);
    const entry = state.kits[id];
    if (t.dataset.docTab) { state.docTab = t.dataset.docTab; draw(); return; }
    if (t.dataset.mode) { preview = t.dataset.mode === 'preview'; draw(); if (!preview) $('#docText', el)?.focus(); return; }
    const current = () => $('#docText', el)?.value ?? (entry ? docText(entry, state.docTab) : '');
    switch (t.dataset.act) {
      case 'tailor': tailor(); break;
      case 'copy': copy(current()); break;
      case 'download': download(`${fileSlug(j.company)}-${state.docTab}.txt`, current()); break;
      case 'revert': delete entry.edits[state.docTab]; saveKits(); draw(); break;
      case 'pdf': {
        const doc = t.dataset.doc;
        printDoc(docText(entry, doc), `${state.settings.profile.name || 'Resume'} - ${doc === 'resume' ? 'Resume' : 'Cover letter'} - ${j.company}`);
        break;
      }
      case 'applyCopy': copy(docText(entry, 'coverLetter'), 'Cover letter copied. Paste it into the application form.'); break;
      case 'mailto':
      case 'gmail': {
        const to = $('[data-to]', el).value.trim();
        const raw = docText(entry, 'email');
        const m = raw.match(/^Subject:\s*(.*)\n+/);
        const subject = m ? m[1] : entry.kit.recruiterEmailSubject;
        const body = m ? raw.slice(m[0].length) : raw;
        if (to) { entry.to = to; saveKits(); }
        const url = t.dataset.act === 'mailto'
          ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
          : `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(url, t.dataset.act === 'mailto' ? '_self' : '_blank', 'noopener');
        toast(to ? 'Attach your resume PDF before sending.' : 'No recruiter address yet; add it in your mail app. Attach your resume PDF.');
        break;
      }
      case 'linkedin':
        await copy(docText(entry, 'linkedinNote'), 'LinkedIn note copied. Click Connect, then Add a note, and paste.');
        window.open(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${j.company} recruiter`)}`, '_blank', 'noopener');
        break;
      case 'linkedinJob':
        window.open(`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${j.title} ${j.company}`)}&f_TPR=r604800`, '_blank', 'noopener');
        break;
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-pick-resume]')) { state.activeResume = e.target.value; store.set('activeResume', state.activeResume); }
  });
  let editTimer;
  el.addEventListener('input', (e) => {
    if (e.target.id !== 'docText') return;
    const entry = state.kits[id];
    const limit = state.docTab === 'linkedinNote' ? 300 : null;
    $('[data-count]', el).textContent = `${e.target.value.length} characters${limit ? ` of ${limit}` : ''}`;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => { entry.edits = { ...(entry.edits || {}), [state.docTab]: e.target.value }; saveKits(); }, 400);
  });

  draw();
  const j0 = findJob(id);
  if (j0) loadFullText(j0).catch(() => {});
  // Redraw when the feed arrives only if we were still waiting for this posting.
  const offs = [on('jobs', () => { if (!$('.apply-head', el)) draw(); })];
  return { destroy: () => offs.forEach((off) => off()) };
}
