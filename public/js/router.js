// Small history-API router. Each page module exports render(el, params) -> optional { update, destroy }.
import { state, $, $$ } from './core.js';

const routes = [];
let current = null; // { route, instance }

export function route(pattern, load, { title, nav } = {}) {
  routes.push({ pattern, load, title, nav });
}

function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.pattern);
    if (m) return { r, params: m.slice(1).map((p) => (p == null ? p : decodeURIComponent(p))) };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}

export async function render() {
  let path = location.pathname.replace(/\/+$/, '') || '/';
  // First visit: ask the onboarding questions before showing anything else.
  if (!state.onboarded && path !== '/welcome') {
    history.replaceState({}, '', '/welcome');
    path = '/welcome';
  }
  const found = match(path) || match('/');
  const { r, params } = found;
  $$('.nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === r.nav ? 'page' : 'false'));
  document.body.dataset.page = r.nav || 'other';

  if (current && current.route === r && current.instance?.update) {
    current.instance.update(...params);
    return;
  }
  current?.instance?.destroy?.();
  // A fresh element per page: listeners a page attached die with it instead of piling up.
  const el = document.createElement('div');
  el.className = 'page-root';
  $('#view').replaceChildren(el);
  window.scrollTo(0, 0);
  const mod = await r.load();
  const instance = mod.render(el, ...params) || null;
  current = { route: r, instance };
  if (r.title) document.title = `${r.title} - Job Matcher`;
}

export function refresh() {
  current?.instance?.refresh?.();
}

export function startRouter() {
  window.addEventListener('popstate', render);
  // Same-origin links marked data-link (or nav links) are handled without a page load.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !(a.hasAttribute('data-link') || a.closest('.nav'))) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  render();
}
