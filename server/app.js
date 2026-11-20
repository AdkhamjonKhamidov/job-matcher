// The Express app, shared by the local server (server/index.js) and Vercel (api/index.js).
import express from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOSTED = !!process.env.VERCEL;

// Optional .env with AI-provider keys and Adzuna credentials (git-ignored, local only).
if (!HOSTED) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env */ }
} else if (process.env.ALLOW_SERVER_KEYS !== '1') {
  // On a public URL a server-side key would let every visitor spend your quota.
  // Visitors bring their own keys (kept in their browser) unless you opt in.
  for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY']) delete process.env[k];
}

const { aggregate, DEFAULT_BOARDS, enrich } = await import('./jobs.js');
const { AI_PROVIDERS, listModels, tailorAI } = await import('./ai.js');
const { SOURCES } = await import('./sources.js');
const { clearCache } = await import('./cache.js');
const { describe, parsePosting } = await import('./describe.js');
const { geocode, majorCities } = await import('./geo.js');
const { makePlan } = await import('./plan.js');
const { requiredYears, entryHint, extractEmails, workAuth, categorize } = await import('./text.js');

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', HOSTED);

app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  // Locally: refuse anything not addressed to localhost (blocks DNS-rebinding pages).
  if (!HOSTED && !LOCAL_HOSTS.includes(host)) return res.status(403).send('Local use only');
  // Everywhere: API calls must come from this same site.
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).hostname; } catch { /* bad origin */ }
    if (originHost !== host && !(LOCAL_HOSTS.includes(originHost) && LOCAL_HOSTS.includes(host))) return res.status(403).send('Cross-site requests are not allowed');
  }
  res.set({
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    // Everything is served from this app: no CDNs, fonts, analytics or remote images.
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  next();
});

app.use(express.json({ limit: '2mb' }));
// public/vendor is filled from node_modules by scripts/vendor.js (npm postinstall).
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({
    defaultBoards: DEFAULT_BOARDS,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, home: s.home, kind: s.kind, needs: s.needs || null })),
    serverAiProviders: {
      gemini: !!process.env.GEMINI_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
    hosted: HOSTED,
  });
});

