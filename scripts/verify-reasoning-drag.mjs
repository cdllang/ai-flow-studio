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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleProblems = [];
const pageErrors = [];
const chatRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.addInitScript(() => {
  localStorage.setItem('aiflow.demo.providers', JSON.stringify({ schemaVersion: 1, providers: [{
    id: 'reasoning-provider',
    name: '推理模型服务',
    baseUrl: 'https://reasoning.example.com/v1',
    apiKey: 'reasoning-browser-key',
    models: [{ id: 'reasoning-model', capability: 'chat', protocol: 'responses' }]
  }] }));
  localStorage.setItem('aiflow.demo.workflow', JSON.stringify({
    title: '思考强度与拖放验证',
    input: '验证思考强度',
    nodes: [
      { id: 'start', type: 'flowNode', position: { x: 80, y: 180 }, data: { kind: 'start', title: '开始', subtitle: '输入', status: 'idle' } },
      { id: 'llm', type: 'flowNode', position: { x: 400, y: 180 }, data: { kind: 'llm', title: '推理节点', subtitle: 'reasoning-model', model: 'reasoning-model', status: 'idle' } },
      { id: 'output', type: 'flowNode', position: { x: 720, y: 180 }, data: { kind: 'output', title: '输出', subtitle: '结果', status: 'idle' } }
    ],
    edges: [{ id: 'e1', source: 'start', target: 'llm' }, { id: 'e2', source: 'llm', target: 'output' }]
  }));
});
await page.route('**/api/chat', async (route) => {
  chatRequests.push(route.request().postDataJSON());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'reasoning ok', usage: { total_tokens: 8 } }) });
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
  await page.locator('.flow-node').filter({ hasText: '推理节点' }).click();
  const reasoningSelect = page.getByRole('combobox', { name: '思考强度' });
  const reasoningDefaultsHigh = await reasoningSelect.inputValue() === 'high';
  const reasoningOptionsCoverLowToMax = await reasoningSelect.locator('option').evaluateAll((options) => options.map((option) => option.value).join(',')) === 'low,medium,high,xhigh,max';
  await reasoningSelect.selectOption('max');
  await page.getByRole('button', { name: '试运行' }).click();
  await page.getByText('reasoning ok').waitFor({ timeout: 10_000 });
  const reasoningRequestForwarded = chatRequests.some((request) => request.protocol === 'responses' && request.reasoningEffort === 'max');

  const tooltipDescriptions = await page.locator('.header-actions .header-tool').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-tooltip')));
  const headerTooltips = JSON.stringify(tooltipDescriptions) === JSON.stringify(['撤销上一步', '复制工作流 JSON', '下载工作流文件', '导入工作流文件']);
  await page.locator('.header-actions .header-tool').nth(1).hover();
  await page.waitForTimeout(180);
  const headerTooltipVisible = await page.locator('.header-actions .header-tool').nth(1).evaluate((button) => getComputedStyle(button, '::after').opacity === '1');
  await page.screenshot({ path: path.join(screenshotDir, 'reasoning-and-header-tooltips-v2.png'), fullPage: true });

  const initialNodeCount = await page.locator('.flow-node').count();
  const libraryDragHint = await page.getByText('拖拽到画布 · 单击快速添加').isVisible();
  await page.locator('.library-item').filter({ hasText: '代码' }).dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 520, y: 300 } });
  await page.waitForTimeout(200);
  const nodeDraggedOnce = await page.locator('.flow-node').count() === initialNodeCount + 1;
  const draggedNodeSelected = await page.getByRole('textbox', { name: '节点名称' }).inputValue().then((value) => value.startsWith('代码'));

  const result = {
    reasoningDefaultsHigh,
    reasoningOptionsCoverLowToMax,
    reasoningRequestForwarded,
    headerTooltips,
    headerTooltipVisible,
    libraryDragHint,
    nodeDraggedOnce,
    draggedNodeSelected,
    consoleProblems,
    pageErrors
  };
  console.log(JSON.stringify(result, null, 2));
  if (Object.entries(result).some(([key, value]) => !['consoleProblems', 'pageErrors'].includes(key) && value !== true) || consoleProblems.length || pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  gateway.kill('SIGTERM');
}
