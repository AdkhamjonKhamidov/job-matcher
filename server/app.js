// The Express app, shared by the local server (server/index.js) and Vercel (api/index.js).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOSTED = !!process.env.VERCEL;

// Optional .env with GEMINI_API_KEY / ADZUNA_APP_ID / ADZUNA_APP_KEY (git-ignored, local only).
if (!HOSTED) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env */ }
} else if (process.env.ALLOW_SERVER_KEYS !== '1') {
  // On a public URL a server-side key would let every visitor spend your quota.
  // Visitors bring their own keys (kept in their browser) unless you opt in.
  for (const k of ['GEMINI_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY']) delete process.env[k];
}

const { aggregate, DEFAULT_BOARDS } = await import('./jobs.js');
const { listModels, rankModels, tailor } = await import('./gemini.js');
const { SOURCES } = await import('./sources.js');
const { clearCache } = await import('./cache.js');

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
app.use('/vendor/pdfjs', express.static(path.join(ROOT, 'node_modules/pdfjs-dist/build')));
app.use('/vendor/mammoth', express.static(path.join(ROOT, 'node_modules/mammoth')));
app.use('/vendor/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource')));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({
    defaultBoards: DEFAULT_BOARDS,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, home: s.home, kind: s.kind, needs: s.needs || null })),
    serverGeminiKey: !!process.env.GEMINI_API_KEY,
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

const keyFrom = (body) => String(body?.apiKey || process.env.GEMINI_API_KEY || '').trim();

app.post('/api/models', async (req, res) => {
  const apiKey = keyFrom(req.body);
  if (!apiKey) return res.status(400).json({ error: 'Add a Gemini API key in Settings first.' });
  try {
    const models = await listModels(apiKey);
    const order = rankModels(models.map((m) => m.id));
    res.json({ models: order.map((id) => models.find((m) => m.id === id)) });
  } catch (err) {
    res.status(err.status === 400 || err.status === 403 ? 401 : 502).json({ error: err.message });
  }
});

app.post('/api/tailor', async (req, res) => {
  const { model, resumeText, job, notes, tone } = req.body || {};
  const apiKey = keyFrom(req.body);
  if (!apiKey) return res.status(400).json({ error: 'Add a Gemini API key in Settings first.' });
  if (!resumeText || String(resumeText).trim().length < 80) return res.status(400).json({ error: 'Load your resume first (it looks empty).' });
  if (!job?.title) return res.status(400).json({ error: 'No job selected.' });
  try {
    res.json(await tailor({ apiKey, model: model || 'auto', resumeText, job, notes, tone }));
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
  }
});

export default app;
