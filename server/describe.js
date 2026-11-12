// Fetch the full text of one posting when a list (e.g. Simplify) only has its title and link.
// Uses each ATS's public JSON where possible, otherwise the page's schema.org JobPosting data.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { htmlToText, decodeEntities } from './text.js';
import { cached } from './cache.js';

const UA = 'Mozilla/5.0 (compatible; job-matcher/1.0; personal job reader)';
const MAX_BYTES = 3_000_000;

function privateIp(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// Refuse anything that resolves to this machine or a private network.
async function assertPublic(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links can be fetched.');
  if (u.username || u.password) throw new Error('Links with credentials are not fetched.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('That link points to a private address.');
}

async function safeFetch(url, { json = false } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const res = await fetch(current, {
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The posting page returned HTTP ${res.status}.`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('The posting page is too large.');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('The posting page is too large.');
    return json ? JSON.parse(text) : text;
  }
  throw new Error('Too many redirects.');
}

async function viaAts(u) {
  const parts = u.pathname.split('/').filter(Boolean);
  const host = u.hostname;
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const i = parts.indexOf('jobs');
    const slug = parts[i - 1], id = u.searchParams.get('gh_jid') || parts[i + 1];
    if (slug && id) {
      const j = await safeFetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`, { json: true });
      return htmlToText(j.content);
    }
  }
  if (host === 'jobs.lever.co' && parts.length >= 2) {
    const j = await safeFetch(`https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`, { json: true });
    const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
    return [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n');
  }
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
    const data = await safeFetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parts[0])}`, { json: true });
    const j = (data.jobs || []).find((x) => x.id === parts[1]);
    if (j) return j.descriptionPlain || htmlToText(j.descriptionHtml);
  }
  if (host === 'jobs.smartrecruiters.com' && parts.length >= 2) {
    const id = (parts[1].match(/^\d+/) || [])[0];
    if (id) {
      const j = await safeFetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parts[0])}/postings/${id}`, { json: true });
      const sec = j.jobAd?.sections || {};
      return ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
        .map((k) => sec[k] && `${sec[k].title || ''}\n${htmlToText(sec[k].text)}`).filter(Boolean).join('\n\n');
    }
  }
  if (host === 'apply.workable.com' && parts[1] === 'j' && parts[2]) {
    const j = await safeFetch(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(parts[0])}/jobs/${encodeURIComponent(parts[2])}`, { json: true });
    return [j.description, j.requirements, j.benefits].map(htmlToText).filter(Boolean).join('\n\n');
  }
  if (/\.myworkdayjobs\.com$/.test(host)) {
    const tenant = host.split('.')[0];
    const rest = parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/) ? parts.slice(1) : parts;
    const site = rest[0];
    const jobPath = rest.slice(1).join('/');
    if (site && jobPath.startsWith('job/')) {
      const j = await safeFetch(`https://${host}/wday/cxs/${tenant}/${site}/${jobPath}`, { json: true });
      return htmlToText(j.jobPostingInfo?.jobDescription);
    }
  }
  return null;
}

function fromHtml(html) {
  // Prefer schema.org JobPosting, which most career sites embed for Google Jobs.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = [].concat(data['@graph'] || data);
      const posting = items.find((x) => [].concat(x?.['@type']).includes('JobPosting'));
      if (posting?.description) return htmlToText(decodeEntities(posting.description));
    } catch { /* malformed JSON-LD */ }
  }
  const body = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<body[\s\S]*<\/body>/i) || [html])[0];
  return htmlToText(body.replace(/<(nav|header|footer|form|svg|noscript)[\s\S]*?<\/\1>/gi, ''));
}

export async function describe(url) {
  const { data } = await cached(`describe-${url}`, 24 * 3600 * 1000, async () => {
    const u = new URL(url);
    let text = null;
    try { text = await viaAts(u); } catch { text = null; }
    if (!text || text.length < 200) text = fromHtml(await safeFetch(url));
    text = (text || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
    if (text.length < 200) throw new Error('Could not read the posting text (the page may need JavaScript). Open it and paste the description into the job notes.');
    return text;
  });
  return data;
}
