import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
});

const consoleProblems = [];
const pageErrors = [];
let chatKeyForwarded = false;
let imageKeyForwarded = false;
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.route('**/api/config/status', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    baseUrl: 'https://ai.aiwanai.com.cn/v1',
    chatConfigured: false,
    imageConfigured: false,
    chatKeyHint: null,
    imageKeyHint: null,
    defaultChatModel: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2-count'
  })
}));

await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
const autoConfigDialog = await page.getByRole('dialog', { name: '模型配置' }).isVisible();
await page.getByRole('button', { name: '关闭模型配置' }).click();
const closeBlocked = await page.getByRole('dialog', { name: '模型配置' }).isVisible();
await page.screenshot({ path: path.join(screenshotDir, 'auto-config-modal.png'), fullPage: true });

const mockPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await mockPage.addInitScript(() => localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' })));
mockPage.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
mockPage.on('pageerror', (error) => pageErrors.push(error.message));
await mockPage.route('**/api/config/status', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    baseUrl: 'https://ai.aiwanai.com.cn/v1',
    chatConfigured: true,
    imageConfigured: true,
    chatKeyHint: '••••test',
    imageKeyHint: '••••test',
    defaultChatModel: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2-count'
  })
}));
await mockPage.route('**/api/chat', (route) => {
  chatKeyForwarded = route.request().headers()['x-aiflow-api-key'] === 'test-chat-key';
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text: '基于参考图片扩展出的视觉提示词', usage: { total_tokens: 16 }, model: 'gpt-5.4-mini' })
  });
});
await mockPage.route('**/api/images', async (route) => {
  imageKeyForwarded = route.request().headers()['x-aiflow-api-key'] === 'test-image-key';
  const body = route.request().postDataJSON();
  if (!body.referenceImage?.dataUrl?.startsWith('data:image/')) {
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '缺少参考图' }) });
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: '/assets/case-template-1.jpg', model: 'gpt-image-2-count', mode: 'edit', simulated: false })
  });
});

await mockPage.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await mockPage.locator('#reference-image-input').setInputFiles('public/assets/case-template-1.jpg');
await mockPage.getByAltText('参考图片预览').waitFor();
const referencePreview = await mockPage.getByAltText('参考图片预览').isVisible();
await mockPage.locator('.test-input > button').click();
await mockPage.locator('.output-copy-card').waitFor();
await mockPage.locator('.output-image-card').waitFor();
await mockPage.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:14590' });
await mockPage.locator('.output-copy-card').getByRole('button', { name: '复制' }).click();
const copySucceeded = await mockPage.getByRole('button', { name: '已复制' }).isVisible();
const textDownload = mockPage.waitForEvent('download');
await mockPage.getByRole('button', { name: '导出结果' }).click();
const textDownloadName = (await textDownload).suggestedFilename();
const imageDownload = mockPage.waitForEvent('download');
await mockPage.locator('.output-image-card').getByRole('button', { name: /^下载 / }).click();
const imageDownloadName = (await imageDownload).suggestedFilename();
await mockPage.screenshot({ path: path.join(screenshotDir, 'reference-output.png'), fullPage: true });
await mockPage.setViewportSize({ width: 1100, height: 760 });
await mockPage.waitForTimeout(250);
const compactLayout = await mockPage.evaluate(() => ({
  documentWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  documentHeight: document.documentElement.scrollHeight,
  viewportHeight: window.innerHeight
}));

const result = {
  autoConfigDialog,
  closeBlocked,
  referencePreview,
  textOutputVisible: await mockPage.locator('.output-copy-card').isVisible(),
  imageOutputVisible: await mockPage.locator('.output-image-card').isVisible(),
  copySucceeded,
  textDownloadVisible: await mockPage.getByRole('button', { name: '导出结果' }).isVisible(),
  imageDownloadVisible: await mockPage.locator('.output-image-card').getByRole('button', { name: /^下载 / }).isVisible(),
  textDownloadName,
  imageDownloadName,
  chatKeyForwarded,
  imageKeyForwarded,
  compactLayout,
  consoleProblems,
  pageErrors
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
