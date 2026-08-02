import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('.verification');
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const consoleProblems = [];
const pageErrors = [];
const attachDiagnostics = (page) => {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
};
const mockConfigured = (page) => page.route('**/api/config/status', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ baseUrl: 'https://ai.aiwanai.com.cn/v1', chatConfigured: true, imageConfigured: true, chatKeyHint: '••••test', imageKeyHint: '••••test', defaultChatModel: 'gpt-5.4-mini', imageModel: 'gpt-image-2-count' })
}));

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' })));
attachDiagnostics(page);
await mockConfigured(page);
await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });

const tooltipDescriptions = await page.locator('.header-actions .header-tool').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-tooltip')));
const headerTooltips = JSON.stringify(tooltipDescriptions) === JSON.stringify(['撤销上一步', '复制工作流 JSON', '下载工作流文件', '导入工作流文件']);
await page.locator('.header-actions .header-tool').nth(1).hover();
await page.waitForTimeout(180);
const headerTooltipVisible = await page.locator('.header-actions .header-tool').nth(1).evaluate((button) => getComputedStyle(button, '::after').opacity === '1');

await page.getByRole('button', { name: '折叠节点库' }).click();
const libraryCollapsed = await page.getByRole('button', { name: '展开节点库' }).isVisible();
await page.getByRole('button', { name: '展开节点库' }).click();
await page.getByRole('button', { name: '关闭节点配置' }).click();
const configCollapsed = await page.getByRole('button', { name: '展开配置' }).isVisible();
await page.getByRole('button', { name: '展开配置' }).click();

const initialNodeCount = await page.locator('.flow-node').count();
const libraryDragHint = await page.getByText('拖拽到画布 · 单击快速添加').isVisible();
await page.locator('.library-item').filter({ hasText: '大模型' }).dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 520, y: 330 } });
await page.waitForTimeout(150);
const nodeDragged = await page.locator('.flow-node').count() === initialNodeCount + 1;
await page.locator('.flow-node').last().getByRole('button', { name: '节点菜单' }).click();
await page.locator('.flow-node').last().getByRole('button', { name: '删除节点' }).click();
await page.locator('.library-item').filter({ hasText: '代码' }).click();
const nodeAdded = await page.locator('.flow-node').count() === initialNodeCount + 1;
await page.locator('.flow-node').last().getByRole('button', { name: '节点菜单' }).click();
await page.locator('.flow-node').last().getByRole('button', { name: '删除节点' }).click();
const nodeDeleted = await page.locator('.flow-node').count() === initialNodeCount;
await page.getByRole('button', { name: '撤销' }).click();
const undoRestored = await page.locator('.flow-node').count() === initialNodeCount + 1;

await page.locator('.flow-node').filter({ hasText: '生成视觉方案' }).click();
await page.getByRole('button', { name: '插入变量' }).click();
const variableInserted = (await page.locator('.form-section textarea').first().inputValue()).includes('{{workflow.input}}');

await page.getByRole('button', { name: '发布' }).click();
await page.getByText('发布版本').waitFor();
const versionPublished = await page.locator('.version-badge').count() > 0;
await page.getByRole('button', { name: '恢复到画布' }).first().click();
const versionRestored = await page.getByText('社媒主视觉生成器').first().isVisible();

const branchContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await branchContext.addInitScript(() => {
  localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' }));
  const nodes = [
    { id: 'start', type: 'flowNode', position: { x: 80, y: 180 }, data: { kind: 'start', title: '开始', subtitle: '输入', status: 'idle' } },
    { id: 'condition', type: 'flowNode', position: { x: 370, y: 180 }, data: { kind: 'condition', title: '判断 AI', subtitle: '包含 AI', conditionSource: 'input', conditionOperator: 'contains', conditionValue: 'AI', status: 'idle' } },
    { id: 'true-code', type: 'flowNode', position: { x: 680, y: 90 }, data: { kind: 'code', title: '命中分支', subtitle: 'JavaScript', code: 'return { text: "TRUE_PATH" };', status: 'idle' } },
    { id: 'false-code', type: 'flowNode', position: { x: 680, y: 300 }, data: { kind: 'code', title: '未命中分支', subtitle: 'JavaScript', code: 'return { text: "FALSE_PATH" };', status: 'idle' } },
    { id: 'output', type: 'flowNode', position: { x: 1000, y: 180 }, data: { kind: 'output', title: '输出', subtitle: '结果', status: 'idle' } }
  ];
  const edges = [
    { id: 'e1', source: 'start', target: 'condition' },
    { id: 'e2', source: 'condition', sourceHandle: 'true', target: 'true-code' },
    { id: 'e3', source: 'condition', sourceHandle: 'false', target: 'false-code' },
    { id: 'e4', source: 'true-code', target: 'output' },
    { id: 'e5', source: 'false-code', target: 'output' }
  ];
  localStorage.setItem('aiflow.demo.workflow', JSON.stringify({ nodes, edges, input: 'AI workflow' }));
});
const branchPage = await branchContext.newPage();
attachDiagnostics(branchPage);
await mockConfigured(branchPage);
await branchPage.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await branchPage.getByRole('button', { name: '试运行' }).click();
try {
  await branchPage.getByText('TRUE_PATH').waitFor({ timeout: 8000 });
} catch (error) {
  console.log('BRANCH_DEBUG\n' + await branchPage.locator('body').innerText());
  await branchPage.screenshot({ path: path.join(screenshotDir, 'interaction-branch-error.png'), fullPage: true });
  throw error;
}
const trueBranchExecuted = await branchPage.getByText('TRUE_PATH').isVisible();
await branchPage.getByRole('button', { name: '运行过程' }).click();
const falseBranchSkipped = await branchPage.getByText('条件分支未命中，已跳过').count() > 0;
await branchPage.getByRole('button', { name: '运行记录' }).click();
const runRecordCreated = await branchPage.getByText('运行成功').count() > 0;
await branchPage.screenshot({ path: path.join(screenshotDir, 'interaction-complete.png'), fullPage: true });

