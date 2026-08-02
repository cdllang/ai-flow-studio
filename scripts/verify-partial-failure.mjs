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

await page.addInitScript(() => {
  localStorage.setItem('aiflow.demo.apiKeys', JSON.stringify({ chatApiKey: 'test-chat-key', imageApiKey: 'test-image-key' }));
  const nodes = [
    { id: 'start', type: 'flowNode', position: { x: 80, y: 220 }, data: { kind: 'start', title: '测试输入', subtitle: '输入', status: 'idle' } },
    { id: 'successful-code', type: 'flowNode', position: { x: 400, y: 80 }, data: { kind: 'code', title: '成功分支', subtitle: 'JavaScript', code: 'return { text: "SURVIVING_OUTPUT_TEXT" };', status: 'idle' } },
    { id: 'failing-code', type: 'flowNode', position: { x: 420, y: 330 }, data: { kind: 'code', title: '故意失败节点', subtitle: 'JavaScript', code: 'throw new Error("SIMULATED_BRANCH_FAILURE");', status: 'idle' } },
    { id: 'surviving-output', type: 'flowNode', position: { x: 760, y: 80 }, data: { kind: 'output', title: '已完成输出', subtitle: '应被保留', outputKey: 'surviving', status: 'idle' } },
    { id: 'blocked-output', type: 'flowNode', position: { x: 760, y: 330 }, data: { kind: 'output', title: '失败分支输出', subtitle: '应被阻断', outputKey: 'blocked', status: 'idle' } }
  ];
  const edges = [
    { id: 'e1', source: 'start', target: 'successful-code' },
    { id: 'e2', source: 'start', target: 'failing-code' },
    { id: 'e3', source: 'successful-code', target: 'surviving-output' },
    { id: 'e4', source: 'failing-code', target: 'blocked-output' }
  ];
  localStorage.setItem('aiflow.demo.workflow', JSON.stringify({ nodes, edges, input: 'SURVIVING_OUTPUT_TEXT', title: '部分失败保全测试' }));
});
await page.route('**/api/config/status', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    chatBaseUrl: 'https://ai.aiwanai.com.cn/v1',
    imageBaseUrl: 'https://ai.aiwanai.com.cn/v1',
    chatConfigured: true,
    imageConfigured: true,
    defaultChatModel: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2-count'
  })
}));

await page.goto('http://127.0.0.1:14590', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '试运行' }).click();
await page.getByRole('button', { name: '试运行' }).waitFor({ timeout: 10_000 });
await page.getByRole('button', { name: '日志' }).click();
const logText = await page.locator('.log-view').innerText();
await page.getByRole('button', { name: '最终输出' }).click();

const result = {
  survivingOutputVisible: await page.locator('.output-collection').getByText('SURVIVING_OUTPUT_TEXT', { exact: true }).count() > 0,
  failureNodeNamed: logText.includes('故意失败节点'),
  failureCodeVisible: logText.includes('SIMULATED_BRANCH_FAILURE'),
  blockedBranchExplained: logText.includes('上游失败'),
  partialRunRecorded: false,
  consoleProblems,
  pageErrors
};
await page.getByRole('button', { name: '运行记录' }).click();
result.partialRunRecorded = await page.getByText('部分成功').count() > 0;

console.log(JSON.stringify(result, null, 2));
if (!result.survivingOutputVisible || !result.failureNodeNamed || !result.failureCodeVisible || !result.blockedBranchExplained || !result.partialRunRecorded || consoleProblems.length || pageErrors.length) {
  process.exitCode = 1;
}
await browser.close();
