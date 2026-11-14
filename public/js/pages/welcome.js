// /welcome  -  first-run questions: resume, roles, level, work authorization, location, Gemini.
import { state, $, $$, esc, api, store, saveSettings, saveFilters, CATS, currentResume } from '../core.js';
import { suggestRoles, setLocation, clearLocation } from '../filters.js';
import { addResumeFromFile, dropZone, bindDrop } from './resume.js';
import { loadJobs } from '../data.js';
import { navigate } from '../router.js';

const LEVEL_CHOICES = [
  { id: 'student', title: 'Student or career changer', body: 'Internships and entry-level roles', levels: ['intern', 'entry'] },
  { id: 'entry', title: 'Entry level', body: '0 to 2 years of experience', levels: ['entry'] },
  { id: 'mid', title: 'Some experience', body: '2 to 4 years', levels: ['entry', 'mid'] },
  { id: 'senior', title: 'Experienced', body: '5+ years, show everything', levels: ['mid', 'senior'] },
];
const AUTH_CHOICES = [
  { id: 'citizen', title: 'US citizen', body: 'Can apply anywhere, including clearance jobs' },
  { id: 'greencard', title: 'Green card holder', body: 'Permanent resident; no sponsorship needed' },
  { id: 'visa', title: 'Need visa sponsorship', body: 'H-1B, OPT/STEM OPT or similar' },
  { id: 'other', title: 'Prefer not to say', body: 'Show everything' },
];
const WHERE_CHOICES = [
  { id: 'remote', title: 'Remote only', body: 'Work from home' },
  { id: 'onsite', title: 'Near me', body: 'On-site or hybrid around a city' },
  { id: 'both', title: 'Both', body: 'Remote, plus jobs near me' },
];

