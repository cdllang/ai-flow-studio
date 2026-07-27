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
await page.locator('.run-button').click();
const outcome = await Promise.race([
  page.locator('.result-view img').waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'success'),
  page.locator('.log-view.error').waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'error')
]);
if (outcome === 'success') {
  await page.getByRole('button', { name: '运行过程' }).click();
  await page.getByText('工作流运行成功').waitFor({ state: 'visible' });
}
await page.screenshot({ path: 'demo-run.png', fullPage: true });

const result = {
  title: await page.title(),
  nodes: await page.locator('.flow-node').count(),
  outcome,
  workflowSucceeded: outcome === 'success' && await page.getByText('工作流运行成功').count() > 0,
  fallbackVisible: await page.getByText('图像渠道不可用 · 已使用品牌演示素材').count() > 0,
  generatedImageVisible: outcome === 'success',
  visibleError: outcome === 'error' ? await page.locator('.log-view.error').innerText() : null,
  consoleProblems,
  pageErrors
};

await page.setViewportSize({ width: 1100, height: 760 });
await page.waitForTimeout(300);
const layout = await page.evaluate(() => ({
  documentWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  documentHeight: document.documentElement.scrollHeight,
  viewportHeight: window.innerHeight
}));

console.log(JSON.stringify({ ...result, layout }, null, 2));
await browser.close();
