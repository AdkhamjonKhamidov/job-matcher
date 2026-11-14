// US map of the current results. Offline: bundled state shapes + d3-geo, no tiles.
// Zoom with the wheel, double-click, pinch or the buttons; drag to pan.
import { state, $, esc, on, plural, milesBetween } from '../core.js';
import { renderRail, filtered, resultSummary, locLabel } from '../filters.js';
import { jobRow } from '../components.js';
import { navigate } from '../router.js';

const W = 975, H = 610;
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
    const projection = window.d3.geoAlbersUsa().scale(1300).translate([W / 2, H / 2]);
    const path = window.d3.geoPath();
    const states = window.topojson.feature(us, us.objects.states).features;
    return {
      states,
      borders: window.topojson.mesh(us, us.objects.states, (a, b) => a !== b),
      nation: window.topojson.mesh(us, us.objects.states, (a, b) => a === b),
      projection, path, projPath: window.d3.geoPath(projection),
      centroids: Object.fromEntries(states.map((f) => [f.properties.name, path.centroid(f)])),
    };
  })();
  lib.catch(() => { lib = null; });
  return lib;
}

const STATE_ABBR = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR' };
const ABBR_STATE = Object.fromEntries(Object.entries(STATE_ABBR).map(([n, a]) => [a, n]));
const SMALL_STATES = new Set(['DC', 'RI', 'DE', 'CT', 'NJ', 'MA', 'NH', 'VT', 'MD']);
const SHADES = ['var(--map-empty)', '#D7D9FF', '#B9BCFF', '#9FA0FF', '#7E8FF0', '#5882E8'];
const MIN_W = W / 60; // max zoom 60x

