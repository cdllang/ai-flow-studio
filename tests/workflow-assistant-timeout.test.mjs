import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const freePort = async () => {
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
};

test('workflow intent retries one transient model timeout instead of exposing the raw abort', async () => {
  let calls = 0;
  let mode = 'recover';
  const upstream = http.createServer((_request, response) => {
    calls += 1;
    const reply = () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        status: 'needs_clarification',
        message: '请确认是否保留现有输出',
        contract: {
          objective: '调整工作流', operation: 'adjust', inScope: ['调整节点'], outOfScope: ['自动发布'],
          inputs: [{ name: '输入', type: 'text', required: true }], outputs: [{ name: '输出', type: 'text' }],
          constraints: { allowHttp: false, allowCode: false, maxModelCalls: 2, maxImageCalls: 0 },
          acceptanceCriteria: [], assumptions: [], unresolvedQuestions: ['是否保留现有输出？']
        },
        questions: ['是否保留现有输出？']
      }) } }] }));
    };
    if (mode === 'fail' || calls === 1) {
      const timer = setTimeout(reply, 5_000);
      response.once('close', () => clearTimeout(timer));
    } else reply();
  });
  const upstreamPort = await listen(upstream);
  const gatewayPort = await freePort();
  const gateway = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(gatewayPort),
      NODE_ENV: 'test',
      ALLOW_PRIVATE_MODEL_BASE_URL: 'true',
      // Keep a wide margin for a fresh HTTP connection on loaded Linux CI runners.
      ASSISTANT_MODEL_TIMEOUT_MS: '500',
      ASSISTANT_MODEL_RETRY_DELAY_MS: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let gatewayOutput = '';
  gateway.stdout.on('data', (chunk) => { gatewayOutput += String(chunk); });
  gateway.stderr.on('data', (chunk) => { gatewayOutput += String(chunk); });

  try {
    const origin = `http://127.0.0.1:${gatewayPort}`;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(Date.now() < deadline, `gateway failed to start:\n${gatewayOutput}`);
    const response = await fetch(`${origin}/api/workflow-assistant/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aiflow-api-key': 'timeout-fixture-key' },
      body: JSON.stringify({
        message: '调整工作流但保留现有输出',
        provider: { id: 'fixture-provider', baseUrl: `http://127.0.0.1:${upstreamPort}`, model: 'fixture-model', protocol: 'chat-completions', reasoningEffort: 'high' },
        providers: [{ id: 'fixture-provider', name: 'Fixture', models: [{ id: 'fixture-model', capability: 'chat' }] }],
        currentWorkflowRevision: 'fnv1a:fixture'
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.response.status, 'needs_clarification');
    assert.equal(calls, 2, 'the gateway should retry exactly once after the first timeout');

    mode = 'fail';
    calls = 0;
    const failedResponse = await fetch(`${origin}/api/workflow-assistant/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aiflow-api-key': 'timeout-fixture-key' },
      body: JSON.stringify({
        message: '再次确认边界',
        provider: { id: 'fixture-provider', baseUrl: `http://127.0.0.1:${upstreamPort}`, model: 'fixture-model', protocol: 'chat-completions', reasoningEffort: 'high' },
        providers: [{ id: 'fixture-provider', name: 'Fixture', models: [{ id: 'fixture-model', capability: 'chat' }] }],
        currentWorkflowRevision: 'fnv1a:fixture'
      })
    });
    const failed = await failedResponse.json();
    assert.equal(failedResponse.status, 504);
    assert.equal(failed.code, 'ASSISTANT_MODEL_TIMEOUT');
    assert.match(failed.message, /已自动重试 1 次/);
    assert.doesNotMatch(failed.message, /operation was aborted/i);
    assert.equal(calls, 2);
  } finally {
    gateway.kill('SIGTERM');
    await close(upstream);
  }
});
