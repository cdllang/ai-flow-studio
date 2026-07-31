import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleProblems = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
const configDialog = page.getByRole('dialog', { name: '模型配置' });
if (!await configDialog.isVisible()) await page.getByRole('button', { name: '模型配置', exact: true }).click();
await configDialog.waitFor();
await page.waitForTimeout(250);
const chatBaseUrlInput = page.getByRole('textbox', { name: '基础模型 Base URL' });
const imageBaseUrlInput = page.getByRole('textbox', { name: '图像模型 Base URL' });
const chatModelInput = page.getByRole('textbox', { name: '基础模型名称' });
const imageModelInput = page.getByRole('textbox', { name: '图像模型名称' });
const defaultsVisible = {
  chatBaseUrl: await chatBaseUrlInput.inputValue(),
  imageBaseUrl: await imageBaseUrlInput.inputValue(),
  chatModel: await chatModelInput.inputValue(),
  imageModel: await imageModelInput.inputValue()
};
await chatBaseUrlInput.fill('https://chat.example.com/openai/v1/');
await imageBaseUrlInput.fill('https://image.example.com/openai/v1/');
await chatModelInput.fill('merchant-chat-v2');
await imageModelInput.fill('merchant-image-v3');
await page.screenshot({ path: path.join(screenshotDir, 'config-modal.png'), fullPage: true });

const keyInputs = page.locator('.secret-input input');
await keyInputs.nth(0).fill('test-chat-key');
await keyInputs.nth(1).fill('test-image-key');
await page.getByRole('button', { name: '保存配置' }).click();
await page.getByText('连接参数与 API Key 已保存到当前浏览器并立即生效').waitFor();
const storedAfterSave = await page.evaluate(() => {
  const value = JSON.parse(localStorage.getItem('aiflow.demo.apiKeys') || '{}');
  return Boolean(value.chatApiKey) && Boolean(value.imageApiKey)
    && value.chatBaseUrl === 'https://chat.example.com/openai/v1'
    && value.imageBaseUrl === 'https://image.example.com/openai/v1'
    && !Object.hasOwn(value, 'baseUrl')
    && value.chatModel === 'merchant-chat-v2'
    && value.imageModel === 'merchant-image-v3';
});
const nodeModelsUpdated = await page.locator('.flow-node').filter({ hasText: 'merchant-chat-v2' }).count() > 0
  && await page.locator('.flow-node').filter({ hasText: 'merchant-image-v3' }).count() > 0;

await page.getByRole('button', { name: '恢复原始默认值' }).click();
const defaultsRestored = await chatBaseUrlInput.inputValue() === 'https://ai.aiwanai.com.cn/v1'
  && await imageBaseUrlInput.inputValue() === 'https://ai.aiwanai.com.cn/v1'
  && await chatModelInput.inputValue() === 'gpt-5.4-mini'
  && await imageModelInput.inputValue() === 'gpt-image-2-count';

await page.getByRole('button', { name: '清除已保存 Key' }).nth(0).click();
await page.getByRole('button', { name: '清除已保存 Key' }).nth(0).click();
await page.getByRole('button', { name: '保存配置' }).click();

const status = await page.evaluate(async () => (await fetch('/api/config/status')).json());
const clearedAfterTest = await page.evaluate(() => {
  const value = JSON.parse(localStorage.getItem('aiflow.demo.apiKeys') || '{}');
  return !value.chatApiKey && !value.imageApiKey;
});
const result = {
  chatBaseVisible: defaultsVisible.chatBaseUrl === 'https://ai.aiwanai.com.cn/v1',
  imageBaseVisible: defaultsVisible.imageBaseUrl === 'https://ai.aiwanai.com.cn/v1',
  chatModelVisible: defaultsVisible.chatModel === 'gpt-5.4-mini',
  imageModelVisible: defaultsVisible.imageModel === 'gpt-image-2-count',
  keyInputs: await keyInputs.count(),
  defaultsVisible,
  defaultsRestored,
  storedAfterSave,
  nodeModelsUpdated,
  clearedAfterTest,
  serverCredentialStorage: status.credentialStorage,
  plainKeysReturned: Object.hasOwn(status, 'chatApiKey') || Object.hasOwn(status, 'imageApiKey'),
  consoleProblems,
  pageErrors
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
