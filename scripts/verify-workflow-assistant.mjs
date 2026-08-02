import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const probe = net.createServer();
const port = await listen(probe);
await close(probe);

const screenshotDir = path.resolve(process.env.VERIFY_SCREENSHOT_DIR || '.verification');
fs.mkdirSync(screenshotDir, { recursive: true });
const staticDir = path.resolve(process.env.VERIFY_STATIC_DIR || 'dist');
const gateway = spawn(process.execPath, ['server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', STATIC_DIR: staticDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
let gatewayOutput = '';
gateway.stdout.on('data', (chunk) => { gatewayOutput += String(chunk); });
gateway.stderr.on('data', (chunk) => { gatewayOutput += String(chunk); });

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(5_000);
const consoleProblems = [];
const pageErrors = [];
const requests = [];
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', (error) => pageErrors.push(error.message));
page.addInitScript(() => {
  localStorage.setItem('aiflow.demo.providers', JSON.stringify({ schemaVersion: 1, providers: [{
    id: 'assistant-provider',
    name: 'AI 构建模型',
    baseUrl: 'https://assistant.example.com/v1',
    apiKey: 'assistant-browser-key',
    models: [{ id: 'workflow-builder', capability: 'chat', protocol: 'responses' }]
  }] }));
  localStorage.setItem('aiflow.demo.workflow', JSON.stringify({
    title: '原工作流',
    input: '商品说明',
    nodes: [
      { id: 'start-old', type: 'flowNode', position: { x: 80, y: 180 }, data: { kind: 'start', title: '旧开始', subtitle: '输入', status: 'idle' } },
      { id: 'llm-old', type: 'flowNode', position: { x: 400, y: 180 }, data: { kind: 'llm', title: '旧模型', subtitle: 'workflow-builder', status: 'idle', providerId: 'assistant-provider', model: 'workflow-builder', prompt: '旧提示词' } },
      { id: 'output-old', type: 'flowNode', position: { x: 720, y: 180 }, data: { kind: 'output', title: '旧输出', subtitle: '结果', status: 'idle' } }
    ],
    edges: [{ id: 'edge-old-1', source: 'start-old', target: 'llm-old' }, { id: 'edge-old-2', source: 'llm-old', target: 'output-old' }]
  }));
});

const contract = {
  objective: '生成商品文案并保留独立输出', operation: 'adjust', inScope: ['替换旧文案节点'], outOfScope: ['自动发布'],
  inputs: [{ name: '商品说明', type: 'text', required: true }], outputs: [{ name: '商品文案', type: 'text' }],
  constraints: { allowHttp: false, allowCode: false, maxModelCalls: 2, maxImageCalls: 0 },
  acceptanceCriteria: ['输出一份可复制商品文案'], assumptions: [], unresolvedQuestions: []
};
const candidateDraft = {
  schema: 'aiflow.workflow-draft', schemaVersion: 1, title: 'AI 商品文案工作流',
  plan: {
    schema: 'aiflow.workflow-plan', schemaVersion: 1, summary: '接收商品说明，生成卖点文案，整理后提供可复制输出。',
    steps: [
      { id: 'start-ai', kind: 'start', title: '商品需求', purpose: '接收商品说明', inputs: [], outputs: ['商品说明'] },
      { id: 'llm-ai', kind: 'llm', title: '生成卖点', purpose: '提取商品卖点并生成文案', inputs: ['商品说明'], outputs: ['商品文案'] },
      { id: 'aggregate-ai', kind: 'aggregate', title: '整理结果', purpose: '整理生成结果并保留稳定结构', inputs: ['商品文案'], outputs: ['结构化文案'] },
      { id: 'output-ai', kind: 'output', title: '文案输出', purpose: '提供可复制的最终文案', inputs: ['结构化文案'], outputs: [] }
    ],
    connections: [
      { id: 'edge-ai-1', source: 'start-ai', target: 'llm-ai', reason: '传递商品说明', dataType: 'text' },
      { id: 'edge-ai-2', source: 'llm-ai', target: 'aggregate-ai', reason: '传递生成文案', dataType: 'text' },
      { id: 'edge-ai-3', source: 'aggregate-ai', target: 'output-ai', reason: '交付整理后的文案', dataType: 'json' }
    ]
  },
  nodes: [
    { id: 'start-ai', type: 'flowNode', position: { x: 60, y: 200 }, data: { kind: 'start', title: '商品需求', subtitle: '输入商品说明', status: 'idle' } },
    { id: 'llm-ai', type: 'flowNode', position: { x: 340, y: 200 }, data: { kind: 'llm', title: '生成卖点', subtitle: 'workflow-builder', status: 'idle', providerId: 'assistant-provider', model: 'workflow-builder', reasoningEffort: 'high', skillIds: [], prompt: '提取商品卖点并生成文案' } },
    { id: 'aggregate-ai', type: 'flowNode', position: { x: 620, y: 200 }, data: { kind: 'aggregate', title: '整理结果', subtitle: '变量聚合', status: 'idle', aggregateStrategy: 'object' } },
    { id: 'output-ai', type: 'flowNode', position: { x: 900, y: 200 }, data: { kind: 'output', title: '文案输出', subtitle: '可复制结果', status: 'idle' } }
  ],
  edges: [
    { id: 'edge-ai-1', source: 'start-ai', target: 'llm-ai' },
    { id: 'edge-ai-2', source: 'llm-ai', target: 'aggregate-ai' },
    { id: 'edge-ai-3', source: 'aggregate-ai', target: 'output-ai' }
  ]
};
const revisedCandidateDraft = {
  ...candidateDraft,
  title: 'AI 商品文案工作流 v2',
  plan: { ...candidateDraft.plan, summary: '接收商品说明，生成更精简的卖点文案，整理后提供可复制输出。' }
};

await page.route('**/api/workflow-assistant/turn', async (route) => {
  const request = route.request().postDataJSON();
  requests.push({ body: request, headers: route.request().headers() });
  const turnIndex = requests.length;
  const now = new Date().toISOString();
  const baseSession = request.session;
  const userTurn = { id: `turn-user-${turnIndex}`, role: 'user', content: request.message, createdAt: now };
  if (turnIndex === 1) {
    const session = { ...baseSession, phase: 'drafting', recentTurns: [...baseSession.recentTurns, userTurn], currentWorkflowRevision: request.currentWorkflowRevision, updatedAt: now };
    return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ code: 'ASSISTANT_MODEL_TIMEOUT', message: '上游模型响应超时，已自动重试 1 次；请稍后重试或切换模型', session, stages: [{ stage: 'intent', status: 'running', detail: '系统 Skill 正在确认目标、边界与验收标准' }], requestId: 'req-timeout-1' }) });
  }
  if (turnIndex === 2) {
    const question = '请确认输入与输出：输入为「商品说明（文本，必填）」；输出为「商品文案（文本）」。是否符合你的要求？';
    const responseContract = { ...contract, acceptanceCriteria: [], unresolvedQuestions: [question] };
    const assistantTurn = { id: 'turn-assistant-1', role: 'assistant', content: `请确认识别出的输入与输出。\n${question}`, createdAt: now, status: 'needs_clarification' };
    const session = { ...baseSession, phase: 'discovery', contract: responseContract, recentTurns: [...baseSession.recentTurns, userTurn, assistantTurn], currentWorkflowRevision: request.currentWorkflowRevision, updatedAt: now };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, response: { status: 'needs_clarification', message: '请确认识别出的输入与输出。', contract: responseContract, questions: [question] }, session, stages: [{ stage: 'intent', status: 'success', detail: '等待确认输入与输出' }], compression: { attempted: false, compressed: false, estimatedTokens: 1200, threshold: 89600 }, systemSkill: { id: 'guard-workflow-intent', version: '1.0.0', autoApplied: true }, requestId: 'req-assistant-1' }) });
  }
  if (turnIndex === 3) {
    const question = '请确认输入与输出：输入为「商品说明（文本，必填）」；输出为「保留稳定结构的商品文案（文本）」。是否符合你的要求？';
    const responseContract = { ...contract, outputs: [{ name: '保留稳定结构的商品文案', type: 'text' }], unresolvedQuestions: [question] };
    const assistantTurn = { id: 'turn-assistant-io-revised', role: 'assistant', content: `已根据补充重新识别输入与输出。\n${question}`, createdAt: now, status: 'needs_clarification' };
    const session = { ...baseSession, phase: 'discovery', contract: responseContract, recentTurns: [...baseSession.recentTurns, userTurn, assistantTurn], currentWorkflowRevision: request.currentWorkflowRevision, updatedAt: now };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, response: { status: 'needs_clarification', message: '已重新识别输入与输出。', contract: responseContract, questions: [question] }, session, stages: [{ stage: 'intent', status: 'success', detail: '等待确认更新后的输入与输出' }], compression: { attempted: false, compressed: false, estimatedTokens: 1400, threshold: 89600 }, systemSkill: { id: 'guard-workflow-intent', version: '1.0.0', autoApplied: true }, requestId: 'req-assistant-io-revised' }) });
  }
  if (turnIndex === 5) await new Promise((resolve) => setTimeout(resolve, 1_200));
  const responseDraft = turnIndex === 5 ? revisedCandidateDraft : candidateDraft;
  const validation = { valid: true, deterministicPassed: true, criticPassed: true, repairAttempt: 1, issues: [{ source: 'critic', severity: 'warning', code: 'COPY_TONE', message: '建议运行前确认品牌语气', nodeId: 'llm-ai' }] };
  const assistantTurn = { id: 'turn-assistant-2', role: 'assistant', content: '草案已经通过结构校验和独立 Critic，等待确认应用。', createdAt: now, status: 'draft_ready' };
  const session = { ...baseSession, phase: 'awaiting_confirmation', contract, confirmedInputOutputSignature: 'io-confirmed-test', recentTurns: [...baseSession.recentTurns, userTurn, assistantTurn], currentWorkflowRevision: request.currentWorkflowRevision, candidateDraft: responseDraft, validation, repairAttempt: 1, updatedAt: now };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, response: { status: 'draft_ready', message: assistantTurn.content, contract, questions: [], draft: responseDraft, validation }, session, stages: [{ stage: 'intent', status: 'success', detail: '输入与输出已经确认' }, { stage: 'deterministic_validation', status: 'success', detail: '确定性检查全部通过' }, { stage: 'critic', status: 'success', detail: '语义覆盖检查通过' }, { stage: 'repair', status: 'success', detail: '第 1 轮修复完成' }], compression: { attempted: true, compressed: true, estimatedTokens: 91000, threshold: 89600, sourceTurns: 8, retainedTurns: 6 }, systemSkill: { id: 'guard-workflow-intent', version: '1.0.0', autoApplied: true }, requestId: 'req-assistant-2' }) });
});

