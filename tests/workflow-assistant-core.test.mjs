import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadWorkflowAssistantSkill } from '../system-skill-loader.mjs';
import {
  addSessionTurn,
  applySessionCompression,
  createAssistantSession,
  extractJsonObject,
  normalizeAssistantEnvelope,
  normalizeTaskContract,
  shouldCompressSession,
  taskContractReady,
  validateWorkflowDraft,
  validationReport
} from '../workflow-assistant-core.mjs';

const providers = [{
  id: 'provider-main',
  name: 'Main provider',
  models: [
    { id: 'text-model', capability: 'chat' },
    { id: 'image-model', capability: 'image' }
  ]
}];

const contract = normalizeTaskContract({
  objective: '生成商品图和文案',
  operation: 'create',
  inScope: ['生成'],
  outOfScope: ['自动发布'],
  inputs: [{ name: '商品说明', type: 'text', required: true }],
  outputs: [{ name: '文案', type: 'text' }, { name: '图片', type: 'image', count: 2 }],
  constraints: { allowHttp: false, allowCode: false, maxModelCalls: 2, maxImageCalls: 2 },
  acceptanceCriteria: ['输出两张图片和一份文案'],
  unresolvedQuestions: []
});

const validDraft = () => ({
  schema: 'aiflow.workflow-draft',
  schemaVersion: 1,
  title: '商品内容生成',
  nodes: [
    { id: 'start-1', type: 'flowNode', position: { x: 80, y: 160 }, data: { kind: 'start', title: '开始', subtitle: '商品说明', status: 'idle' } },
    { id: 'llm-1', type: 'flowNode', position: { x: 360, y: 160 }, data: { kind: 'llm', title: '生成文案', subtitle: 'text-model', status: 'idle', providerId: 'provider-main', model: 'text-model', prompt: '生成商品文案' } },
    { id: 'image-1', type: 'flowNode', position: { x: 640, y: 160 }, data: { kind: 'image', title: '生成图片', subtitle: 'image-model', status: 'idle', providerId: 'provider-main', model: 'image-model', imageCount: 2 } },
    { id: 'output-1', type: 'flowNode', position: { x: 920, y: 160 }, data: { kind: 'output', title: '输出', subtitle: '图片和文案', status: 'idle' } }
  ],
  edges: [
    { id: 'edge-start-llm', source: 'start-1', target: 'llm-1' },
    { id: 'edge-llm-image', source: 'llm-1', target: 'image-1' },
    { id: 'edge-image-output', source: 'image-1', target: 'output-1' }
  ]
});

test('task contract blocks drafting until objective, boundaries, inputs, outputs and acceptance criteria are complete', () => {
  assert.equal(taskContractReady(contract), true);
  assert.equal(taskContractReady({ ...contract, acceptanceCriteria: [] }), false);
  assert.equal(taskContractReady({ ...contract, unresolvedQuestions: ['还缺目标平台'] }), false);
});

test('assistant envelope accepts clarification or draft and rejects ambiguous model output', () => {
  const clarification = normalizeAssistantEnvelope({ status: 'needs_clarification', message: '需要补充', contract, questions: ['生成几张？'] });
  assert.equal(clarification.questions.length, 1);
  const draft = normalizeAssistantEnvelope(extractJsonObject(`\`\`\`json\n${JSON.stringify({ status: 'draft_ready', message: 'ready', contract, questions: [], draft: validDraft() })}\n\`\`\``));
  assert.equal(draft.draft.schema, 'aiflow.workflow-draft');
  assert.throws(() => normalizeAssistantEnvelope({ status: 'needs_clarification', message: 'missing questions', contract, questions: [] }), /questions/);
});