export function render(el) {
  el.innerHTML = `
    <div class="page page-map">
      <aside class="rail" aria-label="Filters"></aside>
      <section class="map-main">
        <div class="feed-head"><p class="count" aria-live="polite"></p></div>
        <div class="map-wrap">
          <svg class="us-map" tabindex="0" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of US job postings. Drag to pan, scroll or pinch to zoom."></svg>
          <div class="map-tools" role="group" aria-label="Map zoom">
            <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
            <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
            <button type="button" data-zoom="fit" title="Zoom to the postings">Fit</button>
            <button type="button" data-zoom="us" title="Show the whole US">US</button>
          </div>
          <div class="map-tip" hidden></div>
          <p class="map-help">Drag to move · scroll, pinch or double-click to zoom</p>
        </div>
        <div class="map-legend"><span>fewer</span>${SHADES.slice(1).map((c) => `<i style="background:${c}"></i>`).join('')}<span>more postings per state</span><span class="sep">dot size = postings in that city</span></div>
        <p class="map-note"></p>
      </section>
      <section class="map-side" aria-live="polite">
        <h3 class="map-pick-title">Pick a dot or a state</h3>
        <p class="muted map-pick-hint">Click a city dot or a state to list its postings here.</p>
        <ol class="job-list" role="listbox" aria-label="Postings at the selected place"></ol>
      </section>
    </div>`;
  const svg = $('.us-map', el), rail = $('.rail', el), side = $('.map-side', el), tip = $('.map-tip', el), wrap = $('.map-wrap', el);
  let vb = { x: 0, y: 0, w: W, h: H };
  let fitBox = null, lastFitKey = '', cities = new Map(), byState = new Map(), l = null;

  // ---------- view box (zoom & pan) ----------
  const k = () => W / vb.w;
  const clampVb = () => {
    vb.w = Math.min(W * 1.2, Math.max(MIN_W, vb.w));
    vb.h = vb.w * H / W;
    const m = vb.w * 0.5; // allow some slack past the edges
    vb.x = Math.min(W - vb.w + m, Math.max(-m, vb.x));
    vb.y = Math.min(H - vb.h + m, Math.max(-m, vb.y));
  };
  const applyVb = () => {
    tip.hidden = true;
    clampVb();
    svg.setAttribute('viewBox', `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`);
    rescale();
  };
  // Screen point -> SVG point (accounts for letterboxing from preserveAspectRatio).
  const toSvg = (clientX, clientY) => {
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = (r.width - vb.w * s) / 2, oy = (r.height - vb.h * s) / 2;
    return [vb.x + (clientX - r.left - ox) / s, vb.y + (clientY - r.top - oy) / s, s];
  };
  const zoomAt = (factor, sx, sy) => {
    const nw = Math.min(W * 1.2, Math.max(MIN_W, vb.w / factor));
    const f = nw / vb.w;
    vb = { x: sx - (sx - vb.x) * f, y: sy - (sy - vb.y) * f, w: nw, h: nw * H / W };
    applyVb();
  };
  const fitTo = ([[x0, y0], [x1, y1]], pad = 0.25) => {
    let w = (x1 - x0) * (1 + pad * 2), h = (y1 - y0) * (1 + pad * 2);
    if (w / h > W / H) h = w * H / W; else w = h * W / H;
    w = Math.max(w, 120);
    vb = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * H / W) / 2, w, h: w * H / W };
    applyVb();
  };

  // Keep dots, pins and labels the same size on screen whatever the zoom.
  const rescale = () => {
    const kk = k();
    // Map units per screen pixel, so sizes below are in screen pixels.
    const r = svg.getBoundingClientRect();
    const px = 1 / (Math.min(r.width / vb.w, r.height / vb.h) || 1);
    for (const c of svg.querySelectorAll('.dot')) c.setAttribute('r', (Number(c.dataset.r) * px).toFixed(3));
    const pin = svg.querySelector('.pin'); if (pin) pin.setAttribute('r', (6 * px).toFixed(3));
    for (const t of svg.querySelectorAll('.st-label')) {
      t.style.fontSize = `${(12 * px).toFixed(3)}px`;
      t.style.display = t.dataset.small && kk < 2.5 ? 'none' : '';
    }
    // City labels: busiest first (and the selected one always); skip any that would
    // overlap a label already placed, so they never pile up. Zooming in makes room.
    const placedBoxes = [];
    const labels = [...svg.querySelectorAll('.city-label')].sort((a, b) => (b.classList.contains('sel') - a.classList.contains('sel')) || (Number(a.dataset.rank) - Number(b.dataset.rank)));
    for (const t of labels) {
      t.style.fontSize = `${(13 * px).toFixed(3)}px`;
      const dy = -(Number(t.dataset.r) + 5) * px;
      t.setAttribute('dy', dy.toFixed(3));
      const x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y')) + dy;
      const w = t.textContent.length * 7.4 * px, h = 15 * px;
      const box = [x - w / 2, y - h, x + w / 2, y + 2 * px];
      const inView = box[0] > vb.x && box[2] < vb.x + vb.w && box[1] > vb.y && box[3] < vb.y + vb.h;
      const clash = placedBoxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      const show = inView && (t.classList.contains('sel') || (!clash && placedBoxes.length < Math.round(6 * kk)));
      t.style.display = show ? '' : 'none';
      if (show) placedBoxes.push(box);
    }
    svg.classList.toggle('zoomed', kk > 1.05);
  };

  // ---------- drawing ----------
  const draw = async () => {
    const list = filtered();
    $('.count', el).innerHTML = state.loading && !state.jobs.length ? 'Checking job boards...' : resultSummary(list);
    try { l = await ensureLib(); } catch (err) { $('.map-note', el).textContent = err.message; return; }
    if (!svg.isConnected) return;
    const loc = state.filters.loc;
    const inside = (p) => !loc || (loc.kind === 'state' || loc.radius === 'state' ? p.state === loc.state : milesBetween(loc, p) <= Number(loc.radius));
    cities = new Map(); byState = new Map();
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

    let extra = '';
    if (loc) {
      if (loc.kind === 'point' && loc.radius !== 'state') {
        const circle = window.d3.geoCircle().center([loc.lon, loc.lat]).radius(Number(loc.radius) / 69.05)();
        extra = `<path class="ring" d="${l.projPath(circle)}"/>`;
      }
      const pin = l.projection([loc.lon, loc.lat]);
      if (pin) extra += `<circle class="pin" cx="${pin[0].toFixed(1)}" cy="${pin[1].toFixed(1)}" r="6"/>`;
    }

    const statePaths = l.states.map((f) => {
      const st = STATE_ABBR[f.properties.name];
      const n = byState.get(st)?.length || 0;
      return `<path class="state${sel?.type === 'state' && sel.key === st ? ' sel' : ''}${n ? ' has' : ''}" d="${l.path(f)}" style="fill:${shade(n)}" data-state="${st}"><title>${esc(f.properties.name)}: ${plural(n, 'posting')}</title></path>`;
    }).join('');
    const stateLabels = l.states.map((f) => {
      const st = STATE_ABBR[f.properties.name];
      const [cx, cy] = l.centroids[f.properties.name] || [];
      return cx ? `<text class="st-label" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" ${SMALL_STATES.has(st) ? 'data-small="1"' : ''}>${st}</text>` : '';
    }).join('');

    const placed = [...cities.values()].map((c) => ({ ...c, xy: l.projection([c.lon, c.lat]) })).filter((c) => c.xy)
      .sort((a, b) => b.jobs.length - a.jobs.length);
    const dots = placed.map((c) => {
      const r = 3.5 + Math.sqrt(c.jobs.length) * 2;
      return `<circle class="dot${sel?.type === 'city' && sel.key === c.label ? ' sel' : ''}" cx="${c.xy[0].toFixed(2)}" cy="${c.xy[1].toFixed(2)}" r="${r}" data-r="${r}" data-city="${esc(c.label)}" tabindex="0" role="button" aria-label="${esc(c.label)}: ${plural(c.jobs.length, 'posting')}"></circle>`;
    }).join('');
    // Rank decides when a label shows: the 6 busiest always, the rest as you zoom in.
    const labels = placed.map((c, i) => {
      const r = 3.5 + Math.sqrt(c.jobs.length) * 2;
      return `<text class="city-label${sel?.type === 'city' && sel.key === c.label ? ' sel' : ''}" x="${c.xy[0].toFixed(2)}" y="${c.xy[1].toFixed(2)}" data-r="${r}" data-rank="${i}">${esc(c.label.replace(/, [A-Z]{2}$/, ''))}</text>`;
    }).join('');

    svg.innerHTML = `<g>${statePaths}</g>
      <path class="borders" d="${l.path(l.borders)}"/>
      <path class="nation" d="${l.path(l.nation)}"/>
      <g class="labels">${stateLabels}</g>${extra}
      <g>${[...placed].reverse().length ? dots : ''}</g>
      <g class="labels">${labels}</g>`;

    // Re-fit only when the searched place (or the set of places) changes; keep the user's zoom otherwise.
    const fitKey = loc ? `${loc.lat},${loc.lon},${loc.radius}` : 'us';
    if (loc) {
      if (loc.kind === 'point' && loc.radius !== 'state') fitBox = l.projPath.bounds(window.d3.geoCircle().center([loc.lon, loc.lat]).radius(Number(loc.radius) / 69.05)());
      else { const f = l.states.find((s) => STATE_ABBR[s.properties.name] === loc.state); fitBox = f ? l.path.bounds(f) : null; }
    } else if (placed.length) {
      const xs = placed.map((c) => c.xy[0]), ys = placed.map((c) => c.xy[1]);
      fitBox = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
    } else fitBox = null;
    if (fitKey !== lastFitKey) {
      lastFitKey = fitKey;
      if (loc && fitBox) fitTo(fitBox, 0.3); else { vb = { x: 0, y: 0, w: W, h: H }; applyVb(); }
    } else applyVb();

    const unplaced = list.filter((j) => !(j.places || []).some(inside)).length;
    $('.map-note', el).textContent = list.length
      ? `${plural(cities.size, 'city', 'cities')} in ${plural(byState.size, 'state')}.${unplaced ? ` ${unplaced} of these ${list.length} postings are remote or name no US city${loc ? ' in this area' : ''}, so they aren't plotted.` : ''}`
      : 'No postings match the filters.';
    drawSide();
  };

  const drawSide = () => {
    const loc = state.filters.loc;
    const sel = state.mapSel;
    const inside = (p) => !loc || (loc.kind === 'state' || loc.radius === 'state' ? p.state === loc.state : milesBetween(loc, p) <= Number(loc.radius));
    let picked = null, title = 'Pick a dot or a state';
    if (sel?.type === 'city' && cities.get(sel.key)) { picked = cities.get(sel.key).jobs; title = sel.key; }
    if (sel?.type === 'state' && byState.get(sel.key)) { picked = byState.get(sel.key); title = ABBR_STATE[sel.key] || sel.key; }
    if (!picked && loc) { picked = filtered().filter((j) => (j.places || []).some(inside)); title = locLabel(loc); }
    if (!picked) {
      // Default: the busiest places, so the panel is never empty.
      const top = [...cities.values()].sort((a, b) => b.jobs.length - a.jobs.length).slice(0, 8);
      $('.map-pick-title', el).textContent = top.length ? 'Busiest places' : 'Pick a dot or a state';
      $('.map-pick-hint', el).hidden = false;
      $('.job-list', side).innerHTML = top.map((c) => `<li class="place-row"><button type="button" data-place="${esc(c.label)}"><span>${esc(c.label)}</span><span class="n">${plural(c.jobs.length, 'posting')}</span></button></li>`).join('');
      return;
    }
    $('.map-pick-title', el).innerHTML = `${esc(title)}: ${plural(picked.length, 'posting')} ${sel ? '<button type="button" class="linkish" data-clear-pick>clear</button>' : ''}`;
    $('.map-pick-hint', el).hidden = true;
    $('.job-list', side).innerHTML = picked.slice(0, 200).map((j) => jobRow(j)).join('');
  };

  const pick = (target) => {
    const dot = target.closest('[data-city]'), st = target.closest('[data-state]');
    if (dot) state.mapSel = { type: 'city', key: dot.dataset.city };
    else if (st) state.mapSel = { type: 'state', key: st.dataset.state };
    else return;
    for (const n of svg.querySelectorAll('.sel')) n.classList.remove('sel');
    (dot || st).classList.add('sel');
    if (dot) svg.querySelector(`.city-label[x="${dot.getAttribute('cx')}"]`)?.classList.add('sel');
    rescale();
    drawSide();
  };

  // ---------- pointer: drag to pan, pinch to zoom, click to pick ----------
  const pointers = new Map();
  let dragStart = null, moved = false, pinchStart = null;
  svg.addEventListener('pointerdown', (e) => {
    tip.hidden = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    moved = false;
    if (pointers.size === 1) dragStart = { x: e.clientX, y: e.clientY, vb: { ...vb } };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), w: vb.w, mid: toSvg((a.x + b.x) / 2, (a.y + b.y) / 2) };
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) { hover(e); return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = pinchStart.w * pinchStart.d / Math.max(10, d);
      zoomAt(vb.w / target, pinchStart.mid[0], pinchStart.mid[1]);
      moved = true;
    } else if (dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; svg.classList.add('dragging'); tip.hidden = true; }
      if (moved) {
        const [, , s] = toSvg(e.clientX, e.clientY);
        vb = { ...dragStart.vb, x: dragStart.vb.x - dx / s, y: dragStart.vb.y - dy / s };
        applyVb();
      }
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (!pointers.size) { dragStart = null; svg.classList.remove('dragging'); }
  };
  svg.addEventListener('pointerup', (e) => {
    const wasDrag = moved;
    endPointer(e);
    if (!wasDrag && e.button === 0) pick(document.elementFromPoint(e.clientX, e.clientY) || e.target);
  });
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = toSvg(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), sx, sy);
  }, { passive: false });
  svg.addEventListener('dblclick', (e) => { e.preventDefault(); const [sx, sy] = toSvg(e.clientX, e.clientY); zoomAt(e.shiftKey ? 0.5 : 2, sx, sy); });
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target); }
  });
  el.querySelector('.map-tools').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]')?.dataset.zoom;
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    if (z === 'in') zoomAt(1.6, cx, cy);
    if (z === 'out') zoomAt(1 / 1.6, cx, cy);
    if (z === 'fit') { if (fitBox) fitTo(fitBox, state.filters.loc ? 0.3 : 0.12); }
    if (z === 'us') { vb = { x: 0, y: 0, w: W, h: H }; applyVb(); }
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    const step = vb.w * 0.15, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    const act = { '+': () => zoomAt(1.6, cx, cy), '=': () => zoomAt(1.6, cx, cy), '-': () => zoomAt(1 / 1.6, cx, cy), ArrowLeft: () => { vb.x -= step; applyVb(); }, ArrowRight: () => { vb.x += step; applyVb(); }, ArrowUp: () => { vb.y -= step; applyVb(); }, ArrowDown: () => { vb.y += step; applyVb(); } }[e.key];
    if (act) { e.preventDefault(); act(); }
  });

  // Hover tooltip with the top postings in that city.
  function hover(e) {
    const dot = e.target.closest?.('[data-city]');
    const st = !dot && e.target.closest?.('[data-state]');
    if (!dot && !st) { tip.hidden = true; return; }
    const r = wrap.getBoundingClientRect();
    if (dot) {
      const c = cities.get(dot.dataset.city);
      if (!c) return;
      tip.innerHTML = `<b>${esc(c.label)}</b><span>${plural(c.jobs.length, 'posting')}</span><ul>${c.jobs.slice(0, 3).map((j) => `<li>${esc(j.title)}</li>`).join('')}${c.jobs.length > 3 ? `<li class="more">+${c.jobs.length - 3} more</li>` : ''}</ul>`;
    } else {
      const n = byState.get(st.dataset.state)?.length || 0;
      tip.innerHTML = `<b>${esc(ABBR_STATE[st.dataset.state] || st.dataset.state)}</b><span>${plural(n, 'posting')}</span>`;
    }
    tip.hidden = false;
    const x = Math.min(r.width - tip.offsetWidth - 8, e.clientX - r.left + 14);
    const y = Math.max(8, e.clientY - r.top - tip.offsetHeight - 10);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });

  side.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-pick]')) { state.mapSel = null; for (const n of svg.querySelectorAll('.sel')) n.classList.remove('sel'); rescale(); drawSide(); return; }
    const place = e.target.closest('[data-place]');
    if (place) {
      const c = cities.get(place.dataset.place);
      state.mapSel = { type: 'city', key: place.dataset.place };
      if (c) { const [x, y] = l.projection([c.lon, c.lat]); fitTo([[x - 20, y - 12], [x + 20, y + 12]], 0.4); }
      for (const n of svg.querySelectorAll('.sel')) n.classList.remove('sel');
      svg.querySelector(`.dot[data-city="${CSS.escape(place.dataset.place)}"]`)?.classList.add('sel');
      rescale(); drawSide();
      return;
    }
    const li = e.target.closest('.job');
    if (li) navigate(`/jobs/${encodeURIComponent(li.dataset.id)}`);
  });

  const drawRail = () => renderRail(rail, ({ keepRail } = {}) => { if (!keepRail) drawRail(); draw(); });
  drawRail();
  draw();
  const offs = [on('jobs', () => { drawRail(); draw(); }), on('loading', () => { if (!state.jobs.length) draw(); })];
  const ro = new ResizeObserver(() => rescale());
  ro.observe(svg);
  return { destroy: () => { offs.forEach((off) => off()); ro.disconnect(); } };
}
