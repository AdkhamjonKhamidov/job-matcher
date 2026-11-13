// Markup shared by several pages.
import { state, esc, safeUrl, age, CAT_LABEL } from './core.js';
import { skillFit } from './filters.js';

export function jobRow(j, { selected = false } = {}) {
  const a = age(j.postedAt);
  const kit = state.kits[j.id]?.kit;
  const fit = !kit && skillFit(j);
  const loc = state.filters.loc;
  const tags = [
    state.newIds.has(j.id) ? '<span class="tag new">new</span>' : '',
    `<span class="tag cat">${esc(CAT_LABEL[j.category] || j.category)}</span>`,
    loc && j._dist != null && loc.kind === 'point' && loc.radius !== 'state' ? `<span class="tag dist">${j._dist < 1 ? '<1' : Math.round(j._dist)} mi</span>` : '',
    j.remote ? '<span class="tag remote">remote</span>' : '',
    j.level === 'intern' ? '<span class="tag">internship</span>' : j.level === 'entry' ? '<span class="tag">entry level</span>' : '',
    j.minYears != null ? `<span class="tag yrs${j.minYears >= 3 ? ' hi' : ''}" title="Years of experience the posting asks for">needs ${j.minYears}+ yrs</span>` : '',
    kit ? `<span class="tag score">match ${kit.matchScore}</span>` : fit ? `<span class="tag" title="Skills in this posting that appear in your resume">skills ${fit.have}/${fit.of}</span>` : '',
    j.emails?.length ? '<span class="tag mail">recruiter email</span>' : '',
  ].join('');
  return `<li class="job${state.dismissed.has(j.id) ? ' dismissed' : ''}" data-id="${esc(j.id)}" role="option" tabindex="-1" aria-selected="${selected}">
    <div class="age${a.hot ? ' hot' : ''}" title="${esc(j.postedAt || '')}">${a.big}<small>${a.small}</small></div>
    <div class="job-main">
      <h3>${esc(j.title)}</h3>
      <p class="meta"><b>${esc(j.company || 'Unknown company')}</b> · ${esc(j.location || 'Location not listed')}${j.salary ? ` · ${esc(j.salary)}` : ''}</p>
      <div class="tags">${tags}</div>
    </div>
  </li>`;
}

export function postingDetail(j, { back = null } = {}) {
  const a = age(j.postedAt);
  const posted = j.postedAt ? new Date(j.postedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'unknown date';
  const fit = skillFit(j);
  const kit = state.kits[j.id];
  const note = j.fullTextState === 'loading' ? 'Loading the full posting from the company site...'
    : j.fullTextState === 'error' ? `Could not load the full posting (${esc(j.fullTextError)}). Open it on the company site.`
      : j.descriptionIsSnippet ? 'This board only shares a summary; open the posting for the full text.' : '';
  return `
    <div class="d-head">
      ${back ? `<a class="btn ghost small d-back" href="${back}" data-link>Back to list</a>` : ''}
      <h2 tabindex="-1">${esc(j.title)}</h2>
      <p class="meta"><b>${esc(j.company || 'Unknown company')}</b> · ${esc(j.location || 'Location not listed')}${j.salary ? ` · ${esc(j.salary)}` : ''}</p>
      <p class="meta">Posted ${a.big}${a.small === 'ago' ? ' ago' : ` (${a.small})`}, ${esc(posted)} · via <a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.sourceName || 'source')}</a></p>
      <div class="d-actions">
        <a class="btn accent" href="/apply/${encodeURIComponent(j.id)}" data-link>${kit ? `Open apply kit (match ${kit.kit.matchScore})` : 'Tailor and apply'}</a>
        <a class="btn ghost" href="${safeUrl(j.applyUrl)}" target="_blank" rel="noopener noreferrer">Company page</a>
        <button class="btn ghost" type="button" data-act="dismiss">${state.dismissed.has(j.id) ? 'Restore' : 'Dismiss'}</button>
      </div>
    </div>
    <div class="d-body">
      ${note ? `<p class="source-note">${note}</p>` : ''}
      <ul class="facts">
        ${j.minYears != null ? `<li>Asks for <b>${j.minYears}+ years</b> of experience</li>` : ''}
        ${fit ? `<li>Your resume covers <b>${fit.have} of ${fit.of}</b> skills it mentions${fit.missing.length ? `; missing ${esc(fit.missing.slice(0, 8).join(', '))}` : ''}</li>` : ''}
        ${j.emails?.length ? `<li>Contact in posting: ${j.emails.map((e) => `<b>${esc(e)}</b>`).join(', ')}</li>` : ''}
        ${j.alsoOn?.length ? `<li>Also listed on ${esc(j.alsoOn.join(', '))}</li>` : ''}
      </ul>
      <div class="posting">${esc(j.description || 'No description provided.')}</div>
    </div>`;
}
