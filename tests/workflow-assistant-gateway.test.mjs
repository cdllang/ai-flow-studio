import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { addSessionTurn, createAssistantSession } from '../workflow-assistant-core.mjs';

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

const contract = {
  objective: '生成一份商品文案',
  operation: 'create',
  inScope: ['生成文案'],
  outOfScope: ['自动发布'],
  inputs: [{ name: '商品说明', type: 'text', required: true }],
  outputs: [{ name: '商品文案', type: 'text' }],
  constraints: { allowHttp: false, allowCode: false, maxModelCalls: 2, maxImageCalls: 0 },
  acceptanceCriteria: ['输出一份可复制的商品文案'],
  assumptions: [],
  unresolvedQuestions: []
};

const draft = (providerId = 'provider-main') => ({
  schema: 'aiflow.workflow-draft',
  schemaVersion: 1,
  title: '商品文案生成器',
  plan: {
    schema: 'aiflow.workflow-plan',
    schemaVersion: 1,
    summary: '接收商品说明，生成文案后交付。',
    steps: [
      { id: 'start-1', kind: 'start', title: '开始', purpose: '接收商品说明', inputs: [], outputs: ['商品说明'] },
      { id: 'llm-1', kind: 'llm', title: '生成文案', purpose: '根据商品说明生成文案', inputs: ['商品说明'], outputs: ['商品文案'] },
      { id: 'output-1', kind: 'output', title: '输出', purpose: '交付可复制商品文案', inputs: ['商品文案'], outputs: [] }
    ],
    connections: [
      { id: 'edge-start-llm', source: 'start-1', target: 'llm-1', reason: '传递商品说明', dataType: 'text' },
      { id: 'edge-llm-output', source: 'llm-1', target: 'output-1', reason: '交付生成文案', dataType: 'text' }
    ]
  },
  nodes: [
    { id: 'start-1', type: 'flowNode', position: { x: 80, y: 160 }, data: { kind: 'start', title: '开始', subtitle: '商品说明', status: 'idle' } },
    { id: 'llm-1', type: 'flowNode', position: { x: 360, y: 160 }, data: { kind: 'llm', title: '生成文案', subtitle: 'text-model', status: 'idle', providerId, model: 'text-model', prompt: '根据商品说明生成文案' } },
    { id: 'output-1', type: 'flowNode', position: { x: 640, y: 160 }, data: { kind: 'output', title: '输出', subtitle: '商品文案', status: 'idle' } }
  ],
  edges: []
});

