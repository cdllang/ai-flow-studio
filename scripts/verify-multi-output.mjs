import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const port = Number(process.env.VERIFY_PORT || 14591);
const origin = `http://127.0.0.1:${port}`;
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', STATIC_DIR: process.env.STATIC_DIR || 'dist' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
server.stderr.on('data', (chunk) => { serverOutput += String(chunk); });

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Test server did not start:\n${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' }));
  });
  const page = await context.newPage();
  const consoleProblems = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on('dialog', (dialog) => dialog.accept());

  await page.route('**/api/chat', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '城市轻户外｜UPF100+ 冰感透气，轻装出发。', usage: { total_tokens: 42 } }) });
  });
  await page.route('**/api/images', async (route) => {
    const payload = route.request().postDataJSON();
    const count = Number(payload.count || 1);
    const images = Array.from({ length: count }, (_, index) => ({ id: `mock-${payload.size}-${index}`, url: '/assets/case-template-1.jpg', revisedPrompt: null }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...images[0], images, count: images.length, simulated: false }) });
  });

  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '编辑工作流', exact: true }).first().click();
  await page.getByRole('button', { name: /电商场景预设/ }).click();
  const preset = page.locator('.preset-card').filter({ hasText: '多渠道营销套图' });
  await preset.getByRole('button', { name: '使用模板' }).click();
  await assert.doesNotReject(() => page.getByText('多渠道营销套图', { exact: true }).first().waitFor());

  await page.getByRole('button', { name: '试运行' }).click();
  await page.getByText('工作流输出集合', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText('1 个输出组 · 4 个结果项', { exact: true }).waitFor();
  assert.equal(await page.locator('.output-image-card').count(), 3, 'preset should render three independent image results');
  assert.equal(await page.locator('.output-copy-card').count(), 1, 'duplicate prompt copies should be collapsed to one campaign copy');

  await page.locator('.output-image-trigger').first().click();
  await page.getByText('1 / 3 · ← → 切换 · Esc 关闭', { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByText('2 / 3 · ← → 切换 · Esc 关闭', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.output-gallery').waitFor({ state: 'detached' });
  fs.mkdirSync(path.resolve('.verification'), { recursive: true });
  await page.screenshot({ path: path.resolve('.verification/multi-output.png'), fullPage: true });

  await page.getByRole('button', { name: '复制工作流 JSON' }).click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const exportedWorkflow = JSON.parse(clipboard);
  assert.equal(exportedWorkflow.schema, 'aiflow.workflow');
  assert.equal(exportedWorkflow.workflow.nodes.length, 6);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出结果' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'workflow-output.json');
  const outputPath = await download.path();
  assert.ok(outputPath, 'output download should have a temporary path');
  const exportedOutput = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(exportedOutput.groups[0].items.map((item) => item.key), ['campaignCopy', 'squareImage', 'detailImage', 'mobileImage']);
  assert.deepEqual(consoleProblems, [], `browser console problems:\n${consoleProblems.join('\n')}`);

  console.log(JSON.stringify({ multiOutputItems: 4, imageItems: 3, copyItems: 1, galleryKeyboard: true, workflowClipboard: true, outputDownload: true, consoleProblems: 0 }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
