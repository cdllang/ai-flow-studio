import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleProblems = [];
const pageErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.addInitScript(() => localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' })));
await page.route('**/api/config/status', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ baseUrl: 'https://example.com/v1', chatConfigured: true, imageConfigured: true, chatKeyHint: '••••test', imageKeyHint: '••••test', defaultChatModel: 'test-chat', imageModel: 'test-image' })
}));

await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await page.locator('.header-center').getByRole('button', { name: '模型服务' }).click();
const debugHiddenOutsideEditor = await page.locator('.debug-panel, .debug-window, .debug-minimized-pill').count() === 0;

await page.locator('.header-center').getByRole('button', { name: '编排' }).click();
await page.getByRole('button', { name: 'AI 构建' }).click();
await page.locator('.workflow-assistant').waitFor();
const headerLayerAboveAssistant = await page.evaluate(() => {
  const header = document.querySelector('.editor-header');
  const assistant = document.querySelector('.workflow-assistant');
  if (!header || !assistant) return false;
  return Number(getComputedStyle(header).zIndex) > Number(getComputedStyle(assistant).zIndex);
});

console.log(JSON.stringify({ debugHiddenOutsideEditor, headerLayerAboveAssistant, consoleProblems, pageErrors }, null, 2));
if (!debugHiddenOutsideEditor || !headerLayerAboveAssistant || consoleProblems.length || pageErrors.length) process.exitCode = 1;
await browser.close();