test('workflow assistant auto-applies the system Skill, repairs invalid drafts, isolates Critic, and compresses sessions', async () => {
  const calls = [];
  const upstream = http.createServer(async (request, response) => {
    const body = await readJson(request);
    const system = body.messages?.[0]?.content || body.instructions || '';
    const prompt = body.messages?.at(-1)?.content || body.input || '{}';
    calls.push({ authorization: request.headers.authorization, system, prompt, body });
    let content;
    if (system.includes('Session Memory and Compression')) {
      const payload = JSON.parse(prompt);
      content = JSON.stringify({
        confirmedDecisions: ['保持本地 Session'],
        rejectedAlternatives: [],
        assumptions: [],
        pendingQuestions: [],
        appliedRevisions: [],
        terminology: [],
        sourceTurnIds: payload.sourceTurns.map((turn) => turn.id)
      });
    } else if (system.includes('Independent Workflow Critic')) {
      content = JSON.stringify({ passed: true, issues: [] });
    } else if (system.includes('Repair entrypoint')) {
      content = JSON.stringify({ status: 'draft_ready', message: '修复完成', contract, questions: [], draft: draft() });
    } else if ((() => { try { return JSON.parse(prompt).latestMessage?.includes('clarify'); } catch { return false; } })()) {
      content = JSON.stringify({
        status: 'needs_clarification',
        message: '需要确认输出渠道',
        contract: { ...contract, acceptanceCriteria: [], unresolvedQuestions: ['输出渠道是什么？'] },
        questions: ['输出渠道是什么？']
      });
    } else {
      content = JSON.stringify({ status: 'draft_ready', message: '草案已生成', contract, questions: [], draft: draft('missing-provider') });
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content } }], model: body.model, usage: { total_tokens: 100 } }));
  });

  const upstreamPort = await listen(upstream);
  const gatewayPort = await freePort();
  const gateway = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(gatewayPort), ALLOW_PRIVATE_MODEL_BASE_URL: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let gatewayOutput = '';
  gateway.stdout.on('data', (chunk) => { gatewayOutput += String(chunk); });
  gateway.stderr.on('data', (chunk) => { gatewayOutput += String(chunk); });

  try {
    const origin = `http://127.0.0.1:${gatewayPort}`;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(Date.now() < deadline, `gateway failed to start:\n${gatewayOutput}`);
    const baseUrl = `http://127.0.0.1:${upstreamPort}/v1`;
    const request = (message, session, confirmation = null) => fetch(`${origin}/api/workflow-assistant/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AIFlow-API-Key': 'builder-test-key' },
      body: JSON.stringify({
        message,
        session,
        provider: { id: 'provider-main', baseUrl, model: 'text-model', protocol: 'chat-completions', reasoningEffort: 'high', contextWindow: 128_000 },
        providers: [{ id: 'provider-main', name: 'Main', models: [{ id: 'text-model', capability: 'chat' }] }],
        permissions: { allowHttp: false, allowCode: false, maxModelCalls: 2, maxImageCalls: 0 },
        currentWorkflowRevision: 'wf_test',
        confirmation
      })
    });

    const clarificationResponse = await request('clarify this request', null);
    assert.equal(clarificationResponse.status, 200);
    const clarification = await clarificationResponse.json();
    assert.equal(clarification.response.status, 'needs_clarification');
    assert.equal(clarification.response.questions.length, 1);
    assert.match(clarification.response.questions[0], /请确认输入与输出/);
    assert.doesNotMatch(clarification.response.questions[0], /输出渠道/);
    assert.deepEqual(clarification.systemSkill, { id: 'guard-workflow-intent', version: '1.0.0', autoApplied: true });
    assert.equal(clarification.session.phase, 'discovery');

    const draftResponse = await request('输入与输出符合要求', clarification.session, { answer: 'yes', question: clarification.response.questions[0] });
    assert.equal(draftResponse.status, 200);
    const generated = await draftResponse.json();
    assert.equal(generated.response.status, 'draft_ready');
    assert.equal(generated.response.validation.valid, true);
    assert.equal(generated.response.validation.repairAttempt, 1);
    assert.equal(generated.session.phase, 'awaiting_confirmation');
    assert.ok(generated.session.confirmedInputOutputSignature);
    assert.deepEqual(generated.response.draft.edges.map(({ source, target }) => [source, target]), [['start-1', 'llm-1'], ['llm-1', 'output-1']]);
    assert.equal(generated.stages.some((stage) => stage.stage === 'repair' && stage.status === 'success'), true);
    assert.equal(generated.stages.some((stage) => stage.stage === 'critic' && stage.status === 'success'), true);

    let longSession = createAssistantSession({ providerId: 'provider-main', modelId: 'text-model' });
    for (let index = 0; index < 14; index += 1) longSession = addSessionTurn(longSession, index % 2 ? 'assistant' : 'user', `history ${index}`);
    const compressedResponse = await request('compressed clarify', longSession);
    assert.equal(compressedResponse.status, 200);
    const compressed = await compressedResponse.json();
    assert.equal(compressed.compression.compressed, true);
    assert.equal(compressed.session.recentTurns.length, 7);
    assert.equal(compressed.session.summary.sourceTurnIds.length, 9);

    assert.equal(calls.every((call) => call.authorization === 'Bearer builder-test-key'), true);
    assert.equal(calls.some((call) => call.system.includes('Guard Workflow Intent')), true);
    assert.equal(calls.some((call) => call.system.includes('Independent Workflow Critic') && !call.system.includes('Builder entrypoint')), true);
    assert.equal(calls.some((call) => call.system.includes('Session Memory and Compression')), true);
    assert.equal(calls.some((call) => call.prompt.includes('builder-test-key')), false);

    const publicSkills = await fetch(`${origin}/api/skills`).then((response) => response.json());
    assert.deepEqual(publicSkills.skills.map((skill) => skill.id), ['gpt-image-2']);
  } finally {
    gateway.kill('SIGTERM');
    await close(upstream);
  }
});