const stopContext = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await stopContext.addInitScript(() => {
  localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' }));
  const nodes = [
    { id: 'start', type: 'flowNode', position: { x: 80, y: 180 }, data: { kind: 'start', title: '开始', subtitle: '输入', status: 'idle' } },
    { id: 'llm', type: 'flowNode', position: { x: 400, y: 180 }, data: { kind: 'llm', title: '慢速模型', subtitle: 'gpt-5.4-mini', model: 'gpt-5.4-mini', status: 'idle' } },
    { id: 'output', type: 'flowNode', position: { x: 720, y: 180 }, data: { kind: 'output', title: '输出', subtitle: '结果', status: 'idle' } }
  ];
  const edges = [{ id: 'e1', source: 'start', target: 'llm' }, { id: 'e2', source: 'llm', target: 'output' }];
  localStorage.setItem('aiflow.demo.workflow', JSON.stringify({ nodes, edges, input: 'stop test' }));
});
const stopPage = await stopContext.newPage();
attachDiagnostics(stopPage);
await mockConfigured(stopPage);
await stopPage.route('**/api/chat', async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 8000));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'late response' }) });
});
await stopPage.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await stopPage.getByRole('button', { name: '试运行' }).click();
await stopPage.locator('.stop-button').waitFor();
await stopPage.locator('.stop-button').click();
await stopPage.getByText('运行已由用户停止').waitFor();
const stopSucceeded = await stopPage.getByText('运行已由用户停止').isVisible();

const httpContext = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await httpContext.addInitScript(() => {
  localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' }));
  const nodes = [
    { id: 'start', type: 'flowNode', position: { x: 80, y: 180 }, data: { kind: 'start', title: '开始', subtitle: '输入', status: 'idle' } },
    { id: 'http', type: 'flowNode', position: { x: 400, y: 180 }, data: { kind: 'http', title: '获取数据', subtitle: 'GET', httpMethod: 'GET', httpUrl: 'https://example.com/data', httpHeaders: '{}', status: 'idle' } },
    { id: 'output', type: 'flowNode', position: { x: 720, y: 180 }, data: { kind: 'output', title: '输出', subtitle: '结果', status: 'idle' } }
  ];
  const edges = [{ id: 'e1', source: 'start', target: 'http' }, { id: 'e2', source: 'http', target: 'output' }];
  localStorage.setItem('aiflow.demo.workflow', JSON.stringify({ nodes, edges, input: 'http test' }));
});
const httpPage = await httpContext.newPage();
attachDiagnostics(httpPage);
await mockConfigured(httpPage);
await httpPage.route('**/api/http', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 200, body: { message: 'HTTP_NODE_OK' } }) }));
await httpPage.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await httpPage.getByRole('button', { name: '试运行' }).click();
await httpPage.getByText(/HTTP_NODE_OK/).waitFor();
const httpNodeExecuted = await httpPage.getByText(/HTTP_NODE_OK/).isVisible();

console.log(JSON.stringify({
  headerTooltips,
  headerTooltipVisible,
  libraryCollapsed,
  configCollapsed,
  libraryDragHint,
  nodeDragged,
  nodeAdded,
  nodeDeleted,
  undoRestored,
  variableInserted,
  versionPublished,
  versionRestored,
  trueBranchExecuted,
  falseBranchSkipped,
  runRecordCreated,
  stopSucceeded,
  httpNodeExecuted,
  consoleProblems,
  pageErrors
}, null, 2));

if (!headerTooltips || !headerTooltipVisible || !libraryCollapsed || !configCollapsed || !libraryDragHint || !nodeDragged || !nodeAdded || !nodeDeleted || !undoRestored || !variableInserted || !versionPublished || !versionRestored || !trueBranchExecuted || !falseBranchSkipped || !runRecordCreated || !stopSucceeded || !httpNodeExecuted || consoleProblems.length || pageErrors.length) process.exitCode = 1;

await browser.close();