test('session compression triggers after 12 turns and preserves the latest six turns verbatim', () => {
  let session = createAssistantSession({ providerId: 'provider-main', modelId: 'text-model' });
  for (let index = 0; index < 14; index += 1) session = addSessionTurn(session, index % 2 ? 'assistant' : 'user', `turn ${index}`);
  assert.equal(shouldCompressSession(session, session, 128_000).shouldCompress, true);
  const source = session.recentTurns.slice(0, -6);
  const compressed = applySessionCompression(session, {
    confirmedDecisions: ['保持现有边界'],
    rejectedAlternatives: [],
    assumptions: [],
    pendingQuestions: [],
    appliedRevisions: [],
    terminology: [],
    sourceTurnIds: source.map((turn) => turn.id)
  }, source.map((turn) => turn.id));
  assert.equal(compressed.recentTurns.length, 6);
  assert.deepEqual(compressed.recentTurns.map((turn) => turn.content), session.recentTurns.slice(-6).map((turn) => turn.content));
  assert.throws(() => applySessionCompression(session, { sourceTurnIds: [session.recentTurns.at(-1).id] }, [session.recentTurns.at(-1).id]), /most recent six/);
});

test('deterministic validator accepts a catalog-bound safe DAG and reports critic warnings separately', () => {
  const deterministic = validateWorkflowDraft(validDraft(), { providers, constraints: contract.constraints });
  assert.deepEqual(deterministic, { valid: true, issues: [] });
  const report = validationReport(deterministic, [{ severity: 'warning', code: 'COPY_TONE', message: '语气仍可更明确', nodeId: 'llm-1', evidence: 'acceptance criteria' }], 0);
  assert.equal(report.valid, true);
  assert.equal(report.criticPassed, true);
  assert.equal(report.issues[0].source, 'critic');
});

test('deterministic validator rejects unsafe nodes, invalid providers, budgets, cycles and secrets', () => {
  const draft = validDraft();
  draft.nodes[1].data.providerId = 'missing-provider';
  draft.nodes[1].data.prompt = `Use ${'sk-'}${'1234567890abcdefghijklmnop'}`;
  draft.nodes.splice(2, 0, { id: 'http-1', type: 'flowNode', position: { x: 500, y: 300 }, data: { kind: 'http', title: '发布', subtitle: '外部接口', status: 'idle' } });
  draft.edges.push({ id: 'edge-cycle', source: 'output-1', target: 'llm-1' });
  const result = validateWorkflowDraft(draft, { providers, constraints: { ...contract.constraints, maxModelCalls: 0 } });
  assert.equal(result.valid, false);
  const codes = new Set(result.issues.map((entry) => entry.code));
  ['PROVIDER_NOT_FOUND', 'HTTP_NOT_AUTHORIZED', 'MODEL_CALL_BUDGET_EXCEEDED', 'CYCLE_DETECTED', 'SECRET_DETECTED'].forEach((code) => assert.equal(codes.has(code), true, code));
});

test('deterministic validator rejects stale graph shapes that could silently drop branches', () => {
  const draft = validDraft();
  draft.nodes[1].data = { kind: 'condition', title: '判断渠道', subtitle: '仅连接真分支', status: 'idle', conditionOperator: 'contains' };
  draft.edges[1].sourceHandle = 'true';
  draft.nodes.push({ id: 'unused-1', type: 'flowNode', position: { x: 640, y: 360 }, data: { kind: 'aggregate', title: '未使用聚合', subtitle: '不可达', status: 'idle' } });
  draft.edges.push({ id: 'edge-output-unused', source: 'output-1', target: 'unused-1' });
  const result = validateWorkflowDraft(draft, { providers, constraints: contract.constraints });
  const codes = new Set(result.issues.map((entry) => entry.code));
  assert.equal(codes.has('CONDITION_BRANCH_INCOMPLETE'), true);
  assert.equal(codes.has('OUTPUT_HAS_OUTGOING'), true);
});

test('system workflow Skill is loaded from the private system-skills tree', () => {
  const skill = loadWorkflowAssistantSkill(path.resolve('system-skills'));
  assert.equal(skill.id, 'guard-workflow-intent');
  assert.match(skill.builder, /strict task contract/i);
  assert.match(skill.critic, /isolated model call/i);
  assert.match(skill.memory, /70%/);
});
