// US map of the current results. Offline: bundled state shapes + d3-geo, no tiles.
import { state, $, esc, on, plural, milesBetween } from '../core.js';
import { renderRail, filtered, resultSummary, locLabel } from '../filters.js';
import { jobRow } from '../components.js';
import { navigate } from '../router.js';

let lib = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}
async function ensureLib() {
  if (lib) return lib;
  lib = (async () => {
    if (!window.d3?.geoAlbersUsa) {
      await loadScript('/vendor/d3/d3-array.min.js');
      await loadScript('/vendor/d3/d3-geo.min.js');
    }
    if (!window.topojson) await loadScript('/vendor/topojson/topojson-client.min.js');
    const us = await (await fetch('/vendor/us-atlas/states-albers-10m.json')).json();
    return {
      states: window.topojson.feature(us, us.objects.states).features,
      borders: window.topojson.mesh(us, us.objects.states, (a, b) => a !== b),
      // Same projection us-atlas used to pre-project the shapes.
      projection: window.d3.geoAlbersUsa().scale(1300).translate([487.5, 305]),
      path: window.d3.geoPath(),
    };
  })();
  lib.then((l) => { l.projPath = window.d3.geoPath(l.projection); }).catch(() => { lib = null; });
  return lib;
}

const STATE_ABBR = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR' };
const ABBR_STATE = Object.fromEntries(Object.entries(STATE_ABBR).map(([n, a]) => [a, n]));
const SHADES = ['var(--surface-2)', '#D7D9FF', '#B9BCFF', '#9FA0FF', '#7E8FF0', '#5882E8'];

