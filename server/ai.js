import { buildPrompt, generate as generateGemini, guard, listModels as listGeminiModels, SCHEMA } from './gemini.js';

export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic'];

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};
const BUSY = (status) => status === 429 || status >= 500;
const cache = new Map();
const providerOrder = {
  openai: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o'],
  anthropic: ['claude-sonnet-4-0', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
};

function assertProvider(provider) {
  if (!AI_PROVIDERS.includes(provider)) throw new Error('Choose Gemini, OpenAI, or Anthropic.');
}

function requestHeaders(provider, apiKey) {
  if (provider === 'openai') return { Authorization: `Bearer ${apiKey}` };
  if (provider === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  throw new Error('Unsupported AI provider.');
}

async function request(provider, apiKey, path, body) {
  const res = await fetch(`${ENDPOINTS[provider]}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...requestHeaders(provider, apiKey), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.message || `${provider} returned HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

function normalizedSchema(input) {
  if (Array.isArray(input)) return input.map(normalizedSchema);
  if (!input || typeof input !== 'object') return input;
  const types = { OBJECT: 'object', ARRAY: 'array', STRING: 'string', INTEGER: 'integer', NUMBER: 'number', BOOLEAN: 'boolean' };
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'type') out.type = types[value] || String(value).toLowerCase();
    else if (value && typeof value === 'object') out[key] = normalizedSchema(value);
    else out[key] = value;
  }
  if (out.type === 'object') {
    out.additionalProperties = false;
    if (!out.required) out.required = Object.keys(out.properties || {});
  }
  return out;
}

const modelId = (model) => model.id || model.name || '';
const preferredModels = (provider, models) => {
  const sorted = [...models].sort((a, b) => {
    const aId = modelId(a), bId = modelId(b);
    const aRank = providerOrder[provider].indexOf(aId);
    const bRank = providerOrder[provider].indexOf(bId);
    return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank);
  });
  return sorted.map((m) => ({ id: modelId(m), label: m.display_name || m.displayName || modelId(m) }));
};

export async function listModels(provider, apiKey) {
  assertProvider(provider);
  if (!apiKey) throw new Error('Add an API key in Settings before checking models.');
  if (provider === 'gemini') {
    const models = await listGeminiModels(apiKey);
    if (!models.length) throw new Error('No supported Gemini text models are available for this key.');
    return models;
  }

  const data = provider === 'openai'
    ? await request(provider, apiKey, '/models')
    : await request(provider, apiKey, '/models?limit=1000');
  const models = (data.data || []).filter((model) => {
    const id = modelId(model);
    if (provider === 'openai') return /^(gpt-|o[134])/i.test(id) && !/(audio|transcri|tts|realtime|image|embedding|moderation|search)/i.test(id);
    return /^claude-/i.test(id);
  });
  const result = preferredModels(provider, models);
  if (!result.length) throw new Error(`No supported ${provider} text models are available for this key.`);
  return result;
}

async function availableModels(provider, apiKey) {
  const key = `${provider}:${apiKey}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 3600000) return cached.models;
  const models = await listModels(provider, apiKey);
  if (!models.length) throw new Error(`No supported ${provider} text models are available for this key.`);
  cache.set(key, { at: Date.now(), models });
  return models;
}

async function generateWith(provider, apiKey, model, prompt, schema, temperature) {
  const normalized = normalizedSchema(schema);
  const body = provider === 'openai'
    ? {
      model, messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'job_matcher_response', strict: true, schema: normalized } },
      ...(/^(gpt-5|o[134])/i.test(model) ? {} : { temperature }),
    }
    : {
      model, max_tokens: 8192, temperature,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name: 'return_job_matcher_response', description: 'Return the requested structured response.', input_schema: normalized }],
      tool_choice: { type: 'tool', name: 'return_job_matcher_response' },
    };
  const data = await request(provider, apiKey, provider === 'openai' ? '/chat/completions' : '/messages', body);
  let value;
  if (provider === 'openai') {
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('The model returned no structured response.');
    value = JSON.parse(text);
  } else {
    value = data.content?.find((part) => part.type === 'tool_use')?.input;
    if (!value) throw new Error('The model returned no structured response.');
  }
  return value;
}

export async function generateAI({ provider = 'gemini', apiKey, model = 'auto', prompt, schema, temperature = 0.5, post = (value) => value, label = 'AI' }) {
  assertProvider(provider);
  if (provider === 'gemini') return generateGemini({ apiKey, model, prompt, schema, temperature, post, label });
  if (!apiKey) throw new Error('Add an API key for the selected provider in Settings.');

  const models = await availableModels(provider, apiKey);
  const ids = models.map((item) => item.id);
  const order = [...new Set([model && model !== 'auto' ? model : ids[0], ...ids])].slice(0, 4);
  let lastError;
  for (const candidate of order) {
    try {
      const result = post(await generateWith(provider, apiKey, candidate, prompt, schema, temperature));
      return { ...result, model: candidate };
    } catch (error) {
      lastError = error;
      if (!BUSY(error.status) && error.status !== 404) throw error;
    }
  }
  throw lastError || new Error(`No ${provider} model could complete the request.`);
}

export function tailorAI({ provider = 'gemini', apiKey, model, resumeText, job, notes, tone }) {
  return generateAI({
    provider, apiKey, model, label: 'tailor', schema: SCHEMA, temperature: 0.5,
    prompt: buildPrompt({ resumeText, job, notes, tone }),
    post: (kit) => guard(kit, `${resumeText}\n${notes || ''}`),
  });
}

export { normalizedSchema };