app.post('/api/jobs', async (req, res) => {
  try {
    res.json(await aggregate(req.body?.settings || {}, { force: !!req.body?.force && !HOSTED }));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/cache/clear', async (_req, res) => {
  if (HOSTED) return res.status(403).json({ error: 'The shared job cache cannot be cleared on the hosted version.' });
  await clearCache();
  res.json({ ok: true });
});

app.get('/api/geocode', (req, res) => {
  const hit = geocode(String(req.query.q || '').slice(0, 100));
  if (!hit) return res.status(404).json({ error: 'No US place by that name. Try "City, ST" or a ZIP code.' });
  res.json(hit);
});

app.get('/api/major-cities', (_req, res) => {
  res.json({ cities: majorCities() });
});

app.post('/api/plan', async (req, res) => {
  const { model, resumeText, targets, demand } = req.body || {};
  const provider = String(req.body?.provider || 'gemini');
  if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Choose Gemini, OpenAI, or Anthropic in Settings.' });
  const apiKey = keyFrom(req.body, provider);
  if (!apiKey) return res.status(400).json({ error: 'AI writing is optional. To create a plan, set it up in Settings; job search does not need it.' });
  if (!resumeText || String(resumeText).trim().length < 80) return res.status(400).json({ error: 'Load your resume first (it looks empty).' });
  try {
    res.json(await makePlan({ provider, apiKey, model: model || 'auto', resumeText, targets, demand }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/describe', async (req, res) => {
  const url = String(req.body?.url || '');
  if (!/^https?:\/\//i.test(url) || url.length > 2000) return res.status(400).json({ error: 'Missing posting link.' });
  try {
    const text = await describe(url);
    res.json({ text, minYears: requiredYears(text), entryHint: entryHint(text), emails: extractEmails(text), ...workAuth(text) });
  } catch (err) {
    res.status(422).json({ error: String(err.message || err).slice(0, 300) });
  }
});

app.post('/api/import', async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  let url = null, parsed;
  try {
    if (rawUrl) {
      if (!/^https:\/\//i.test(rawUrl) || rawUrl.length > 2000) return res.status(400).json({ error: 'Paste a complete secure job-posting link that starts with https://.' });
      url = new URL(rawUrl);
      if (url.username || url.password) return res.status(400).json({ error: 'Links with account credentials cannot be imported.' });
      parsed = await parsePosting(url.href);
    } else {
      parsed = {
        title: String(req.body?.title || '').trim().slice(0, 180),
        company: String(req.body?.company || '').trim().slice(0, 120),
        location: String(req.body?.location || '').trim().slice(0, 160),
        description: String(req.body?.description || '').trim().slice(0, 20000),
      };
      if (!parsed.title || parsed.description.length < 80) return res.status(400).json({ error: 'Add a job title and at least a few lines of the posting.' });
      const link = String(req.body?.applyUrl || '').trim();
      if (link) {
        if (!/^https:\/\//i.test(link) || link.length > 2000) return res.status(400).json({ error: 'The application link must start with https://.' });
        url = new URL(link);
        if (url.username || url.password) return res.status(400).json({ error: 'Links with account credentials cannot be saved.' });
      }
    }
    const category = categorize(parsed.title);
    if (!category) return res.status(422).json({ error: 'I could not match this job title to a career field yet. You can still open the original posting directly.' });
    const host = url?.hostname.replace(/^www\./, '') || 'Pasted posting';
    const identity = url?.href || `${parsed.title}|${parsed.company}|${parsed.description}`;
    const id = `manual-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
    const job = enrich({
      ...parsed, id, category, source: 'manual', sourceName: host, sourceHome: url?.origin || '',
      url: url?.href || '', applyUrl: url?.href || '', fullTextLoaded: true, needsFullText: false,
      imported: true, importedAt: new Date().toISOString(),
    });
    res.json({ job });
  } catch (err) {
    res.status(422).json({ error: String(err.message || err).slice(0, 300) });
  }
});

const providerEnvKey = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const keyFrom = (body, provider = 'gemini') => String(body?.apiKey || process.env[providerEnvKey[provider]] || '').trim();

app.post('/api/models', async (req, res) => {
  const provider = String(req.body?.provider || 'gemini');
  if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Choose Gemini, OpenAI, or Anthropic.' });
  const apiKey = keyFrom(req.body, provider);
  if (!apiKey) return res.status(400).json({ error: 'AI writing is optional. To create tailored documents, set it up in Settings; job search does not need it.' });
  try {
    res.json({ models: await listModels(provider, apiKey) });
  } catch (err) {
    res.status(err.status === 400 || err.status === 403 ? 401 : 502).json({ error: err.message });
  }
});

app.post('/api/tailor', async (req, res) => {
  const { model, resumeText, job, notes, tone } = req.body || {};
  const provider = String(req.body?.provider || 'gemini');
  if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Choose Gemini, OpenAI, or Anthropic in Settings.' });
  const apiKey = keyFrom(req.body, provider);
  if (!apiKey) return res.status(400).json({ error: 'AI writing is optional. Set it up in Settings first.' });
  if (!resumeText || String(resumeText).trim().length < 80) return res.status(400).json({ error: 'Load your resume first (it looks empty).' });
  if (!job?.title) return res.status(400).json({ error: 'No job selected.' });
  try {
    res.json(await tailorAI({ provider, apiKey, model: model || 'auto', resumeText, job, notes, tone }));
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
  }
});

// App pages (/map, /apply/123, /welcome, ...) are client-side routes: serve the shell.
// Paths with a file extension stay 404 so a missing asset isn't answered with HTML.
app.get(/^\/(?!api\/)[^.]*$/, (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));

export default app;
