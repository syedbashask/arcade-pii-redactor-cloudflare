import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const mask = '[PHONE REDACTED]';
const maxBodyBytes = 1024 * 1024;
const phoneFields = new Set([
  'phone', 'phonenumber', 'telephone', 'mobile', 'mobilephone',
  'homephone', 'otherphone', 'businessphone', 'workphone', 'fax'
]);

function redactText(text) {
  return text.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, candidate => {
    const digits = candidate.replace(/\D/g, '').length;
    return digits >= 8 && digits <= 15 ? mask : candidate;
  });
}

function redactOutput(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactOutput);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.toLowerCase().replace(/[_\-\s]/g, '');
    return [key, item !== null && phoneFields.has(normalized) ? mask : redactOutput(item)];
  }));
}

function redactBlock(block) {
  if (block?.type === 'text' && typeof block.text === 'string') {
    return { ...block, text: redactText(block.text) };
  }
  if (block?.type === 'resource' && typeof block.resource?.text === 'string') {
    return { ...block, resource: { ...block.resource, text: redactText(block.resource.text) } };
  }
  return block;
}

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(data));
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export function createWebhookServer({ token = '' } = {}) {
  const expectedAuth = token ? digest('Bearer ' + token) : null;

  return createServer(async (request, response) => {
    const path = request.url?.split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      return sendJson(response, 200, { status: 'healthy' });
    }
    if (request.method !== 'POST' || path !== '/post') {
      return sendJson(response, 404, { error: 'Not Found' });
    }
    if (expectedAuth && !timingSafeEqual(expectedAuth, digest(request.headers.authorization ?? ''))) {
      return sendJson(response, 401, { error: 'Unauthorized' }, {
        'WWW-Authenticate': 'Bearer',
        Connection: 'close'
      });
    }

    let body;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) {
          return sendJson(response, 413, { error: 'Request body exceeds 1 MiB' }, { Connection: 'close' });
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(response, 400, { error: 'Expected a JSON object' });
      }
    } catch {
      if (!response.destroyed) sendJson(response, 400, { error: 'Invalid JSON request' });
      return;
    }

    try {
      const override = {};
      if (body.output != null) override.output = redactOutput(body.output);
      if (Array.isArray(body.content)) override.content = body.content.map(redactBlock);

      const result = { code: 'OK' };
      if (Object.keys(override).length) result.override = override;
      return sendJson(response, 200, result);
    } catch {
      return sendJson(response, 500, {
        code: 'CHECK_FAILED',
        error_message: 'Unable to process post-execution output'
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || '3000');
  const token = process.env.ARCADE_WEBHOOK_TOKEN || '';

  if (!token && !['127.0.0.1', '::1'].includes(host)) {
    throw new Error('Set ARCADE_WEBHOOK_TOKEN when listening on a non-loopback address');
  }

  const server = createWebhookServer({ token });
  server.listen(port, host, () => {
    console.log('Arcade PII Redactor listening on %s port %d', host, server.address().port);
  });
}
