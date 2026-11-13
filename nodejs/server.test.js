import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createWebhookServer } from './server.js';

const server = createWebhookServer({ token: 'local-test-token' });
const headers = {
  Authorization: 'Bearer local-test-token',
  'Content-Type': 'application/json'
};
let url;

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
});

after(() => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
}));

function post(body, requestHeaders = headers) {
  return fetch(url + '/post', { method: 'POST', headers: requestHeaders, body });
}

test('health and unknown route', async () => {
  assert.deepEqual(await (await fetch(url + '/health')).json(), { status: 'healthy' });
  assert.equal((await fetch(url + '/pre')).status, 404);
});

test('redacts nested phone fields and text, including MCP content', async () => {
  const body = {
    execution_id: 'exec_demo',
    tool: { name: 'ListContacts', toolkit: 'Example', version: '1.0.0' },
    context: { user_id: 'demo-user' },
    success: true,
    output: { contacts: [{ 'Mobile-Phone': 2025550100, fax: null, note: 'Call +1 202 555 0101', id: 42 }] },
    content: [
      { type: 'text', text: 'Call 202-555-0102' },
      { type: 'resource', resource: { uri: 'file:///demo', text: 'Call 202-555-0103' } },
      { type: 'image', mimeType: 'image/png', data: '1234567890' }
    ]
  };
  const response = await post(JSON.stringify(body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    code: 'OK',
    override: {
      output: { contacts: [{ 'Mobile-Phone': '[PHONE REDACTED]', fax: null, note: 'Call [PHONE REDACTED]', id: 42 }] },
      content: [
        { type: 'text', text: 'Call [PHONE REDACTED]' },
        { type: 'resource', resource: { uri: 'file:///demo', text: 'Call [PHONE REDACTED]' } },
        body.content[2]
      ]
    }
  });
});

test('supports absent and null output and preserves falsey scalars', async () => {
  for (const output of [undefined, null, false, 0, '']) {
    const response = await post(JSON.stringify({ output }));
    const expected = output == null ? { code: 'OK' } : { code: 'OK', override: { output } };
    assert.deepEqual(await response.json(), expected);
  }
});

test('rejects unauthorized, malformed, and oversized requests', async () => {
  assert.equal((await post('{}', {})).status, 401);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('null')).status, 400);
  assert.equal((await post(JSON.stringify({ output: 'x'.repeat(1024 * 1024) }))).status, 413);
});
