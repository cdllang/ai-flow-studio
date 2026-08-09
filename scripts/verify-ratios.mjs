import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' })));
const consoleProblems = [];
const pageErrors = [];
let requestedSize = null;
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.route('**/api/config/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ baseUrl: 'https://ai.aiwanai.com.cn/v1', chatConfigured: true, imageConfigured: true, chatKeyHint: '••••test', imageKeyHint: '••••test', defaultChatModel: 'gpt-5.4-mini', imageModel: 'gpt-image-2-count' }) }));
await page.route('**/api/chat', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '16:9 visual prompt', usage: { total_tokens: 10 } }) }));
await page.route('**/api/images', (route) => {
  requestedSize = route.request().postDataJSON().size;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/assets/case-template-1.jpg', model: 'gpt-image-2-count' }) });
});

await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '编辑工作流', exact: true }).first().click();
await page.locator('.flow-node').filter({ hasText: '生成主视觉' }).click();
const presetCount = await page.locator('.ratio-preset-grid > button').count();
await page.getByRole('button', { name: '16:9 1536 × 864' }).click();
const selectedPreset = await page.getByRole('button', { name: '16:9 1536 × 864' }).evaluate((element) => element.classList.contains('active'));
const subtitleUpdated = await page.locator('.flow-node').filter({ hasText: '生成主视觉' }).getByText(/16:9.*1536×864/).isVisible();
await page.screenshot({ path: path.join(screenshotDir, 'image-ratio-presets.png'), fullPage: true });
await page.getByRole('button', { name: '试运行' }).click();
await page.locator('.output-image-card').waitFor();

console.log(JSON.stringify({
  presetCount,
  selectedPreset,
  subtitleUpdated,
  requestedSize,
  requestUsesSelectedSize: requestedSize === '1536x864',
  consoleProblems,
  pageErrors
}, null, 2));

await browser.close();
