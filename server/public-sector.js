// Schools, colleges and government employers. These publish openings on their own
// applicant-tracking systems instead of job boards, which is where many entry-level
// helpdesk / IT technician roles live. Defaults are Maryland employers.

import { htmlToText, toIso, decodeEntities } from './text.js';

const UA = 'Mozilla/5.0 (compatible; job-matcher/1.0; personal job reader)';
const HOUR = 3600 * 1000;

async function req(url, { json = true, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return json ? res.json() : res.text();
}

// "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago", "Posted 2 weeks ago" -> ISO date
export function relativeDate(text, now = Date.now()) {
  const t = String(text || '').toLowerCase();
  if (/today|just posted|hour|minute/.test(t)) return new Date(now).toISOString();
  if (/yesterday/.test(t)) return new Date(now - 86400000).toISOString();
  const m = t.match(/(\d+)\+?\s*(day|week|month|year)/);
  if (!m) return null;
  const days = Number(m[1]) * { day: 1, week: 7, month: 30, year: 365 }[m[2]];
  return new Date(now - days * 86400000).toISOString();
}

// Run one fetch per employer; one broken site shouldn't hide the others.
async function each(list, fn) {
  const results = await Promise.allSettled(list.map(fn));
  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!ok.length && results.some((r) => r.status === 'rejected')) throw new Error(results.find((r) => r.status === 'rejected').reason.message);
  return ok;
}

export const MARYLAND = {
  oracle: [
    { name: 'Baltimore County Public Schools', host: 'bcps-ibohjb.fa.ocs.oraclecloud.com', site: 'CX_1', place: 'Towson, MD' },
    { name: 'Harford County Public Schools', host: 'fa-exea-saasfaprod1.fa.ocs.oraclecloud.com', site: 'CX_1', place: 'Bel Air, MD' },
  ],
  workday: [
    { name: 'Howard County Public Schools', host: 'hcpss.wd1.myworkdayjobs.com', tenant: 'hcpss', site: 'hcpss', place: 'Ellicott City, MD' },
    { name: 'University of Maryland', host: 'umd.wd1.myworkdayjobs.com', tenant: 'umd', site: 'UMCP', place: 'College Park, MD' },
  ],
  applitrack: [
    { name: "Prince George's County Public Schools", client: 'pgcps', place: 'Upper Marlboro, MD' },
    { name: 'Frederick County Public Schools', client: 'fcps', place: 'Frederick, MD' },
    { name: 'Carroll County Public Schools', client: 'carrollk12', place: 'Westminster, MD' },
    { name: 'Washington County Public Schools', client: 'wcps', place: 'Hagerstown, MD' },
    { name: "St. Mary's County Public Schools", client: 'smcps', place: 'Leonardtown, MD' },
    { name: 'Cecil County Public Schools', client: 'cecil', place: 'Elkton, MD' },
    { name: 'Talbot County Public Schools', client: 'talbot', place: 'Easton, MD' },
  ],
  neogov: [
    { name: 'Baltimore County Government', agency: 'baltimorecounty', place: 'Towson, MD' },
    { name: "Prince George's County Government", agency: 'pgc', place: 'Largo, MD' },
    { name: 'Montgomery County Government', agency: 'montgomerycountymd', place: 'Rockville, MD' },
    { name: 'Howard County Government', agency: 'howardcounty', place: 'Ellicott City, MD' },
    { name: 'Anne Arundel County Government', agency: 'annearundel', place: 'Annapolis, MD' },
    { name: 'Charles County Government', agency: 'charlescountymd', place: 'La Plata, MD' },
  ],
  jobaps: [{ name: 'State of Maryland', code: 'MD', place: 'Maryland' }],
};

// Oracle Recruiting Cloud (Oracle HCM Candidate Experience)
async function oracle(o) {
  const url = `https://${o.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${encodeURIComponent(o.site)},limit=200,sortBy=POSTING_DATES_DESC`;
  const data = await req(url);
  return (data.items?.[0]?.requisitionList || []).map((j) => {
    const link = `https://${o.host}/hcmUI/CandidateExperience/en/sites/${o.site}/job/${j.Id}`;
    return {
      id: `orc-${o.host.split('.')[0]}-${j.Id}`, title: j.Title, company: o.name, location: j.PrimaryLocation || o.place, placeHint: o.place,
      remote: j.WorkplaceTypeCode === 'ORA_REMOTE', url: link, applyUrl: link, postedAt: toIso(j.PostedDate),
      description: htmlToText(j.ShortDescriptionStr || ''), descriptionIsSnippet: true, needsFullText: true,
      tags: [j.JobFamily, 'public sector'].filter(Boolean), sector: 'public',
    };
  });
}

