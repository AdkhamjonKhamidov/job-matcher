// /welcome  -  first-run questions: resume, career interests, experience, and location.
import { state, $, $$, esc, store, saveSettings, saveFilters, CATS, CAREER_FIELDS, currentResume } from '../core.js';
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
const WHERE_CHOICES = [
  { id: 'all', title: 'Anywhere', body: 'Show every location' },
  { id: 'remote', title: 'Remote only', body: 'Work from home' },
  { id: 'onsite', title: 'Near me', body: 'On-site or hybrid around a city' },
  { id: 'both', title: 'Both', body: 'Remote, plus jobs near me' },
];

export function render(el) {
  const f = state.filters;
  const answers = {
    roles: f.roles.length ? [...f.roles] : suggestRoles(currentResume()?.text || ''),
    level: LEVEL_CHOICES.find((c) => c.levels.slice().sort().join() === f.levels.slice().sort().join())?.id || 'entry',
    where: f.where === 'remote' ? 'remote' : f.loc ? (f.where === 'onsite' || !f.locRemote ? 'onsite' : 'both') : 'all',
    city: f.loc?.q || state.settings.city || '',
    radius: f.loc && f.loc.radius !== 'state' ? f.loc.radius : '25',
  };
  let step = 0, status = '', busy = false;
  const STEPS = 4;
  const RESUME = 0, WHERE = 3;

  const card = (choice, group, on) => `<button type="button" class="choice" data-${group}="${choice.id}" aria-pressed="${on}"><b>${esc(choice.title)}</b><span>${esc(choice.body)}</span></button>`;

  const screens = [
    () => {
      const r = currentResume();
      return `<h1>Let's start with your resume</h1>
        <p class="lead">Optional. Helps find relevant jobs. Stays in this browser.</p>
        ${r ? `<div class="have"><span class="tick" aria-hidden="true"></span><div><b>${esc(r.name)}</b><span class="muted">${r.text.split(/\s+/).length} words, ready to use</span></div></div>` : ''}
        ${dropZone(r ? 'Use a different resume' : 'Drop your resume here')}
        <p class="status${status.startsWith('!') ? ' err' : ''}" role="status">${esc(status.replace(/^!/, ''))}</p>`;
    },
    () => `<h1>What kind of work are you looking for?</h1>
      <p class="lead">Choose roles, or leave blank for all fields.${answers.roles.length && !f.roles.length ? ' Suggestions use your resume.' : ''}</p>
      <label class="field role-search"><span>Search roles</span><input type="search" data-role-search placeholder="e.g. pharmacy, research assistant" autocomplete="off"></label>
      <p class="muted small" data-role-empty hidden>No matching roles. Try a broader search.</p>
      <div class="career-fields">${CAREER_FIELDS.map((field) => `<details class="career-group${field.roles.some((id) => answers.roles.includes(id)) ? ' has-selection' : ''}" data-career-field="${esc(field.id)}" data-career-label="${esc(field.label.toLowerCase())}"><summary><span class="career-title">${esc(field.label)}</span></summary><div class="choice-chips">${field.roles.map((id) => {
        const label = CATS.find(([role]) => role === id)[1];
        return `<button type="button" class="fchip big" data-role="${id}" data-role-label="${esc(label.toLowerCase())}" aria-pressed="${answers.roles.includes(id)}">${esc(label)}</button>`;
      }).join('')}</div></details>`).join('')}</div>`,
    () => `<h1>Where are you in your career?</h1>
      <p class="lead">Choose your experience level.</p>
      <div class="choices">${LEVEL_CHOICES.map((c) => card(c, 'level', answers.level === c.id)).join('')}</div>`,
    () => `<h1>Where do you want to work?</h1>
      <p class="lead">Choose a location. You can change it later.</p>
      <div class="choices">${WHERE_CHOICES.map((c) => card(c, 'where', answers.where === c.id)).join('')}</div>
      ${answers.where === 'onsite' || answers.where === 'both' ? `<div class="row">
        <label class="field grow"><span>City, state or ZIP</span><input data-city value="${esc(answers.city)}" placeholder="e.g. Dallas, TX or 75201" autocomplete="off"></label>
        <label class="field"><span>Within</span><select data-radius>${['10', '25', '50', '100'].map((r) => `<option value="${r}" ${answers.radius === r ? 'selected' : ''}>${r} miles</option>`).join('')}</select></label>
      </div>` : ''}
      <p class="status${status.startsWith('!') ? ' err' : ''}" role="status">${esc(status.replace(/^!/, ''))}</p>`,
  ];

  const draw = () => {
    const canNext = step !== RESUME || !!currentResume();
    el.innerHTML = `
      <div class="page page-welcome">
        <div class="welcome-card">
          <div class="progress" aria-hidden="true"><span style="width:${((step + 1) / STEPS) * 100}%"></span></div>
          <p class="step-count">Step ${step + 1} of ${STEPS}</p>
          ${screens[step]()}
          <div class="welcome-nav">
            ${step > 0 ? '<button type="button" class="btn ghost" data-nav="back">Back</button>' : '<span></span>'}
            <div class="row">
              ${step === RESUME && !currentResume() ? '<button type="button" class="btn ghost" data-nav="skip">Skip for now</button>' : ''}
              <button type="button" class="btn accent" data-nav="next" ${canNext && !busy ? '' : 'disabled'}>${step === WHERE ? 'Show my jobs' : 'Continue'}</button>
            </div>
          </div>
        </div>
      </div>`;
    if (step === RESUME) bindDrop(el, async (file) => {
      status = `Reading ${file.name}...`; draw();
      try {
        const r = await addResumeFromFile(file);
        status = '';
        if (!f.roles.length) answers.roles = suggestRoles(r.text);
      } catch (err) { status = `!${err.message}`; }
      draw();
    });
    if (step === 1) {
      const search = $('[data-role-search]', el);
      const groups = $$('[data-career-field]', el);
      const empty = $('[data-role-empty]', el);
      search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        groups.forEach((group) => {
          const fieldLabel = group.dataset.careerLabel;
          let groupVisible = 0;
          $$('[data-role]', group).forEach((role) => {
            const matches = !query || fieldLabel.includes(query) || role.dataset.roleLabel.includes(query);
            role.hidden = !matches;
            if (matches) groupVisible++;
          });
          group.hidden = groupVisible === 0;
          if (!query) group.open = false;
          else if (groupVisible) group.open = true;
          visible += groupVisible;
        });
        empty.hidden = visible > 0;
      });
    }
    $('h1', el)?.setAttribute('tabindex', '-1');
    $('h1', el)?.focus({ preventScroll: true });
  };

  const finish = async () => {
    state.filters.roles = answers.roles;
    state.filters.levels = LEVEL_CHOICES.find((c) => c.id === answers.level).levels;
    state.filters.where = answers.where === 'remote' ? 'remote' : answers.where === 'onsite' ? 'onsite' : 'all';
    state.filters.locRemote = answers.where === 'both';
    state.filters.locRemoteExplicit = true;
    if (answers.where === 'remote' || answers.where === 'all') clearLocation({ reload: false });
    state.filters.eligibleOnly = true;
    saveFilters();
    state.onboarded = true;
    store.set('onboarded', true);
    saveSettings();
    loadJobs();
    navigate('/', { replace: true });
  };

  const next = async () => {
    status = '';
    if (step === WHERE && (answers.where === 'onsite' || answers.where === 'both')) {
      answers.city = $('[data-city]', el).value.trim();
      answers.radius = $('[data-radius]', el).value;
      if (!answers.city) { status = '!Enter a city, state or ZIP code, or choose Anywhere or Remote only.'; return draw(); }
      busy = true; draw();
      try {
        await setLocation(answers.city, answers.radius, { reload: false });
        state.settings.city = answers.city;
        state.settings.radius = Number(answers.radius);
      } catch (err) { status = `!${err.message}`; busy = false; return draw(); }
      busy = false;
    }
    if (step === WHERE) {
      return finish();
    }
    step++;
    draw();
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.role) {
      const i = answers.roles.indexOf(b.dataset.role);
      i >= 0 ? answers.roles.splice(i, 1) : answers.roles.push(b.dataset.role);
      b.setAttribute('aria-pressed', String(i < 0));
      const group = b.closest('.career-group');
      group?.classList.toggle('has-selection', Boolean(group.querySelector('[data-role][aria-pressed="true"]')));
    }
    else if (b.dataset.level) { answers.level = b.dataset.level; $$('[data-level]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    else if (b.dataset.where) {
      const c = $('[data-city]', el); if (c) answers.city = c.value;
      answers.where = b.dataset.where; status = ''; draw();
      if (answers.where === 'onsite' || answers.where === 'both') $('[data-city]', el)?.focus();
    }
    else if (b.dataset.nav === 'back') {
      if (step === WHERE) {
        answers.city = $('[data-city]', el)?.value.trim() || answers.city;
        answers.radius = $('[data-radius]', el)?.value || answers.radius;
      }
      status = ''; step--; draw();
    }
    else if (b.dataset.nav === 'skip') { status = ''; step++; draw(); }
    else if (b.dataset.nav === 'next') next();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-city]')) { e.preventDefault(); next(); } });
  draw();
}
