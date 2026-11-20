import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAI } from '../server/ai.js';

const response = (body) => ({ ok: true, status: 200, json: async () => body });

test('OpenAI and Anthropic adapters list accessible models and return structured results', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === 'https://api.openai.com/v1/models') {
      return response({ data: [{ id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }] });
    }
    if (url === 'https://api.openai.com/v1/chat/completions') {
      return response({ choices: [{ message: { content: '{"title":"Staff Accountant"}' } }] });
    }
    if (String(url).startsWith('https://api.anthropic.com/v1/models')) {
      return response({ data: [{ id: 'claude-3-7-sonnet-latest', display_name: 'Claude Sonnet' }] });
    }
    if (url === 'https://api.anthropic.com/v1/messages') {
      return response({ content: [{ type: 'tool_use', name: 'return_job_matcher_response', input: { title: 'Registered Nurse' } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const schema = { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] };
    const openai = await generateAI({ provider: 'openai', apiKey: 'openai-test-key', prompt: 'Return a job title.', schema });
    const anthropic = await generateAI({ provider: 'anthropic', apiKey: 'anthropic-test-key', prompt: 'Return a job title.', schema });
    assert.deepEqual(openai, { title: 'Staff Accountant', model: 'gpt-4o-mini' });
    assert.deepEqual(anthropic, { title: 'Registered Nurse', model: 'claude-3-7-sonnet-latest' });
    assert.equal(requests[0].options.headers.Authorization, 'Bearer openai-test-key');
    assert.equal(requests[2].options.headers['x-api-key'], 'anthropic-test-key');
    assert.equal(requests[2].options.headers['anthropic-version'], '2023-06-01');
    const openAiBody = JSON.parse(requests[1].options.body);
    assert.equal(openAiBody.response_format.json_schema.schema.type, 'object');
    assert.equal(openAiBody.response_format.json_schema.schema.properties.title.type, 'string');
    assert.equal(requests[3].url, 'https://api.anthropic.com/v1/messages');
  } finally {
    global.fetch = originalFetch;
  }
});
