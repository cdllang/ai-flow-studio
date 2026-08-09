import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });

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
await page.addInitScript(() => localStorage.clear());
await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });

const libraryIsDefault = await page.getByRole('heading', { name: '工作流库', exact: true }).isVisible();
const standaloneLibraryShellVisible = await page.locator('.workflow-library-shell').isVisible();
const editorHeaderHiddenInLibrary = await page.locator('.editor-header').count() === 0;
const editorNavigationHiddenInLibrary = await page.getByRole('navigation', { name: '工作流导航' }).count() === 0;
const editorActionsHidden = await page.getByRole('button', { name: '试运行', exact: true }).count() === 0;

await page.getByRole('button', { name: '新建工作流', exact: true }).click();
await page.locator('.flow-node').first().waitFor();
const blankWorkflowOpened = await page.locator('.flow-node').count() === 2
  && await page.getByText('未命名工作流', { exact: true }).first().isVisible();
const editorNavigationVisibleAfterEntry = await page.getByRole('navigation', { name: '工作流导航' }).getByRole('button', { name: '运行记录', exact: true }).isVisible()
  && await page.getByRole('navigation', { name: '工作流导航' }).getByRole('button', { name: '版本', exact: true }).isVisible();

await page.getByRole('button', { name: '展开配置', exact: true }).click();
await page.getByLabel('节点名称').fill('营销主题输入');
const unsavedStateVisible = await page.getByText('有未保存更改', { exact: true }).isVisible();

page.once('dialog', (dialog) => dialog.dismiss());
await page.getByRole('button', { name: '返回工作流库', exact: true }).click();
const unsavedExitGuarded = await page.locator('.flow-node').count() === 2;

await page.getByRole('button', { name: '保存到库', exact: true }).click();
await page.getByRole('dialog', { name: '保存新工作流' }).getByLabel('工作流名称').fill('营销内容快速生成');
await page.getByRole('dialog', { name: '保存新工作流' }).getByLabel('使用说明').fill('接收营销主题并输出可复用的内容草案。');
await page.getByRole('button', { name: '保存工作流', exact: true }).click();
await page.getByText('已保存到工作流库', { exact: true }).waitFor();
const saveCompleted = await page.getByRole('button', { name: '保存更改', exact: true }).isDisabled();

await page.getByRole('button', { name: '返回工作流库', exact: true }).click();
const savedCard = page.locator('.workflow-library-card').filter({ hasText: '营销内容快速生成' });
await savedCard.waitFor();
const savedWorkflowReturnedToLibrary = await savedCard.isVisible();

await savedCard.getByRole('button', { name: '编辑工作流', exact: true }).click();
const explicitEditEntryWorks = await page.locator('.flow-node').count() === 2;
await page.getByRole('button', { name: '返回工作流库', exact: true }).click();
await savedCard.getByRole('button', { name: '使用工作流', exact: true }).click();
const explicitUseEntryWorks = await page.getByText('只读使用模式', { exact: true }).isVisible();
const editorNavigationHiddenInRunner = await page.getByRole('navigation', { name: '工作流导航' }).getByRole('button', { name: '运行记录', exact: true }).count() === 0;

await page.getByRole('button', { name: '工作流库', exact: true }).click();
await page.screenshot({ path: path.join(screenshotDir, 'workflow-library-navigation.png'), fullPage: true });

const result = {
  libraryIsDefault,
  standaloneLibraryShellVisible,
  editorHeaderHiddenInLibrary,
  editorNavigationHiddenInLibrary,
  editorActionsHidden,
  blankWorkflowOpened,
  editorNavigationVisibleAfterEntry,
  unsavedStateVisible,
  unsavedExitGuarded,
  saveCompleted,
  savedWorkflowReturnedToLibrary,
  explicitEditEntryWorks,
  explicitUseEntryWorks,
  editorNavigationHiddenInRunner,
  consoleProblems,
  pageErrors
};

console.log(JSON.stringify(result, null, 2));
if (Object.entries(result).some(([key, value]) => !['consoleProblems', 'pageErrors'].includes(key) && value !== true) || consoleProblems.length || pageErrors.length) process.exitCode = 1;
await browser.close();
