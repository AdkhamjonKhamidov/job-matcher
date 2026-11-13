// Gemini calls. The API key comes from the browser (stored in its localStorage) or GEMINI_API_KEY.
// Nothing here is logged or written to disk.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ATTEMPT_MS = 70000;

async function call(path, apiKey, body, timeoutMs = 20000, signal = null) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${BASE}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini returned HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function listModels(apiKey) {
  const data = await call('models?pageSize=200', apiKey);
  return (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name) && !/(embedding|tts|image|audio|live|native|robotics|transcribe|computer-use|customtools|banana|omni)/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    matchScore: { type: 'INTEGER', description: '0-100 honest fit of the resume to this job' },
    matchSummary: { type: 'STRING' },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    gaps: { type: 'ARRAY', items: { type: 'STRING' } },
    keywords: { type: 'ARRAY', items: { type: 'STRING' } },
    resume: { type: 'STRING' },
    coverLetter: { type: 'STRING' },
    recruiterEmailSubject: { type: 'STRING' },
    recruiterEmailBody: { type: 'STRING' },
    linkedinNote: { type: 'STRING' },
    linkedinMessage: { type: 'STRING' },
    screeningAnswers: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { question: { type: 'STRING' }, answer: { type: 'STRING' } }, required: ['question', 'answer'] },
    },
  },
  required: ['matchScore', 'matchSummary', 'strengths', 'gaps', 'keywords', 'resume', 'coverLetter', 'recruiterEmailSubject', 'recruiterEmailBody', 'linkedinNote', 'linkedinMessage', 'screeningAnswers'],
};

export function buildPrompt({ resumeText, job, notes = '', tone = 'professional' }) {
  return `You are an expert technical recruiter and resume writer helping a candidate apply for one specific job.

RULES
- Never invent employers, titles, dates, degrees, certifications, tools or numbers. Only reword, reorder and emphasize what the resume already shows.
- If the job asks for something the resume lacks, list it under "gaps" and do not claim it anywhere.
- Do not add experience bullets for tasks the resume does not describe. A tool that appears only in a skills list stays in the skills section; do not turn it into an accomplishment. Example: if "DNS, DHCP, VPN" is only listed under Skills, do NOT write "Resolved DNS, DHCP and VPN issues" as a job bullet.
- Never state work authorization, citizenship, visa or sponsorship status, security clearance, degrees, certifications or availability unless the resume states them.
- Years of experience: only state a number if the resume's dates clearly support it.
- Mirror the job's own wording for skills the candidate genuinely has, so ATS keyword filters match.
- Keep the resume to what fits on 1-2 pages. Plain text with simple markdown: "# Name", "## Section", "- bullet". No tables, no columns.
- Contact details may appear as placeholders like [EMAIL] or [PHONE]. Keep those placeholders exactly as written.
- Cover letter: 3 short paragraphs, under 250 words, specific to this company and role, no "I am writing to express my interest".
- Recruiter email: under 120 words, plain text. End with the last sentence of the message: no "Best regards", no name, no signature (it is added later). Subject under 70 characters.
- LinkedIn connection note: under 280 characters, no greeting fluff.
- LinkedIn message: under 600 characters, for a recruiter or hiring manager at the company.
- Screening answers: 3 to 5 questions this employer is likely to ask (for example why this company, relevant experience, work authorization only if the resume states it), answered in first person in 2-4 sentences.
- Tone: ${tone}.
${notes ? `- Candidate notes (follow these): ${notes}\n` : ''}
JOB
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'n/a'}
${job.salary ? `Salary: ${job.salary}\n` : ''}Description${job.descriptionIsSnippet ? ' (short snippet only; infer conservatively)' : ''}:
${String(job.description || '').slice(0, 14000)}

CANDIDATE RESUME
${String(resumeText).slice(0, 20000)}`;
}

