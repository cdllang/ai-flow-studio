import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
});

const results = {};

function imageDataUrl(width, height, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff8a3d"/><stop offset="1" stop-color="#8538ff"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="50%" cy="43%" r="18%" fill="rgba(255,255,255,.18)"/>
    <text x="50%" y="53%" text-anchor="middle" fill="white" font-family="Arial" font-size="${Math.round(Math.min(width, height) * .1)}" font-weight="700">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function verifyRatio({ name, ratioLabel, width, height, screenshot }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' })));
  const page = await context.newPage();
  const consoleProblems = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/api/config/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      baseUrl: 'https://example.invalid/v1',
      chatConfigured: true,
      imageConfigured: true,
      chatKeyHint: 'test',
      imageKeyHint: 'test',
      defaultChatModel: 'gpt-5.4-mini',
      imageModel: 'gpt-image-2-count'
    })
  }));
  await page.route('**/api/chat', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text: `${ratioLabel} visual prompt`, usage: { total_tokens: 8 } })
  }));
  await page.route('**/api/images', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: imageDataUrl(width, height, ratioLabel), model: 'gpt-image-2-count' })
  }));

  await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
  await page.locator('.flow-node').filter({ hasText: '\u751f\u6210\u4e3b\u89c6\u89c9' }).click();
  await page.getByRole('button', { name: new RegExp(`^${ratioLabel}`) }).click();
  await page.getByRole('button', { name: '\u8bd5\u8fd0\u884c' }).click();
  await page.locator('.output-image-card').waitFor();

  const trigger = page.locator('.output-image-trigger').first();
  await trigger.locator('img').evaluate((image) => {
    if (image.complete && image.naturalWidth) return;
    return new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    });
  });
  await page.waitForFunction(({ expectedWidth, expectedHeight }) => {
    const image = document.querySelector('.output-image-trigger img');
    return image instanceof HTMLImageElement && image.naturalWidth === expectedWidth && image.naturalHeight === expectedHeight;
  }, { expectedWidth: width, expectedHeight: height });

  const frame = await trigger.boundingBox();
  if (!frame) throw new Error(`${name}: result image frame is missing`);
  const frameRatio = frame.width / frame.height;
  const expectedRatio = width / height;
  const adaptive = Math.abs(frameRatio - expectedRatio) < 0.035;

  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '\u591a\u56fe\u7247\u7ed3\u679c\u9884\u89c8' });
  await dialog.waitFor();
  const previewOpened = await dialog.locator('img').isVisible();
  if (screenshot) await page.screenshot({ path: path.join(screenshotDir, screenshot), fullPage: true });

  await page.keyboard.press('Escape');
  const escapeClosed = await dialog.isHidden();
  await trigger.click();
  await page.getByRole('button', { name: '\u5173\u95ed\u56fe\u7247\u9884\u89c8' }).click();
  const closeButtonClosed = await dialog.isHidden();
  await trigger.click();
  await page.locator('.image-preview-backdrop').click({ position: { x: 8, y: 8 } });
  const backdropClosed = await dialog.isHidden();

  results[name] = {
    expectedRatio: Number(expectedRatio.toFixed(4)),
    frameRatio: Number(frameRatio.toFixed(4)),
    frameSize: { width: Math.round(frame.width), height: Math.round(frame.height) },
    adaptive,
    previewOpened,
    escapeClosed,
    closeButtonClosed,
    backdropClosed,
    consoleProblems,
    pageErrors
  };

  await context.close();
}

await verifyRatio({ name: 'portrait', ratioLabel: '9:16', width: 900, height: 1600, screenshot: 'image-result-preview.png' });
await verifyRatio({ name: 'landscape', ratioLabel: '16:9', width: 1600, height: 900 });

console.log(JSON.stringify(results, null, 2));

const failed = Object.values(results).some((result) =>
  !result.adaptive || !result.previewOpened || !result.escapeClosed || !result.closeButtonClosed || !result.backdropClosed || result.consoleProblems.length || result.pageErrors.length
);

await browser.close();
if (failed) process.exitCode = 1;
