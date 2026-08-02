import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleProblems = [];
const pageErrors = [];
const requests = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.addInitScript(() => {
  localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({
    chatApiKey: 'legacy-chat-key',
    imageApiKey: 'legacy-image-key',
    chatBaseUrl: 'https://legacy-chat.example.com/v1',
    imageBaseUrl: 'https://legacy-image.example.com/v1',
    chatModel: 'legacy-chat-model',
    imageModel: 'legacy-image-model'
  }));
});
await page.route('**/api/chat', async (route) => {
  requests.push({ type: 'chat', key: route.request().headers()['x-aiflow-api-key'], body: route.request().postDataJSON() });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'provider chat ok', model: 'vendor-chat-pro', usage: { total_tokens: 12 } }) });
});
await page.route('**/api/images', async (route) => {
  requests.push({ type: 'image', key: route.request().headers()['x-aiflow-api-key'], body: route.request().postDataJSON() });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [{ url: '/assets/case-template-1.jpg' }], model: 'vendor-image-pro' }) });
});

await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '模型服务', exact: true }).first().click();
await page.getByText('默认基础模型服务').waitFor();
const migration = await page.evaluate(() => ({
  store: JSON.parse(localStorage.getItem('aiflow.demo.providers') || '{}'),
  legacyRemoved: !localStorage.getItem('aiflow.demo.apiKeys')
}));

await page.getByRole('button', { name: '添加供应商' }).click();
await page.getByRole('textbox', { name: '供应商名称' }).fill('双能力供应商');
await page.getByRole('textbox', { name: '供应商 Base URL' }).fill('https://vendor.example.com/openai/v1/');
await page.getByLabel('供应商 API Key').fill('vendor-combined-key');
await page.getByRole('combobox', { name: '文本接口协议' }).selectOption('responses');
await page.getByRole('textbox', { name: '新增模型 ID' }).fill('vendor-chat-pro');
await page.getByRole('button', { name: '添加模型' }).click();
await page.getByRole('combobox', { name: '模型能力' }).selectOption('image');
await page.getByRole('textbox', { name: '新增模型 ID' }).fill('vendor-image-pro');
await page.getByRole('button', { name: '添加模型' }).click();
await page.getByRole('button', { name: '保存连接' }).click();
await page.getByText('供应商连接已保存').waitFor();
await page.getByRole('combobox', { name: '模型能力' }).selectOption('chat');
await page.screenshot({ path: path.join(screenshotDir, 'provider-manager.png'), fullPage: true });
await page.setViewportSize({ width: 1024, height: 900 });
await page.waitForTimeout(200);
const responsiveMetrics = await page.evaluate(() => {
  const overflowing = [...document.querySelectorAll('body *')].map((element) => {
    const rect = element.getBoundingClientRect();
    return { tag: element.tagName, className: element.className, right: Math.round(rect.right), width: Math.round(rect.width) };
  }).filter((item) => item.right > window.innerWidth + 1).slice(0, 8);
  return { documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, overflowing };
});
const providerResponsive = responsiveMetrics.documentWidth === responsiveMetrics.viewportWidth;
await page.setViewportSize({ width: 1440, height: 900 });

const storedProvider = await page.evaluate(() => {
  const store = JSON.parse(localStorage.getItem('aiflow.demo.providers') || '{}');
  return store.providers.find((provider) => provider.name === '双能力供应商');
});

await page.getByRole('button', { name: '编排', exact: true }).click();
await page.locator('.flow-node').filter({ hasText: '生成视觉方案' }).click();
await page.getByRole('combobox', { name: '节点供应商连接' }).selectOption({ label: '双能力供应商' });
await page.getByRole('combobox', { name: '节点模型 ID' }).selectOption('vendor-chat-pro');
const reasoningDefaultsHigh = await page.getByRole('combobox', { name: '思考强度' }).inputValue() === 'high';
await page.getByRole('combobox', { name: '思考强度' }).selectOption('low');
await page.locator('.flow-node').filter({ hasText: '生成主视觉' }).click();
await page.getByRole('combobox', { name: '节点供应商连接' }).selectOption({ label: '双能力供应商' });
await page.getByRole('combobox', { name: '节点模型 ID' }).selectOption('vendor-image-pro');
await page.getByRole('button', { name: '试运行' }).click();
await page.getByText('provider chat ok').waitFor({ timeout: 10_000 });
await page.waitForTimeout(900);

const result = {
  legacyMigrated: migration.store.providers?.length === 2
    && migration.store.providers[0].baseUrl === 'https://legacy-chat.example.com/v1'
    && migration.store.providers[1].baseUrl === 'https://legacy-image.example.com/v1'
    && migration.legacyRemoved,
  providerBoundStorage: storedProvider?.baseUrl === 'https://vendor.example.com/openai/v1'
    && storedProvider?.apiKey === 'vendor-combined-key'
    && storedProvider?.models?.some((model) => model.id === 'vendor-chat-pro' && model.capability === 'chat' && model.protocol === 'responses')
    && storedProvider?.models?.some((model) => model.id === 'vendor-image-pro' && model.capability === 'image'),
  chatNodeUsesSelectedProvider: requests.some((request) => request.type === 'chat'
    && request.key === 'vendor-combined-key'
    && request.body.baseUrl === 'https://vendor.example.com/openai/v1'
    && request.body.model === 'vendor-chat-pro'
    && request.body.protocol === 'responses'
    && request.body.reasoningEffort === 'low'),
  imageNodeUsesSelectedProvider: requests.some((request) => request.type === 'image'
    && request.key === 'vendor-combined-key'
    && request.body.baseUrl === 'https://vendor.example.com/openai/v1'
    && request.body.model === 'vendor-image-pro'),
  keyNotRendered: !(await page.locator('body').innerText()).includes('vendor-combined-key'),
  reasoningDefaultsHigh,
  providerResponsive,
  responsiveMetrics,
  consoleProblems,
  pageErrors
};

console.log(JSON.stringify(result, null, 2));
if (!result.legacyMigrated || !result.providerBoundStorage || !result.chatNodeUsesSelectedProvider || !result.imageNodeUsesSelectedProvider || !result.keyNotRendered || !result.reasoningDefaultsHigh || !result.providerResponsive || consoleProblems.length || pageErrors.length) process.exitCode = 1;
await browser.close();
