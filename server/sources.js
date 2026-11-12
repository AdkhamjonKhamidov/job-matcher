// Job source adapters. Each returns raw normalized jobs; enrichment happens in jobs.js.
// Only public APIs/feeds that publish jobs for reuse are used. No LinkedIn/Indeed scraping
// (both forbid it and block bots); apply links always go to the original posting.

import { htmlToText, toIso, looksRemote, decodeEntities } from './text.js';
import { cached } from './cache.js';

const UA = 'job-matcher/1.0 (personal local job reader)';
const TIMEOUT_MS = 20000;

async function get(url, { type = 'json', headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : '*/*', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return type === 'json' ? res.json() : res.text();
}

const salaryRange = (min, max, cur = '$') =>
  min || max ? [min && `${cur}${Math.round(min).toLocaleString('en-US')}`, max && `${cur}${Math.round(max).toLocaleString('en-US')}`].filter(Boolean).join(' - ') : '';

const HOUR = 3600 * 1000;
const prettySlug = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const SOURCES = [
  {
    id: 'remotive', name: 'Remotive', home: 'https://remotive.com', kind: 'remote',
    // Remotive asks for at most ~4 requests a day.
    ttl: 6 * HOUR,
    async fetch() {
      const data = await get('https://remotive.com/api/remote-jobs');
      return (data.jobs || []).map((j) => ({
        id: `remotive-${j.id}`, title: j.title, company: j.company_name,
        location: j.candidate_required_location || 'Remote', remote: true,
        url: j.url, applyUrl: j.url, postedAt: toIso(j.publication_date),
        description: htmlToText(j.description), salary: j.salary || '', tags: j.tags || [],
      }));
    },
  },
  {
    id: 'remoteok', name: 'Remote OK', home: 'https://remoteok.com', kind: 'remote', ttl: HOUR,
    async fetch() {
      const data = await get('https://remoteok.com/api');
      return data.filter((j) => j.id && j.position).map((j) => ({
        id: `remoteok-${j.id}`, title: decodeEntities(j.position), company: decodeEntities(j.company),
        location: j.location || 'Remote', remote: true,
        url: j.url, applyUrl: j.apply_url || j.url, postedAt: toIso(j.epoch || j.date),
        description: htmlToText(j.description), salary: salaryRange(j.salary_min, j.salary_max), tags: j.tags || [],
      }));
    },
  },
  {
    id: 'jobicy', name: 'Jobicy', home: 'https://jobicy.com', kind: 'remote', ttl: HOUR,
    async fetch() {
      const data = await get('https://jobicy.com/api/v2/remote-jobs?count=100');
      return (data.jobs || []).map((j) => ({
        id: `jobicy-${j.id}`, title: decodeEntities(j.jobTitle), company: decodeEntities(j.companyName),
        location: j.jobGeo ? `Remote (${j.jobGeo})` : 'Remote', remote: true,
        url: j.url, applyUrl: j.url, postedAt: toIso(j.pubDate),
        description: htmlToText(j.jobDescription || j.jobExcerpt),
        salary: salaryRange(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency === 'USD' || !j.salaryCurrency ? '$' : `${j.salaryCurrency} `),
        tags: [].concat(j.jobIndustry || [], j.jobType || []),
      }));
    },
  },
  {
    id: 'himalayas', name: 'Himalayas', home: 'https://himalayas.app', kind: 'remote', ttl: HOUR,
    async fetch({ maxAgeDays }) {
      const out = [];
      let cursor = '';
      for (let page = 0; page < 5; page++) {
        const data = await get(`https://himalayas.app/jobs/api?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        const jobs = data.jobs || [];
        for (const j of jobs) {
          out.push({
            id: `himalayas-${j.guid}`, title: j.title, company: j.companyName,
            location: j.locationRestrictions?.length ? `Remote (${j.locationRestrictions.join(', ')})` : 'Remote', remote: true,
            url: j.guid, applyUrl: j.applicationLink || j.guid, postedAt: toIso(j.pubDate),
            description: htmlToText(j.description || j.excerpt),
            salary: salaryRange(j.minSalary, j.maxSalary, j.currency && j.currency !== 'USD' ? `${j.currency} ` : '$'),
            tags: [].concat(j.categories || [], j.seniority || []),
          });
        }
        const oldest = jobs.at(-1)?.pubDate;
        if (!data.nextCursor || !jobs.length || (oldest && Date.now() / 1000 - oldest > maxAgeDays * 86400)) break;
        cursor = data.nextCursor;
      }
      return out;
    },
    cacheKey: ({ maxAgeDays }) => `d${maxAgeDays}`,
  },
  {
    id: 'weworkremotely', name: 'We Work Remotely', home: 'https://weworkremotely.com', kind: 'remote', ttl: HOUR,
    async fetch() {
      const feeds = ['remote-programming-jobs', 'remote-devops-sysadmin-jobs', 'remote-customer-support-jobs'];
      const texts = await Promise.all(feeds.map((f) => get(`https://weworkremotely.com/categories/${f}.rss`, { type: 'text' })));
      const out = [];
      for (const xml of texts) {
        for (const item of xml.split('<item>').slice(1)) {
          const tag = (n) => (item.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() || '';
          const rawTitle = decodeEntities(tag('title'));
          const idx = rawTitle.indexOf(': ');
          const link = tag('link') || tag('guid');
          out.push({
            id: `wwr-${link}`, company: idx > 0 ? rawTitle.slice(0, idx) : '', title: idx > 0 ? rawTitle.slice(idx + 2) : rawTitle,
            location: tag('region') ? `Remote (${decodeEntities(tag('region'))})` : 'Remote', remote: true,
            url: link, applyUrl: link, postedAt: toIso(tag('pubDate')),
            description: htmlToText(tag('description')), salary: '', tags: [decodeEntities(tag('category'))].filter(Boolean),
          });
        }
      }
      return out;
    },
  },
  {
    id: 'arbeitnow', name: 'Arbeitnow', home: 'https://www.arbeitnow.com', kind: 'mixed', ttl: HOUR,
    async fetch() {
      const data = await get('https://www.arbeitnow.com/api/job-board-api');
      return (data.data || []).map((j) => ({
        id: `arbeitnow-${j.slug}`, title: j.title, company: j.company_name,
        location: j.remote ? `Remote${j.location ? ` / ${j.location}` : ''}` : j.location, remote: !!j.remote,
        url: j.url, applyUrl: j.url, postedAt: toIso(j.created_at),
        description: htmlToText(j.description), salary: '', tags: [].concat(j.tags || [], j.job_types || []),
      }));
    },
  },
  {
    id: 'adzuna', name: 'Adzuna (local)', home: 'https://www.adzuna.com', kind: 'local', ttl: HOUR,
    needs: 'Free Adzuna app ID and key in Settings',
    enabled: (s) => !!(s.adzuna?.appId && s.adzuna?.appKey),
    cacheKey: ({ adzuna, maxAgeDays }) => [adzuna.country, adzuna.where, adzuna.distanceMiles, maxAgeDays, adzuna.appId].join('|'),
    async fetch({ adzuna, maxAgeDays }) {
      const country = (adzuna.country || 'us').toLowerCase();
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const p = new URLSearchParams({
          app_id: adzuna.appId, app_key: adzuna.appKey, results_per_page: '50',
          category: 'it-jobs', sort_by: 'date', max_days_old: String(maxAgeDays), 'content-type': 'application/json',
        });
        if (adzuna.where) {
          p.set('where', adzuna.where);
          p.set('distance', String(Math.round((Number(adzuna.distanceMiles) || 25) * 1.609)));
        }
        const data = await get(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${p}`);
        const results = data.results || [];
        for (const j of results) {
          out.push({
            id: `adzuna-${j.id}`, title: htmlToText(j.title), company: j.company?.display_name || '',
            location: j.location?.display_name || '', remote: looksRemote(j.title, j.description),
            url: j.redirect_url, applyUrl: j.redirect_url, postedAt: toIso(j.created),
            description: htmlToText(j.description), descriptionIsSnippet: true,
            salary: salaryRange(j.salary_min, j.salary_max), tags: [j.category?.label, j.contract_time].filter(Boolean),
          });
        }
        if (results.length < 50) break;
      }
      return out;
    },
  },
  {
    id: 'greenhouse', name: 'Company boards (Greenhouse)', home: 'https://boards.greenhouse.io', kind: 'company', ttl: HOUR,
    enabled: (s) => s.boards?.greenhouse?.length > 0,
    cacheKey: ({ boards }) => boards.greenhouse.join(','),
    async fetch({ boards }) {
      return boardFetch(boards.greenhouse, async (slug) => {
        const data = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
        return (data.jobs || []).map((j) => {
          const loc = j.location?.name || '';
          return {
            id: `gh-${slug}-${j.id}`, title: j.title, company: j.company_name || slug, location: loc,
            remote: looksRemote(loc, ...(j.offices || []).map((o) => o.name)),
            url: j.absolute_url, applyUrl: j.absolute_url, postedAt: toIso(j.first_published || j.updated_at),
            description: htmlToText(j.content), salary: '', tags: (j.departments || []).map((d) => d.name),
          };
        });
      });
    },
  },
  {
    id: 'lever', name: 'Company boards (Lever)', home: 'https://jobs.lever.co', kind: 'company', ttl: HOUR,
    enabled: (s) => s.boards?.lever?.length > 0,
    cacheKey: ({ boards }) => boards.lever.join(','),
    async fetch({ boards }) {
      return boardFetch(boards.lever, async (slug) => {
        const data = await get(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
        return (Array.isArray(data) ? data : []).map((j) => {
          const loc = j.categories?.location || '';
          const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
          return {
            id: `lever-${j.id}`, title: j.text, company: prettySlug(slug), location: loc,
            remote: j.workplaceType === 'remote' || looksRemote(loc),
            url: j.hostedUrl, applyUrl: j.applyUrl || j.hostedUrl, postedAt: toIso(j.createdAt),
            description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n'),
            salary: j.salaryRange ? salaryRange(j.salaryRange.min, j.salaryRange.max) : '',
            tags: [j.categories?.team, j.categories?.commitment].filter(Boolean),
          };
        });
      });
    },
  },
  {
    id: 'ashby', name: 'Company boards (Ashby)', home: 'https://jobs.ashbyhq.com', kind: 'company', ttl: HOUR,
    enabled: (s) => s.boards?.ashby?.length > 0,
    cacheKey: ({ boards }) => boards.ashby.join(','),
    async fetch({ boards }) {
      return boardFetch(boards.ashby, async (slug) => {
        const data = await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`);
        return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => {
          const locs = [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean);
          return {
            id: `ashby-${j.id}`, title: j.title.trim(), company: prettySlug(slug), location: locs.slice(0, 3).join(' / '),
            remote: !!j.isRemote || looksRemote(...locs),
            url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl, postedAt: toIso(j.publishedAt),
            description: j.descriptionPlain || htmlToText(j.descriptionHtml),
            salary: j.compensation?.compensationTierSummary || '', tags: [j.department, j.team, j.employmentType].filter(Boolean),
          };
        });
      });
    },
  },
];

// Fetch many company boards; one bad slug should not sink the rest.
async function boardFetch(slugs, fn) {
  const results = await Promise.allSettled(slugs.map(fn));
  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  const failed = slugs.filter((_, i) => results[i].status === 'rejected');
  if (!ok.length && failed.length) throw new Error(`No boards loaded (${failed.join(', ')})`);
  return ok;
}

export async function runSource(src, settings, { force = false } = {}) {
  const key = `${src.id}-${src.cacheKey ? src.cacheKey(settings) : 'all'}`;
  return cached(key, src.ttl, () => src.fetch(settings), { force });
}
