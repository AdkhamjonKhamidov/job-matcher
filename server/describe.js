// Fetch the full text of one posting when a list (e.g. Simplify) only has its title and link.
// Uses each ATS's public JSON where possible, otherwise the page's schema.org JobPosting data.

import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { htmlToText, decodeEntities, toIso, looksRemote } from './text.js';
import { cached } from './cache.js';

const UA = 'Mozilla/5.0 (compatible; job-matcher/1.0; personal job reader)';
const MAX_BYTES = 3_000_000;

function privateIp(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::')) return true;
    const first = parseInt(v.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
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
  return addrs[0];
}

async function requestPublic(url, address, { json }) {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,application/xhtml+xml' },
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family || isIP(address.address));
      },
      signal: AbortSignal.timeout(15000),
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        resolve({ status, location });
        return;
      }
      if (!res.statusCode || status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`The posting page returned HTTP ${status}.`));
        return;
      }
      const len = Number(res.headers['content-length'] || 0);
      if (len > MAX_BYTES) {
        req.destroy(new Error('The posting page is too large.'));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error('The posting page is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function safeFetch(url, { json = false } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    const address = await assertPublic(current);
    const res = await requestPublic(u, address, { json });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, current).toString();
      continue;
    }
    return json ? JSON.parse(res.body) : res.body;
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
      return {
        title: j.title, company: j.company_name, location: j.location?.name || '',
        postedAt: toIso(j.first_published || j.updated_at), description: htmlToText(j.content),
        tags: (j.departments || []).map((d) => d.name),
      };
    }
  }
  if (host === 'jobs.lever.co' && parts.length >= 2) {
    const j = await safeFetch(`https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`, { json: true });
    const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
    return {
      title: j.text, company: parts[0].replace(/[-_]+/g, ' '), location: j.categories?.location || '',
      postedAt: toIso(j.createdAt), description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n'),
      remote: j.workplaceType === 'remote' || looksRemote(j.categories?.location),
      tags: [j.categories?.team, j.categories?.commitment].filter(Boolean),
    };
  }
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
    const data = await safeFetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parts[0])}`, { json: true });
    const j = (data.jobs || []).find((x) => x.id === parts[1]);
    if (j) return {
      title: j.title, company: parts[0].replace(/[-_]+/g, ' '), location: j.location || '',
      postedAt: toIso(j.publishedAt), description: j.descriptionPlain || htmlToText(j.descriptionHtml),
      remote: !!j.isRemote || looksRemote(j.location), tags: [j.department, j.team, j.employmentType].filter(Boolean),
    };
  }
  if (/\.oraclecloud\.com$/.test(host)) {
    const m = u.pathname.match(/\/sites\/([^/]+)\/job\/(\d+)/);
    if (m) {
      const data = await safeFetch(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${m[2]}%22,siteNumber=${m[1]}`, { json: true });
      const j = data.items?.[0] || {};
      return {
        title: j.ExternalTitle || j.JobTitle || j.Title, company: j.OrganizationName || j.LegalEmployerName,
        location: j.PrimaryLocation || '', postedAt: toIso(j.PostedDate),
        description: [j.ExternalDescriptionStr, j.ExternalResponsibilitiesStr, j.ExternalQualificationsStr, j.CorporateDescriptionStr].map((x) => htmlToText(x || '')).filter(Boolean).join('\n\n'),
      };
    }
  }
  if (host === 'jobs.smartrecruiters.com' && parts.length >= 2) {
    const id = (parts[1].match(/^\d+/) || [])[0];
    if (id) {
      const j = await safeFetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parts[0])}/postings/${id}`, { json: true });
      const sec = j.jobAd?.sections || {};
      return {
        title: j.name, company: j.company?.name || parts[0],
        location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '),
        postedAt: toIso(j.releasedDate),
        description: ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
          .map((k) => sec[k] && `${sec[k].title || ''}\n${htmlToText(sec[k].text)}`).filter(Boolean).join('\n\n'),
      };
    }
  }
  if (host === 'apply.workable.com' && parts[1] === 'j' && parts[2]) {
    const j = await safeFetch(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(parts[0])}/jobs/${encodeURIComponent(parts[2])}`, { json: true });
    return {
      title: j.title, company: j.account?.name || parts[0], location: j.location?.city || '',
      postedAt: toIso(j.published_on), description: [j.description, j.requirements, j.benefits].map(htmlToText).filter(Boolean).join('\n\n'),
      remote: !!j.telecommuting || looksRemote(j.location?.city),
    };
  }
  if (/\.myworkdayjobs\.com$/.test(host)) {
    const tenant = host.split('.')[0];
    const rest = parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/) ? parts.slice(1) : parts;
    const site = rest[0];
    const jobPath = rest.slice(1).join('/');
    if (site && jobPath.startsWith('job/')) {
      const j = await safeFetch(`https://${host}/wday/cxs/${tenant}/${site}/${jobPath}`, { json: true });
      const info = j.jobPostingInfo || {};
      return {
        title: info.title, company: info.company || site, location: info.location || '',
        postedAt: toIso(info.postedOn), description: htmlToText(info.jobDescription),
        remote: /remote|telecommute/i.test(info.remoteType || ''),
      };
    }
  }
  return null;
}