const BUSY = new Set([429, 500, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Newest stable full Flash first, then Pro, then Lite. Previews and "-latest" aliases last.
export function rankModels(ids) {
  const score = (id) => {
    const v = parseFloat((id.match(/gemini-(\d+(\.\d+)?)-/) || [])[1] || 0);
    const kind = /flash/.test(id) && !/lite/.test(id) ? 100 : /pro/.test(id) ? 50 : /flash/.test(id) ? 20 : 0;
    return kind + v - (/preview|exp|latest/.test(id) ? 200 : 0);
  };
  return [...ids].sort((a, b) => score(b) - score(a));
}

// Model list per key, cached in memory for an hour (never written to disk).
const modelCache = new Map();
async function availableModels(apiKey) {
  const hit = modelCache.get(apiKey);
  if (hit && Date.now() - hit.at < 3600000) return hit.ids;
  const ids = rankModels((await listModels(apiKey)).map((m) => m.id));
  modelCache.set(apiKey, { at: Date.now(), ids });
  return ids;
}

async function tryModel(m, apiKey, body, signal, resumeText) {
  const t0 = Date.now();
  try {
    const data = await call(`models/${encodeURIComponent(m)}:generateContent`, apiKey, body, ATTEMPT_MS, signal);
    const kit = guard(parseKit(data), resumeText);
    console.log(`[tailor] ${m} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { ...kit, model: m };
  } catch (err) {
    if (!signal.aborted) console.log(`[tailor] ${m} ${err.status || err.name} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    err.model = m;
    throw err;
  }
}

// Busy free-tier models often stall rather than refuse, so race the top two models,
// keep whichever answers first, cancel the other, then move on to the next pair.
export async function tailor({ apiKey, model, resumeText, job, notes, tone }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt({ resumeText, job, notes, tone }) }] }],
    generationConfig: { temperature: 0.5, responseMimeType: 'application/json', responseSchema: SCHEMA },
  };
  const ranked = (await availableModels(apiKey).catch(() => [])).filter((m) => !RETIRED.has(m));
  const first = !model || model === 'auto' || RETIRED.has(model) ? ranked[0] : model;
  const order = [...new Set([first, ...ranked])].filter(Boolean).slice(0, 8);
  let lastErr, sawBusy = false;
  const started = Date.now();
  for (let i = 0; i < order.length; i += 2) {
    if (Date.now() - started > 200000) break; // stay inside the hosting time limit
    const ctrl = new AbortController();
    try {
      const res = await Promise.any(order.slice(i, i + 2).map((m) => tryModel(m, apiKey, body, ctrl.signal, `${resumeText}\n${notes || ''}`)));
      ctrl.abort();
      return res;
    } catch (agg) {
      for (const err of agg.errors || [agg]) {
        lastErr = err;
        if (err.status === 404) RETIRED.add(err.model); // listed but gone for this key: skip next time
        else if (BUSY.has(err.status) || err.name === 'TimeoutError') sawBusy = true;
        else if (!/not valid JSON|no text/.test(err.message)) throw err;
      }
      await sleep(500);
    }
  }
  if (sawBusy) throw new Error('Every Gemini model is busy right now (Google is rate-limiting free keys). Wait a minute and press Tailor again.');
  throw lastErr || new Error('No Gemini model available for this key.');
}

// Models that answered 404 ("no longer available") during this server's life.
const RETIRED = new Set();

// Last line of defence for claims only the candidate can make, and sign-off clean-up.
const PERSONAL = [
  [/authori[sz]|eligib|legally|citizen|green card|work permit/i, /authori[sz]ed to work|citizen|green card|permanent resident|work permit|eligible to work/i],
  [/sponsor|visa/i, /sponsor|visa/i],
  [/clearance/i, /clearance/i],
  [/relocat/i, /relocat/i],
  [/start date|availab|notice period|when can you start/i, /availab|start date|notice|immediately/i],
  [/salary|compensation|pay expectation|rate/i, /salary|compensation|\$\d/i],
];
export function guard(kit, knownText = '') {
  const known = String(knownText);
  kit.screeningAnswers = (kit.screeningAnswers || []).map((qa) => {
    const rule = PERSONAL.find(([q]) => q.test(String(qa.question)));
    if (rule && !rule[1].test(known)) {
      return { question: qa.question, answer: '[Answer this one yourself: only you know this. Nothing in your resume covers it, so Gemini did not guess.]' };
    }
    return qa;
  });
  // The app adds your signature; drop any sign-off Gemini wrote anyway.
  kit.recruiterEmailBody = String(kit.recruiterEmailBody || '')
    .replace(/\n+\s*(best( regards)?|kind regards|warm regards|regards|sincerely|thanks|thank you|cheers|respectfully)[,!.]?\s*(\n[^\n]{0,60}){0,4}\s*$/i, '')
    .trim();
  return kit;
}

function parseKit(data) {
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error(`Gemini returned no text${cand?.finishReason ? ` (${cand.finishReason})` : data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ''}`);
  try {
    return JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error('Gemini reply was not valid JSON. Try again or pick a different model.');
  }
}