// Workday career sites
async function workday(w) {
  const out = [];
  for (let offset = 0; offset < 100; offset += 20) {
    const data = await req(`https://${w.host}/wday/cxs/${w.tenant}/${w.site}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset, searchText: '' } });
    const posts = data.jobPostings || [];
    for (const j of posts) {
      const link = `https://${w.host}/${w.site}${j.externalPath}`;
      out.push({
        id: `wd-${w.tenant}-${(j.bulletFields || [])[0] || j.externalPath.split('_').pop()}`, title: j.title, company: w.name,
        location: j.locationsText && !/^\d+ locations$/i.test(j.locationsText) ? `${j.locationsText} (${w.place})` : w.place, placeHint: w.place,
        remote: /remote/i.test(j.remoteType || ''), url: link, applyUrl: link, postedAt: relativeDate(j.postedOn),
        description: '', descriptionIsSnippet: true, needsFullText: true, tags: [j.timeType, 'public sector'].filter(Boolean), sector: 'public',
      });
    }
    if (posts.length < 20 || /30\+/.test(posts.at(-1)?.postedOn || '')) break;
  }
  return out;
}

// Frontline AppliTrack (many school districts). The list comes as one big script.
async function applitrack(a) {
  const raw = await req(`https://www.applitrack.com/${a.client}/onlineapp/jobpostings/Output.asp?all=1`, { json: false });
  const js = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\//g, '/');
  const blocks = js.split("<ul class='postingsList'").slice(1);
  const field = (b, label) => htmlToText((b.match(new RegExp(`${label}:</span><br/>&nbsp;&nbsp;<span class=["']normal["']>([\\s\\S]*?)</span>`)) || [])[1] || '');
  return blocks.map((b) => {
    const id = (b.match(/JobID:\s*(\d+)/) || [])[1];
    const title = htmlToText((b.match(/id='wrapword'[^>]*>([\s\S]*?)<\/td>/) || [])[1] || '');
    const posted = field(b, 'Date Posted');
    const [mo, d, y] = posted.split('/').map(Number);
    const desc = (b.match(/id='DescriptionText\d+_'[^>]*>([\s\S]*?)<\/span><br \/><img/) || [])[1] || '';
    const loc = field(b, 'Location');
    const link = `https://www.applitrack.com/${a.client}/onlineapp/default.aspx?AppliTrackJobId=${id}&AppliTrackLayoutMode=detail&AppliTrackViewPosting=1`;
    return {
      id: `at-${a.client}-${id}`, title, company: a.name, location: loc && !/various/i.test(loc) ? `${loc} (${a.place})` : a.place, placeHint: a.place,
      remote: false, url: link, applyUrl: link, postedAt: y ? new Date(Date.UTC(y, mo - 1, d, 12)).toISOString() : null,
      description: [field(b, 'Position Type') && `Position type: ${field(b, 'Position Type')}`, htmlToText(desc)].filter(Boolean).join('\n\n'),
      tags: [field(b, 'Position Type'), 'public sector'].filter(Boolean), sector: 'public',
    };
  }).filter((j) => j.title && j.id);
}