function ldItems(value) {
  if (Array.isArray(value)) return value.flatMap(ldItems);
  if (!value || typeof value !== 'object') return [];
  return [...(Array.isArray(value['@graph']) ? value['@graph'].flatMap(ldItems) : []), value];
}

function ldLocation(value) {
  const places = [].concat(value || []).map((place) => {
    const address = place?.address || place;
    if (typeof address === 'string') return address;
    return [address?.addressLocality, address?.addressRegion, address?.postalCode, address?.addressCountry?.name || address?.addressCountry]
      .filter(Boolean).join(', ');
  }).filter(Boolean);
  return [...new Set(places)].join(' / ');
}

export function parseStructuredPosting(html, url = '') {
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1].trim());
      const post = ldItems(data).find((item) => [].concat(item['@type'] || []).some((type) => String(type).toLowerCase() === 'jobposting'));
      if (!post?.title) continue;
      const organization = [].concat(post.hiringOrganization || [])[0];
      const location = ldLocation(post.jobLocation);
      return {
        title: String(post.title).trim(),
        company: organization?.name || '',
        location: location || (looksRemote(post.jobLocationType) ? 'Remote' : ''),
        postedAt: toIso(post.datePosted),
        description: htmlToText(decodeEntities(post.description || '')),
        remote: looksRemote(post.jobLocationType),
        tags: [].concat(post.employmentType || [], post.occupationalCategory || []).filter(Boolean),
        url,
      };
    } catch { /* malformed JSON-LD on the page */ }
  }
  return null;
}

export async function parsePosting(url) {
  const u = new URL(url);
  const { data } = await cached(`parse-${u.href}`, 6 * 3600 * 1000, async () => {
    let ats = null;
    const documentedPublicAts = /(^|\.)greenhouse\.io$/.test(u.hostname) || u.hostname === 'jobs.lever.co' || u.hostname === 'jobs.ashbyhq.com';
    if (documentedPublicAts) {
      try { ats = await viaAts(u); } catch { /* Fall back to the public job page. */ }
    }
    const html = await safeFetch(u.href);
    const structured = parseStructuredPosting(html, u.href) || {};
    const title = structured.title || ats?.title;
    if (!title) throw new Error('Could not find job details on that page. Paste a direct posting link from an employer or a supported job board.');
    const description = structured.description || ats?.description || fromHtml(html);
    if (!description || description.length < 80) throw new Error('The posting page did not include enough job details to import.');
    return {
      ...ats, ...structured,
      title, company: structured.company || ats?.company || u.hostname,
      location: structured.location || ats?.location || '',
      postedAt: structured.postedAt || ats?.postedAt || null,
      description, remote: structured.remote || ats?.remote || looksRemote(structured.location || ats?.location),
      tags: [...new Set([...(structured.tags || []), ...(ats?.tags || [])])],
      url: u.href,
    };
  });
  return data;
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
    try { text = (await viaAts(u))?.description || null; } catch { text = null; }
    if (!text || text.length < 200) text = fromHtml(await safeFetch(url));
    text = (text || '').replace(/\\r\\n|\\n|\\r/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
    if (text.length < 200) throw new Error('Could not read the posting text (the page may need JavaScript). Open it and paste the description into the job notes.');
    return text;
  });
  return data;
}
