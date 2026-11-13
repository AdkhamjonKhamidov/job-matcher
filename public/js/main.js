import { state, $, api, on } from './core.js';
import { route, startRouter } from './router.js';
import { loadJobs, startAutoRefresh } from './data.js';

route(/^\/(?:jobs(?:\/(.+))?)?$/, () => import('./pages/jobs.js'), { title: 'Jobs', nav: 'jobs' });
route(/^\/map$/, () => import('./pages/map.js'), { title: 'Map', nav: 'map' });
route(/^\/apply\/(.+)$/, () => import('./pages/apply.js'), { title: 'Apply', nav: 'applications' });
route(/^\/applications$/, () => import('./pages/applications.js'), { title: 'Applications', nav: 'applications' });
route(/^\/resume$/, () => import('./pages/resume.js'), { title: 'Resume', nav: 'resume' });
route(/^\/settings$/, () => import('./pages/settings.js'), { title: 'Settings', nav: 'settings' });
route(/^\/welcome$/, () => import('./pages/welcome.js'), { title: 'Welcome', nav: 'welcome' });

function renderChrome() {
  const n = Object.keys(state.kits).length;
  $('#navKits').textContent = n ? String(n) : '';
  $('#navKits').hidden = !n;
}

async function init() {
  on('kits', renderChrome);
  renderChrome();
  $('#refreshBtn').addEventListener('click', () => loadJobs({ force: true }));
  on('loading', () => $('#refreshBtn').classList.add('spin'));
  on('jobs', () => $('#refreshBtn').classList.remove('spin'));
  try {
    state.config = await api('/api/config');
  } catch {
    state.loadError = 'The app server is not reachable. Start it with npm start, then reload.';
  }
  if (state.config?.hosted) {
    $('#privacyNote').innerHTML = '<b>Private by design.</b> No accounts, analytics, cookies or remote assets. Your resume, keys and kits stay in this browser. When you tailor, the job and your resume text (contact details masked) pass through this site\'s server to Gemini and are not stored. For fully local use, run it with <code>npm start</code>.';
  }
  startRouter();
  if (state.config) loadJobs();
  startAutoRefresh();
}

init();