export function render(el) {
  el.innerHTML = `
    <div class="page page-map">
      <aside class="rail" aria-label="Filters"></aside>
      <section class="map-main">
        <div class="feed-head"><p class="count" aria-live="polite"></p></div>
        <div class="map-wrap">
          <svg class="us-map" viewBox="0 0 975 610" role="img" aria-label="Map of US job postings"></svg>
          <div class="map-legend"><span>fewer</span>${SHADES.slice(1).map((c) => `<i style="background:${c}"></i>`).join('')}<span>more postings per state</span><span class="sep">dot size = postings in that city</span></div>
        </div>
        <p class="map-note"></p>
      </section>
      <section class="map-side" aria-live="polite">
        <h3 class="map-pick-title">Pick a dot or a state</h3>
        <p class="muted map-pick-hint">Click a city dot or a state to list its postings here.</p>
        <ol class="job-list" role="listbox" aria-label="Postings at the selected place"></ol>
      </section>
    </div>`;
  const svg = $('.us-map', el), rail = $('.rail', el), side = $('.map-side', el);

  const draw = async () => {
    const list = filtered();
    $('.count', el).innerHTML = state.loading && !state.jobs.length ? 'Checking job boards...' : resultSummary(list);
    let l;
    try { l = await ensureLib(); } catch (err) { $('.map-note', el).textContent = err.message; return; }
    if (!svg.isConnected) return;
    const loc = state.filters.loc;
    // With a location set, plot only the places inside it (multi-city postings list others too).
    const inside = (p) => !loc || (loc.kind === 'state' || loc.radius === 'state' ? p.state === loc.state : milesBetween(loc, p) <= Number(loc.radius));
    const cities = new Map(), byState = new Map();
    for (const j of list) {
      const pts = (j.places || []).filter(inside);
      for (const p of pts) {
        const c = cities.get(p.label) || { ...p, jobs: [] };
        c.jobs.push(j); cities.set(p.label, c);
      }
      for (const st of new Set(loc ? pts.map((p) => p.state) : [...(j.states || []), ...pts.map((p) => p.state)])) {
        const arr = byState.get(st) || []; arr.push(j); byState.set(st, arr);
      }
    }
    const max = Math.max(1, ...[...byState.values()].map((a) => a.length));
    const shade = (n) => (n ? SHADES[Math.min(SHADES.length - 1, 1 + Math.floor((Math.log(n) / Math.log(max + 1)) * (SHADES.length - 1)))] : SHADES[0]);
    const sel = state.mapSel;

    // Zoom to the searched area.
    let box = [[0, 0], [975, 610]], extra = '';
    if (loc) {
      if (loc.kind === 'point' && loc.radius !== 'state') {
        const circle = window.d3.geoCircle().center([loc.lon, loc.lat]).radius(Number(loc.radius) / 69.05)();
        extra = `<path class="ring" d="${l.projPath(circle)}"/>`;
        box = l.projPath.bounds(circle);
      } else {
        const f = l.states.find((s) => STATE_ABBR[s.properties.name] === loc.state);
        if (f) box = l.path.bounds(f);
      }
    }
    const pad = 0.35, [[x0, y0], [x1, y1]] = box;
    let w = (x1 - x0) * (1 + pad * 2), h = (y1 - y0) * (1 + pad * 2);
    if (w / h > 975 / 610) h = (w * 610) / 975; else w = (h * 975) / 610;
    w = Math.min(975, Math.max(w, 160)); h = (w * 610) / 975;
    const vx = Math.min(975 - w, Math.max(0, (x0 + x1) / 2 - w / 2)), vy = Math.min(610 - h, Math.max(0, (y0 + y1) / 2 - h / 2));
    svg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    const k = 975 / w;
    if (loc) { const pin = l.projection([loc.lon, loc.lat]); if (pin) extra += `<circle class="pin" cx="${pin[0].toFixed(1)}" cy="${pin[1].toFixed(1)}" r="${(5 / k).toFixed(2)}"/>`; }

    const statePaths = l.states.map((f) => {
      const st = STATE_ABBR[f.properties.name];
      const n = byState.get(st)?.length || 0;
      return `<path class="state${sel?.type === 'state' && sel.key === st ? ' sel' : ''}" d="${l.path(f)}" style="fill:${shade(n)}" data-state="${st}"><title>${esc(f.properties.name)}: ${plural(n, 'posting')}</title></path>`;
    }).join('');
    const dots = [...cities.values()].map((c) => ({ ...c, xy: l.projection([c.lon, c.lat]) })).filter((c) => c.xy)
      .sort((a, b) => b.jobs.length - a.jobs.length)
      .map((c) => `<circle class="dot${sel?.type === 'city' && sel.key === c.label ? ' sel' : ''}" cx="${c.xy[0].toFixed(1)}" cy="${c.xy[1].toFixed(1)}" r="${((3.5 + Math.sqrt(c.jobs.length) * 2.6) / k).toFixed(2)}" data-city="${esc(c.label)}" tabindex="0" role="button" aria-label="${esc(c.label)}: ${plural(c.jobs.length, 'posting')}"><title>${esc(c.label)}: ${plural(c.jobs.length, 'posting')}</title></circle>`).join('');
    svg.innerHTML = `<g>${statePaths}</g><path d="${l.path(l.borders)}" style="fill:none;stroke:var(--surface);stroke-width:0.6;pointer-events:none"/>${extra}<g>${dots}</g>`;

    const unplaced = list.filter((j) => !(j.places || []).some(inside)).length;
    $('.map-note', el).textContent = list.length
      ? `${plural(cities.size, 'city', 'cities')} in ${plural(byState.size, 'state')}.${unplaced ? ` ${unplaced} of these ${list.length} postings are remote or name no US city${loc ? ' in this area' : ''}, so they aren't plotted.` : ''}`
      : 'No postings match the filters.';

    let picked = null, title = 'Pick a dot or a state';
    if (sel?.type === 'city' && cities.get(sel.key)) { picked = cities.get(sel.key).jobs; title = sel.key; }
    if (sel?.type === 'state' && byState.get(sel.key)) { picked = byState.get(sel.key); title = ABBR_STATE[sel.key] || sel.key; }
    if (!picked && loc) { picked = list.filter((j) => (j.places || []).some(inside)); title = locLabel(loc); }
    $('.map-pick-title', el).textContent = picked ? `${title}: ${plural(picked.length, 'posting')}` : title;
    $('.map-pick-hint', el).hidden = !!picked;
    $('.job-list', side).innerHTML = picked ? picked.slice(0, 200).map((j) => jobRow(j)).join('') : '';
  };

  const pick = (target) => {
    const dot = target.closest('[data-city]'), st = target.closest('[data-state]');
    if (dot) state.mapSel = { type: 'city', key: dot.dataset.city };
    else if (st) state.mapSel = { type: 'state', key: st.dataset.state };
    else return;
    draw();
    if (matchMedia('(max-width: 1000px)').matches) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  svg.addEventListener('click', (e) => pick(e.target));
  svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target); } });
  side.addEventListener('click', (e) => { const li = e.target.closest('.job'); if (li) navigate(`/jobs/${encodeURIComponent(li.dataset.id)}`); });

  const drawRail = () => renderRail(rail, ({ keepRail } = {}) => { if (!keepRail) drawRail(); draw(); });
  drawRail();
  draw();
  const offs = [on('jobs', () => { drawRail(); draw(); }), on('loading', draw)];
  return { destroy: () => offs.forEach((off) => off()) };
}