// NEOGOV / GovernmentJobs.com (county and city governments)
async function neogov(n, maxAgeDays) {
  const out = [];
  for (let page = 1; page <= 6; page++) {
    const html = await req(`https://www.governmentjobs.com/careers/home/index?agency=${encodeURIComponent(n.agency)}&sort=PostingDate&isDescendingSort=true&page=${page}`, { json: false, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const items = html.split('<li class="list-item"').slice(1);
    let oldest = 0;
    for (const it of items) {
      const id = (it.match(/data-job-id="(\d+)"/) || [])[1];
      const href = (it.match(/class="item-details-link"[^>]*href="([^"]+)"/) || it.match(/href="([^"]+)"[^>]*class="item-details-link"/) || [])[1];
      const title = decodeEntities((it.match(/class="item-details-link"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '').trim();
      const metas = [...it.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => htmlToText(m[1]));
      const posted = relativeDate((it.match(/list-entry-starts">\s*<span>([^<]*)</) || [])[1]);
      const age = posted ? (Date.now() - Date.parse(posted)) / 86400000 : 0;
      oldest = Math.max(oldest, age);
      if (!id || !href) continue;
      const link = `https://www.governmentjobs.com${href}`;
      out.push({
        id: `ng-${n.agency}-${id}`, title, company: n.name, location: decodeEntities(metas[0] || n.place), placeHint: n.place,
        remote: false, url: link, applyUrl: link, postedAt: posted,
        description: htmlToText((it.match(/<div class="list-entry">([\s\S]*?)<\/div>/) || [])[1] || ''), descriptionIsSnippet: true, needsFullText: true,
        salary: (metas[1] || '').replace(/^[A-Z -]+-\s*/, '').trim(), tags: ['public sector'], sector: 'public',
      });
    }
    if (items.length < 10 || oldest > maxAgeDays) break;
  }
  return out;
}

// JobAps (State of Maryland and others) RSS
async function jobaps(s) {
  const xml = await req(`https://www.jobapscloud.com/${s.code}/rss.asp`, { json: false });
  return xml.split('<item>').slice(1).map((item) => {
    const tag = (n) => (item.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1]?.trim() || '';
    const link = decodeEntities(tag('link'));
    const desc = htmlToText(decodeEntities(tag('description')));
    return {
      id: `jobaps-${s.code}-${(link.match(/R2=(\d+)&(?:amp;)?R3=(\d+)/) || []).slice(1).join('-') || link}`,
      title: decodeEntities(tag('title')).replace(/\s*-\s*#[\d-]+\s*$/, '').trim(), company: s.name,
      location: (desc.match(/Location:\s*([^\n]+)/) || [])[1] || s.place, placeHint: s.place, remote: false,
      url: link, applyUrl: link, postedAt: toIso(tag('pubDate')), description: desc, descriptionIsSnippet: true, needsFullText: true,
      salary: (desc.match(/Salary:\s*([^\n.]+)/) || [])[1] || '', tags: ['public sector'], sector: 'public',
    };
  });
}

const pick = (settings, key) => settings.publicSector?.[key] || MARYLAND[key];

export const PUBLIC_SOURCES = [
  { id: 'schools-oracle', name: 'Schools on Oracle (BCPS, Harford)', home: 'https://www.bcps.org/jobs', kind: 'public', ttl: 3 * HOUR, fetch: (s) => each(pick(s, 'oracle'), oracle), cacheKey: (s) => pick(s, 'oracle').map((x) => x.host).join(',') },
  { id: 'schools-workday', name: 'Howard schools & UMD (Workday)', home: 'https://hcpss.wd1.myworkdayjobs.com/hcpss', kind: 'public', ttl: 3 * HOUR, fetch: (s) => each(pick(s, 'workday'), workday), cacheKey: (s) => pick(s, 'workday').map((x) => x.tenant).join(',') },
  { id: 'schools-applitrack', name: 'MD school districts (AppliTrack)', home: 'https://www.applitrack.com/pgcps/onlineapp/', kind: 'public', ttl: 3 * HOUR, fetch: (s) => each(pick(s, 'applitrack'), applitrack), cacheKey: (s) => pick(s, 'applitrack').map((x) => x.client).join(',') },
  { id: 'gov-neogov', name: 'MD county governments (NEOGOV)', home: 'https://www.governmentjobs.com/careers/baltimorecounty', kind: 'public', ttl: 3 * HOUR, fetch: (s) => each(pick(s, 'neogov'), (n) => neogov(n, Math.max(30, s.maxAgeDays))), cacheKey: (s) => pick(s, 'neogov').map((x) => x.agency).join(',') },
  { id: 'gov-jobaps', name: 'State of Maryland (JobAps)', home: 'https://www.jobapscloud.com/MD/', kind: 'public', ttl: 3 * HOUR, fetch: (s) => each(pick(s, 'jobaps'), jobaps), cacheKey: (s) => pick(s, 'jobaps').map((x) => x.code).join(',') },
];
