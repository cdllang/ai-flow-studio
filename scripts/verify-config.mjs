import { chromium } from 'playwright-core';

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
await page.screenshot({ path: 'config-modal.png', fullPage: true });

const keyInputs = page.locator('.secret-input input');
await keyInputs.nth(0).fill('test-chat-key');
await keyInputs.nth(1).fill('test-image-key');
await page.getByRole('button', { name: '保存配置' }).click();
await page.getByText('API Key 已保存到当前浏览器并立即生效').waitFor();
const storedAfterSave = await page.evaluate(() => {
  const value = JSON.parse(localStorage.getItem('aiflow.demo.apiKeys') || '{}');
  return Boolean(value.chatApiKey) && Boolean(value.imageApiKey);
});

await page.getByRole('button', { name: '清除已保存 Key' }).nth(0).click();
await page.getByRole('button', { name: '清除已保存 Key' }).nth(0).click();
await page.getByRole('button', { name: '保存配置' }).click();

const status = await page.evaluate(async () => (await fetch('/api/config/status')).json());
const clearedAfterTest = await page.evaluate(() => {
  const value = JSON.parse(localStorage.getItem('aiflow.demo.apiKeys') || '{}');
  return !value.chatApiKey && !value.imageApiKey;
});
const result = {
  baseVisible: await page.getByText('https://ai.aiwanai.com.cn/v1').count() > 0,
  chatModelVisible: await page.getByText('gpt-5.4-mini').count() > 0,
  imageModelVisible: await page.getByText('gpt-image-2-count').count() > 0,
  keyInputs: await keyInputs.count(),
  storedAfterSave,
  clearedAfterTest,
  serverCredentialStorage: status.credentialStorage,
  plainKeysReturned: Object.hasOwn(status, 'chatApiKey') || Object.hasOwn(status, 'imageApiKey'),
  consoleProblems,
  pageErrors
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
