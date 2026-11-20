import { state, $, api, on } from './core.js';
import { route, startRouter, rerender } from './router.js';
import { loadJobs, startAutoRefresh } from './data.js';
import { promptApplicationCompletion } from './tracker.js';

route(/^\/(?:jobs(?:\/(.+))?)?$/, () => import('./pages/jobs.js'), { title: 'Jobs', nav: 'jobs' });
route(/^\/map$/, () => import('./pages/map.js'), { title: 'Map', nav: 'map' });
route(/^\/apply\/(.+)$/, () => import('./pages/apply.js'), { title: 'Apply', nav: 'applications' });
route(/^\/applications$/, () => import('./pages/applications.js'), { title: 'Applications', nav: 'applications' });
route(/^\/grow$/, () => import('./pages/grow.js'), { title: 'Grow', nav: 'grow' });
route(/^\/sources$/, () => import('./pages/sources.js'), { title: 'Career sources', nav: 'sources' });
route(/^\/resume$/, () => import('./pages/resume.js'), { title: 'Resume', nav: 'resume' });
route(/^\/settings$/, () => import('./pages/settings.js'), { title: 'Settings', nav: 'settings' });
route(/^\/welcome$/, () => import('./pages/welcome.js'), { title: 'Welcome', nav: 'welcome' });

function renderChrome() {
  const n = Object.keys(state.kits).length;
  $('#navKits').textContent = n ? String(n) : '';
  $('#navKits').hidden = !n;
}

function setupMobileNav() {
  const top = $('.top'), toggle = $('#navToggle'), nav = $('#primaryNav');
  const close = () => {
    top.dataset.menuOpen = 'false';
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    top.dataset.menuOpen = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });
  document.addEventListener('click', (event) => {
    if (!top.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) close();
  });
}

async function init() {
  setupMobileNav();
  $('#view').addEventListener('click', (event) => {
    const link = event.target.closest('a[data-apply-link]');
    if (link) promptApplicationCompletion(link.dataset.applyLink);
  });
  on('kits', renderChrome);
  renderChrome();
  $('#refreshBtn').addEventListener('click', () => loadJobs({ force: true }));
  on('loading', () => $('#refreshBtn').classList.add('spin'));
  on('jobs', () => $('#refreshBtn').classList.remove('spin'));
  // Draw the page right away; jobs and server config arrive in parallel.
  startRouter();
  loadJobs();
  try {
    state.config = await api('/api/config');
  } catch {
    state.loadError = 'The app server is not reachable. Start it with npm start, then reload.';
  }
  if (state.config?.hosted) {
    $('#privacyNote').innerHTML = '<b>Private by design.</b> No accounts, analytics, cookies or remote assets. Your resume, keys, tracker and kits stay in this browser. When you use AI, the job and resume text (contact details masked) pass through this site\'s server to the provider you selected and are not stored. For fully local use, run it with <code>npm start</code>.';
  }
  // Pages that show config-dependent things (server key, source list) redraw once it's here.
  const page = document.body.dataset.page;
  if (['settings', 'grow', 'welcome', 'sources'].includes(page) || location.pathname.startsWith('/apply/')) rerender();
  startAutoRefresh();
}

init();
