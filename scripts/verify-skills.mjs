import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const probe = net.createServer();
const port = await listen(probe);
await close(probe);

const screenshotDir = path.resolve(process.env.VERIFY_SCREENSHOT_DIR || '.verification');
fs.mkdirSync(screenshotDir, { recursive: true });
const staticDir = path.resolve(process.env.VERIFY_STATIC_DIR || 'dist');
const gateway = spawn(process.execPath, ['server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', STATIC_DIR: staticDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
let gatewayOutput = '';
gateway.stdout.on('data', (chunk) => { gatewayOutput += String(chunk); });
gateway.stderr.on('data', (chunk) => { gatewayOutput += String(chunk); });

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleProblems = [];
const pageErrors = [];
const chatRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.addInitScript(() => {
  localStorage.setItem('aiflow.demo.providers', JSON.stringify({ schemaVersion: 1, providers: [{
    id: 'skill-provider',
    name: 'Skill 验证供应商',
    baseUrl: 'https://skills.example.com/v1',
    apiKey: 'skill-browser-key',
    models: [{ id: 'reasoning-model', capability: 'chat', protocol: 'responses' }]
  }] }));
  if (!localStorage.getItem('aiflow.demo.workflow')) {
    localStorage.setItem('aiflow.demo.workflow', JSON.stringify({
      title: '节点 Skill 验证',
      input: '为 AI 工作流平台制作一张克制的 16:9 产品主视觉',
      nodes: [
        { id: 'start', type: 'flowNode', position: { x: 80, y: 180 }, data: { kind: 'start', title: '开始', subtitle: '输入', status: 'idle' } },
        { id: 'llm-1', type: 'flowNode', position: { x: 400, y: 180 }, data: { kind: 'llm', title: '提示词专家', subtitle: 'reasoning-model', model: 'reasoning-model', providerId: 'skill-provider', prompt: '保持品牌语气。', status: 'idle' } },
        { id: 'output', type: 'flowNode', position: { x: 720, y: 180 }, data: { kind: 'output', title: '输出', subtitle: '结果', status: 'idle' } }
      ],
      edges: [{ id: 'e1', source: 'start', target: 'llm-1' }, { id: 'e2', source: 'llm-1', target: 'output' }]
    }));
  }
});
await page.route('**/api/chat', async (route) => {
  const request = route.request().postDataJSON();
  chatRequests.push(request);
  const skills = [
    ...(request.skillIds || []).map((id) => ({ id, name: 'GPT Image 2', version: '1.0.0', mode: 'advisor', source: 'server' })),
    ...(request.localSkills || []).map((skill) => ({ id: skill.id, name: skill.name, version: skill.version, mode: skill.mode, source: 'local' }))
  ];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'image-ready prompt', usage: { total_tokens: 12 }, skills }) });
});

try {
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (Date.now() >= deadline) throw new Error(`gateway failed to start:\n${gatewayOutput}`);

  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Skills' }).click();
  await page.getByRole('button', { name: '新建本地 Skill' }).click();
  await page.getByRole('textbox', { name: '本地 Skill 名称' }).fill('我的品牌 Skill');
  await page.getByRole('textbox', { name: '本地 Skill 说明' }).fill('仅保存在浏览器的品牌提示词规则');
  await page.getByRole('textbox', { name: '本地 Skill 指令' }).fill('始终使用克制的深色品牌视觉，并保留清晰安全边距。');
  await page.getByRole('button', { name: '保存到本地' }).click();
  await page.getByText('本地 Skill 已保存到当前浏览器').waitFor();
  const localSkillStoredOnlyInBrowser = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('aiflow.demo.local-skills') || '{}');
    return data.skills?.length === 1 && data.skills[0].name === '我的品牌 Skill' && data.skills[0].instructions.includes('深色品牌视觉');
  });
  await page.screenshot({ path: path.join(screenshotDir, 'skill-center-hybrid-storage.png'), fullPage: true });

await page.getByRole('button', { name: '返回工作流库', exact: true }).click();
await page.getByRole('button', { name: '编辑工作流', exact: true }).first().click();
  await page.locator('.flow-node').filter({ hasText: '提示词专家' }).click();
  const enableSkill = page.getByRole('button', { name: '启用 Skill GPT Image 2' });
  const skillListed = await enableSkill.isVisible() && await page.getByText('服务器 · Advisor').isVisible();
  const publicCatalogHidesInstructions = await page.evaluate(async () => {
    const data = await fetch('/api/skills').then((response) => response.json());
    return data.skills.length === 1 && data.skills[0].id === 'gpt-image-2' && data.skills[0].source === 'server' && !('instructions' in data.skills[0]);
  });
  await enableSkill.click();
  const enableLocalSkill = page.getByRole('button', { name: '启用 Skill 我的品牌 Skill' });
  const localSkillListed = await enableLocalSkill.isVisible() && await page.getByText('本地 · Advisor').isVisible();
  await enableLocalSkill.click();
  const skillSelected = await page.getByRole('button', { name: '停用 Skill GPT Image 2' }).getAttribute('aria-pressed') === 'true';
  const localSkillSelected = await page.getByRole('button', { name: '停用 Skill 我的品牌 Skill' }).getAttribute('aria-pressed') === 'true';
  const nodeShowsSkillCount = await page.locator('.flow-node').filter({ hasText: '提示词专家' }).getByText('2 Skill').isVisible();

  await page.waitForTimeout(950);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.flow-node').filter({ hasText: '提示词专家' }).click();
  const skillPersistsAfterReload = await page.getByRole('button', { name: '停用 Skill GPT Image 2' }).getAttribute('aria-pressed') === 'true'
    && await page.getByRole('button', { name: '停用 Skill 我的品牌 Skill' }).getAttribute('aria-pressed') === 'true';
  await page.getByRole('button', { name: '试运行' }).click();
  await page.getByText('image-ready prompt').waitFor({ timeout: 10_000 });
  const requestIncludesSkill = chatRequests.some((request) => JSON.stringify(request.skillIds) === JSON.stringify(['gpt-image-2'])
    && request.localSkills?.length === 1
    && request.localSkills[0].name === '我的品牌 Skill'
    && request.localSkills[0].instructions.includes('深色品牌视觉')
    && request.reasoningEffort === 'high');
  await page.getByRole('button', { name: '运行过程' }).click();
  const runLogShowsSkill = await page.locator('.timeline-item').filter({ hasText: '提示词专家' }).getByText(/2 Skill/).isVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'gpt-image-2-skill-selector.png'), fullPage: true });

  const result = {
    skillListed,
    localSkillListed,
    publicCatalogHidesInstructions,
    localSkillStoredOnlyInBrowser,
    skillSelected,
    localSkillSelected,
    nodeShowsSkillCount,
    skillPersistsAfterReload,
    requestIncludesSkill,
    runLogShowsSkill,
    consoleProblems,
    pageErrors
  };
  console.log(JSON.stringify(result, null, 2));
  if (Object.entries(result).some(([key, value]) => !['consoleProblems', 'pageErrors'].includes(key) && value !== true) || consoleProblems.length || pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  gateway.kill('SIGTERM');
}
