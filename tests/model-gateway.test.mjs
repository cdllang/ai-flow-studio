import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};
const freePort = async () => {
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
};

test('gateway forwards chat and image requests to separate browser-selected suppliers', async () => {
  const chatReceived = [];
  const imageReceived = [];
  const chatUpstream = http.createServer(async (request, response) => {
    const body = await readJson(request);
    chatReceived.push({ url: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/chat-provider/v1/chat/completions') {
      response.end(JSON.stringify({ choices: [{ message: { content: 'custom chat ok' } }], model: body.model }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  const imageUpstream = http.createServer(async (request, response) => {
    const body = await readJson(request);
    imageReceived.push({ url: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/image-provider/v1/images/generations') {
      response.end(JSON.stringify({ data: [{ url: 'https://cdn.example.com/custom.png' }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  const chatUpstreamPort = await listen(chatUpstream);
  const imageUpstreamPort = await listen(imageUpstream);
  const gatewayPort = await freePort();
  const gateway = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(gatewayPort), ALLOW_PRIVATE_MODEL_BASE_URL: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  gateway.stdout.on('data', (chunk) => { output += String(chunk); });
  gateway.stderr.on('data', (chunk) => { output += String(chunk); });

  try {
    const origin = `http://127.0.0.1:${gatewayPort}`;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(Date.now() < deadline, `gateway failed to start:\n${output}`);
    const chatBaseUrl = `http://127.0.0.1:${chatUpstreamPort}/chat-provider/v1`;
    const imageBaseUrl = `http://127.0.0.1:${imageUpstreamPort}/image-provider/v1`;

    const chat = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AIFlow-API-Key': 'test-chat-key' },
      body: JSON.stringify({ prompt: 'hello', baseUrl: chatBaseUrl, model: 'merchant-chat-v2' })
    });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).model, 'merchant-chat-v2');

    const image = await fetch(`${origin}/api/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AIFlow-API-Key': 'test-image-key' },
      body: JSON.stringify({ prompt: 'product hero', baseUrl: imageBaseUrl, model: 'merchant-image-v3', count: 1 })
    });
    assert.equal(image.status, 200);
    assert.equal((await image.json()).model, 'merchant-image-v3');

    assert.deepEqual(chatReceived.map((item) => [item.url, item.body.model]), [
      ['/chat-provider/v1/chat/completions', 'merchant-chat-v2']
    ]);
    assert.deepEqual(imageReceived.map((item) => [item.url, item.body.model]), [
      ['/image-provider/v1/images/generations', 'merchant-image-v3']
    ]);

    const invalid = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AIFlow-API-Key': 'test-chat-key' },
      body: JSON.stringify({ prompt: 'hello', baseUrl: 'file:///tmp/model', model: 'chat' })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'MODEL_CONFIG_INVALID');
  } finally {
    gateway.kill('SIGTERM');
    await close(chatUpstream);
    await close(imageUpstream);
  }
});