try {
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (Date.now() >= deadline) throw new Error(`gateway failed to start:\n${gatewayOutput}`);

  await page.goto(origin, { waitUntil: 'networkidle' });
  const originalNodeCount = await page.locator('.flow-node').count();
  await page.getByRole('button', { name: 'AI 构建', exact: true }).click();
  const panelVisible = await page.getByRole('dialog', { name: 'AI 工作流构建 Session' }).isVisible();
  const systemSkillLocked = await page.getByText('guard-workflow-intent').isVisible() && await page.getByText('系统级自动调用 · 用户不可关闭').isVisible();
  const criticDefaultsIsolated = await page.getByRole('combobox', { name: 'AI Critic 模型' }).inputValue() === 'same';

  const composer = page.getByRole('textbox', { name: 'AI 工作流需求' });
  await composer.fill('请调整当前工作流');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').getByText(/上游模型响应超时，已自动重试 1 次/).waitFor();
  const timeoutStopsSpinner = await page.locator('.assistant-stages .spin').count() === 0
    && await page.getByRole('button', { name: '重新尝试' }).isVisible()
    && await page.getByRole('button', { name: '切换模型' }).isVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'workflow-assistant-timeout-state.png'), fullPage: true });
  await page.getByRole('button', { name: '重新尝试' }).click();
  await page.getByText(/请确认输入与输出：输入为/).last().waitFor();
  const asksBeforeDrafting = await page.getByText('待确认输入输出').isVisible();
  const structuredConfirmationVisible = await page.getByRole('button', { name: '是', exact: true }).isVisible()
    && await page.getByRole('button', { name: '否', exact: true }).isVisible()
    && await page.getByRole('button', { name: '其他', exact: true }).isVisible();
  const canvasUntouchedBeforeConfirmation = await page.locator('.flow-node').count() === originalNodeCount;

  await page.getByRole('button', { name: '其他', exact: true }).click();
  await page.getByRole('textbox', { name: '其他确认内容' }).fill('保留可复制输出，但可以替换旧节点');
  await page.screenshot({ path: path.join(screenshotDir, 'workflow-assistant-confirmation.png'), fullPage: true });
  await page.getByRole('button', { name: '提交补充' }).click();
  await page.getByText(/保留稳定结构的商品文案/).last().waitFor();
  await page.getByRole('button', { name: '是', exact: true }).click();
  await page.getByText('草案已通过严格校验').waitFor();
  const strictStagesVisible = await page.getByText('确定性校验', { exact: true }).isVisible() && await page.getByText('独立 Critic', { exact: true }).isVisible();
  const planPreviewVisible = await page.getByRole('region', { name: 'AI 流程方案预览' }).isVisible()
    && await page.getByLabel('工作流流程图').isVisible()
    && await page.getByText('流程图是节点与连线的唯一来源').isVisible()
    && await page.getByText('传递生成文案 · text').isVisible();
  const compressionVisible = await page.getByText(/已自动压缩 8 条较早消息/).isVisible();
  const canvasStillUntouched = await page.locator('.flow-node').count() === originalNodeCount;
  await page.screenshot({ path: path.join(screenshotDir, 'workflow-assistant-session-ready.png'), fullPage: true });

  const composerAfterDraft = page.getByRole('textbox', { name: 'AI 工作流需求' });
  await composerAfterDraft.fill('将生成卖点调整为更精简的表达');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('正在生成新版流程方案').waitFor();
  await page.screenshot({ path: path.join(screenshotDir, 'workflow-assistant-adjustment-pending.png'), fullPage: true });
  const previousDraftLockedDuringAdjustment = await page.getByRole('button', { name: '确认并应用' }).count() === 0
    && await page.getByText('上一版已锁定，等待本轮校验链完成').isVisible()
    && await page.getByText('草案已通过严格校验').count() === 0;
  await page.getByText('AI 商品文案工作流 v2').waitFor();

  await page.getByText('变量聚合', { exact: true }).click();
  const confirmButton = page.locator('.assistant-plan-actions button.primary');
  const staleWarning = page.getByText(/画布已更新，此草案不能覆盖最新修改/);
  await staleWarning.waitFor();
  const staleDraftBlocked = await staleWarning.isVisible() && await confirmButton.isDisabled();
  await page.getByRole('button', { name: '撤销上一步' }).click();
  await staleWarning.waitFor({ state: 'hidden' });
  await confirmButton.click();
  await page.getByText('已应用').first().waitFor();
  const draftAppliedAfterConfirmation = await page.locator('.flow-node').count() === 4 && await page.getByRole('main').getByText('AI 商品文案工作流 v2', { exact: true }).first().isVisible();
  await page.waitForTimeout(950);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'AI 构建', exact: true }).click();
  const sessionPersistsAfterReload = await page.getByText('已应用').first().isVisible() && await page.getByText('草案已经通过结构校验和独立 Critic，等待确认应用。').last().isVisible();
  const requestIsBounded = requests.length === 5
    && requests.every((entry) => entry.headers['x-aiflow-api-key'] === 'assistant-browser-key')
    && requests.every((entry) => !JSON.stringify(entry.body).includes('assistant-browser-key'))
    && requests[1].body.retry === true
    && requests[2].body.currentWorkflowRevision.startsWith('fnv1a:')
    && requests[2].body.confirmation.answer === 'other'
    && requests[2].body.confirmation.detail === '保留可复制输出，但可以替换旧节点'
    && requests[3].body.confirmation.answer === 'yes'
    && requests[4].body.confirmation === undefined
    && requests[4].body.providers[0].apiKey === undefined;

  const unexpectedConsoleProblems = consoleProblems.filter((entry) => !/status of 504 \(Gateway Timeout\)/.test(entry));
  const result = { panelVisible, systemSkillLocked, criticDefaultsIsolated, timeoutStopsSpinner, asksBeforeDrafting, structuredConfirmationVisible, canvasUntouchedBeforeConfirmation, strictStagesVisible, planPreviewVisible, compressionVisible, canvasStillUntouched, previousDraftLockedDuringAdjustment, staleDraftBlocked, draftAppliedAfterConfirmation, sessionPersistsAfterReload, requestIsBounded, consoleProblems: unexpectedConsoleProblems, pageErrors };
  console.log(JSON.stringify(result, null, 2));
  if (Object.entries(result).some(([key, value]) => !['consoleProblems', 'pageErrors'].includes(key) && value !== true) || unexpectedConsoleProblems.length || pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  gateway.kill('SIGTERM');
}