export function render(el) {
  const f = state.filters;
  const answers = {
    roles: f.roles.length ? [...f.roles] : suggestRoles(currentResume()?.text || ''),
    level: LEVEL_CHOICES.find((c) => c.levels.slice().sort().join() === f.levels.slice().sort().join())?.id || 'entry',
    where: f.where === 'remote' ? 'remote' : f.loc ? (f.where === 'onsite' || !f.locRemote ? 'onsite' : 'both') : 'remote',
    city: f.loc?.q || state.settings.city || '',
    radius: f.loc && f.loc.radius !== 'state' ? f.loc.radius : '25',
    auth: state.settings.workAuth || '',
  };
  let step = 0, status = '', busy = false;
  const STEPS = 6;
  const AUTH = 3, WHERE = 4, GEMINI = 5;

  const card = (choice, group, on) => `<button type="button" class="choice" data-${group}="${choice.id}" aria-pressed="${on}"><b>${esc(choice.title)}</b><span>${esc(choice.body)}</span></button>`;

  const screens = [
    () => {
      const r = currentResume();
      return `<h1>Let's start with your resume</h1>
        <p class="lead">It's read here in your browser and never uploaded anywhere. Gemini only sees its text when you ask for a tailored application.</p>
        ${r ? `<div class="have"><span class="tick" aria-hidden="true"></span><div><b>${esc(r.name)}</b><span class="muted">${r.text.split(/\s+/).length} words, ready to use</span></div></div>` : ''}
        ${dropZone(r ? 'Use a different resume' : 'Drop your resume here')}
        <p class="status${status.startsWith('!') ? ' err' : ''}" role="status">${esc(status.replace(/^!/, ''))}</p>`;
    },
    () => `<h1>What kind of work?</h1>
      <p class="lead">Pick any that fit.${answers.roles.length && !f.roles.length ? ' We pre-picked some from your resume.' : ''} Leave all off to see every tech role.</p>
      <div class="choice-chips">${CATS.map(([id, label]) => `<button type="button" class="fchip big" data-role="${id}" aria-pressed="${answers.roles.includes(id)}">${esc(label)}</button>`).join('')}</div>`,
    () => `<h1>Where are you in your career?</h1>
      <p class="lead">Jobs asking for more experience than this are hidden. You can change it any time from the filters.</p>
      <div class="choices">${LEVEL_CHOICES.map((c) => card(c, 'level', answers.level === c.id)).join('')}</div>`,
    () => `<h1>Can you work in the US?</h1>
      <p class="lead">Some jobs (most federal roles, defense contractors, anything needing a security clearance) are open only to US citizens. We hide the ones you can't apply for and tell Gemini your status, so it never claims something that isn't true.</p>
      <div class="choices">${AUTH_CHOICES.map((c) => card(c, 'auth', answers.auth === c.id)).join('')}</div>`,
    () => `<h1>Where do you want to work?</h1>
      <p class="lead">Remote roles come from many boards. Jobs near you show up on the map too.</p>
      <div class="choices three">${WHERE_CHOICES.map((c) => card(c, 'where', answers.where === c.id)).join('')}</div>
      ${answers.where !== 'remote' ? `<div class="row">
        <label class="field grow"><span>City, state or ZIP</span><input data-city value="${esc(answers.city)}" placeholder="e.g. Dallas, TX or 75201" autocomplete="off"></label>
        <label class="field"><span>Within</span><select data-radius>${['10', '25', '50', '100'].map((r) => `<option value="${r}" ${answers.radius === r ? 'selected' : ''}>${r} miles</option>`).join('')}</select></label>
      </div>` : ''}
      <p class="status${status.startsWith('!') ? ' err' : ''}" role="status">${esc(status.replace(/^!/, ''))}</p>`,
    () => `<h1>Connect Gemini</h1>
      <p class="lead">Gemini writes your tailored resume, cover letter and recruiter messages. Get a free key at <b>aistudio.google.com/apikey</b> and paste it here. It's stored only in this browser.</p>
      ${state.config?.serverGeminiKey ? '<p class="have-note">This app already has a key on its server, so you can skip this.</p>' : ''}
      <label class="field"><span>Gemini API key</span><input data-key type="password" autocomplete="off" spellcheck="false" value="${esc(answers.key ?? state.settings.geminiKey)}" placeholder="AIza..."></label>
      <label class="field"><span>Your name, for email signatures (optional)</span><input data-name autocomplete="name" value="${esc(answers.name ?? state.settings.profile.name)}"></label>
      <p class="status${status.startsWith('!') ? ' err' : ''}" role="status">${esc(status.replace(/^!/, ''))}</p>`,
  ];

  const draw = () => {
    const canNext = (step !== 0 || !!currentResume()) && (step !== AUTH || !!answers.auth);
    el.innerHTML = `
      <div class="page page-welcome">
        <div class="welcome-card">
          <div class="progress" aria-hidden="true"><span style="width:${((step + 1) / STEPS) * 100}%"></span></div>
          <p class="step-count">Step ${step + 1} of ${STEPS}</p>
          ${screens[step]()}
          <div class="welcome-nav">
            ${step > 0 ? '<button type="button" class="btn ghost" data-nav="back">Back</button>' : '<span></span>'}
            <div class="row">
              ${(step === 0 && !currentResume()) || step === GEMINI ? `<button type="button" class="btn ghost" data-nav="skip">${step === 0 ? 'Skip for now' : 'Skip, add it later'}</button>` : ''}
              <button type="button" class="btn accent" data-nav="next" ${canNext && !busy ? '' : 'disabled'}>${step === STEPS - 1 ? 'Show my jobs' : 'Continue'}</button>
            </div>
          </div>
        </div>
      </div>`;
    if (step === 0) bindDrop(el, async (file) => {
      status = `Reading ${file.name}...`; draw();
      try {
        const r = await addResumeFromFile(file);
        status = '';
        if (!f.roles.length) answers.roles = suggestRoles(r.text);
      } catch (err) { status = `!${err.message}`; }
      draw();
    });
    $('h1', el)?.setAttribute('tabindex', '-1');
    $('h1', el)?.focus({ preventScroll: true });
  };

  const finish = async () => {
    state.filters.roles = answers.roles;
    state.filters.levels = LEVEL_CHOICES.find((c) => c.id === answers.level).levels;
    state.filters.where = answers.where === 'remote' ? 'remote' : answers.where === 'onsite' ? 'onsite' : 'all';
    state.filters.locRemote = answers.where === 'both';
    if (answers.where === 'remote') clearLocation({ reload: false });
    state.filters.eligibleOnly = true;
    saveFilters();
    state.settings.workAuth = answers.auth;
    state.onboarded = true;
    store.set('onboarded', true);
    saveSettings();
    loadJobs();
    navigate('/', { replace: true });
  };

  const next = async () => {
    status = '';
    if (step === WHERE && answers.where !== 'remote') {
      answers.city = $('[data-city]', el).value.trim();
      answers.radius = $('[data-radius]', el).value;
      if (!answers.city) { status = '!Type a city, state or ZIP code, or choose Remote only.'; return draw(); }
      busy = true; draw();
      try {
        await setLocation(answers.city, answers.radius, { reload: false });
        state.settings.city = answers.city;
        state.settings.radius = Number(answers.radius);
      } catch (err) { status = `!${err.message}`; busy = false; return draw(); }
      busy = false;
    }
    if (step === GEMINI) {
      const key = $('[data-key]', el).value.trim();
      answers.key = key;
      answers.name = $('[data-name]', el).value.trim();
      state.settings.profile.name = answers.name;
      if (key && key !== state.settings.geminiKey) {
        busy = true; status = 'Checking the key with Google...'; draw();
        try {
          await api('/api/models', { apiKey: key });
          state.settings.geminiKey = key;
        } catch (err) { busy = false; status = `!That key didn't work: ${err.message}`; return draw(); }
        busy = false;
      }
      return finish();
    }
    step++;
    draw();
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.role) { const i = answers.roles.indexOf(b.dataset.role); i >= 0 ? answers.roles.splice(i, 1) : answers.roles.push(b.dataset.role); b.setAttribute('aria-pressed', String(i < 0)); }
    else if (b.dataset.auth) { answers.auth = b.dataset.auth; $$('[data-auth]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('[data-nav="next"]', el).disabled = false; }
    else if (b.dataset.level) { answers.level = b.dataset.level; $$('[data-level]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    else if (b.dataset.where) {
      const c = $('[data-city]', el); if (c) answers.city = c.value;
      answers.where = b.dataset.where; status = ''; draw();
      $('[data-city]', el)?.focus();
    }
    else if (b.dataset.nav === 'back') { status = ''; step--; draw(); }
    else if (b.dataset.nav === 'skip') { status = ''; if (step === GEMINI) finish(); else { step++; draw(); } }
    else if (b.dataset.nav === 'next') next();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); next(); } });
  draw();
}
