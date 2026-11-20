import { once } from 'node:events';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../server/app.js';

let server, origin;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('import accepts pasted job details and keeps the original application link', async () => {
  const response = await fetch(`${origin}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Staff Accountant',
      company: 'Community Hospital',
      location: 'Baltimore, MD',
      applyUrl: 'https://careers.example.com/jobs/123',
      description: 'Prepare monthly financial reports, reconcile accounts, support month-end close, and maintain accurate audit documentation. Work with the finance team on budgeting, forecasts, compliance, and reporting improvements.',
    }),
  });
  const { job } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(job.category, 'accounting');
  assert.equal(job.url, 'https://careers.example.com/jobs/123');
  assert.equal(job.applyUrl, job.url);
  assert.equal(job.imported, true);
  assert.equal(job.fullTextLoaded, true);
  assert.match(job.id, /^manual-[a-f0-9]{20}$/);
});

test('import rejects insecure links, incomplete text, and private-network targets', async () => {
  const post = (body) => fetch(`${origin}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const insecure = await post({ url: 'http://example.com/job/1' });
  assert.equal(insecure.status, 400);
  assert.match((await insecure.json()).error, /https:\/\/\./);

  const incomplete = await post({ title: 'Staff Accountant', description: 'Too short.' });
  assert.equal(incomplete.status, 400);

  const privateTarget = await post({ url: 'https://127.0.0.1/' });
  assert.equal(privateTarget.status, 422);
  assert.match((await privateTarget.json()).error, /private address/i);

  const privateIpv6Target = await post({ url: 'https://[fe80::1]/' });
  assert.equal(privateIpv6Target.status, 422);
  assert.match((await privateIpv6Target.json()).error, /private address/i);

  const mappedPrivateTarget = await post({ url: 'https://[::ffff:127.0.0.1]/' });
  assert.equal(mappedPrivateTarget.status, 422);
  assert.match((await mappedPrivateTarget.json()).error, /private address/i);
});

test('AI routes reject unknown providers before attempting provider requests', async () => {
  for (const path of ['/api/models', '/api/plan', '/api/tailor']) {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'unknown' }),
    });
    assert.equal(response.status, 400, path);
    assert.match((await response.json()).error, /Choose Gemini, OpenAI, or Anthropic/);
  }
});
