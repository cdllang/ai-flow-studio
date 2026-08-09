import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeSkillInstructions, listPublicSkills, loadSkillRegistry, resolveLocalSkills, resolveSkills } from './skill-registry.mjs';
import { loadWorkflowAssistantSkill } from './system-skill-loader.mjs';
import {
  addSessionTurn,
  applySessionCompression,
  bindWorkflowDraftModels,
  compileWorkflowDraft,
  extractJsonObject,
  inputOutputConfirmationQuestion,
  inputOutputSignature,
  maxAssistantRepairAttempts,
  normalizeAssistantEnvelope,
  normalizeAssistantSession,
  normalizeTaskContract,
  normalizeWorkflowRepairResponse,
  publicAssistantProviderCatalog,
  resolveAssistantModelTimeout,
  shouldCompressSession,
  validateWorkflowDraft,
  validationReport
} from './workflow-assistant-core.mjs';

dotenv.config({ path: '.env.local', override: false });

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const skillsDirectory = path.resolve(root, process.env.SKILLS_DIR || 'skills');
const skillRegistry = loadSkillRegistry(skillsDirectory);
const systemSkillsDirectory = path.resolve(root, process.env.SYSTEM_SKILLS_DIR || 'system-skills');
const workflowAssistantSkill = loadWorkflowAssistantSkill(systemSkillsDirectory);
const port = Number(process.env.PORT || 14590);
const host = process.env.HOST || '0.0.0.0';
const baseUrl = (process.env.AIWANAI_BASE_URL || 'https://ai.aiwanai.com.cn/v1').replace(/\/$/, '');
const chatBaseUrl = (process.env.AIWANAI_CHAT_BASE_URL || baseUrl).replace(/\/$/, '');
const imageBaseUrl = (process.env.AIWANAI_IMAGE_BASE_URL || baseUrl).replace(/\/$/, '');
const defaultChatModel = process.env.AIWANAI_DEFAULT_CHAT_MODEL || 'gpt-5.4-mini';
const imageModel = process.env.AIWANAI_IMAGE_MODEL || 'gpt-image-2';
const safeError = (error) => error instanceof Error ? error.message : 'Unknown upstream error';

app.use(express.json({ limit: '16mb' }));

const requestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const requestApiKey = (req) => {
  const value = req.get('x-aiflow-api-key');
  return typeof value === 'string' && value.length <= 4096 ? value.trim() : '';
};
const privateHostname = (hostname) => {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '0.0.0.0' || value === '::1' || value.startsWith('127.') || value.startsWith('10.') || value.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(value) || value === '169.254.169.254';
};
const requestBaseUrl = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Base URL 格式无效');
  let target;
  try { target = new URL(value.trim()); } catch { throw new Error('Base URL 必须是合法的 HTTP(S) 地址'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Base URL 仅支持不含账号密码的 HTTP(S) 地址');
  if (privateHostname(target.hostname) && String(process.env.ALLOW_PRIVATE_MODEL_BASE_URL).toLowerCase() !== 'true') throw new Error('Base URL 不能指向本机或私有网络地址');
  return target.toString().replace(/\/$/, '');
};
const requestModel = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('模型名称不能为空且不能超过 200 个字符');
  return value.trim();
};
const requestChatProtocol = (value) => {
  if (value === undefined || value === null || value === '') return 'chat-completions';
  if (value !== 'chat-completions' && value !== 'responses') throw new Error('文本接口协议仅支持 chat-completions 或 responses');
  return value;
};
const requestReasoningEffort = (value) => {
  if (value === undefined || value === null || value === '') return 'high';
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) throw new Error('思考强度仅支持 low、medium、high、xhigh 或 max');
  return value;
};
const responseOutputText = (data) => {
  if (typeof data?.output_text === 'string') return data.output_text;
  if (!Array.isArray(data?.output)) return '';
  return data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((content) => typeof content?.text === 'string' ? content.text : typeof content?.refusal === 'string' ? content.refusal : '')
    .filter(Boolean)
    .join('\n');
};
class TextModelError extends Error {
  constructor(message, code, status = 502, upstreamRequestId = '') {
    super(message);
    this.name = 'TextModelError';
    this.code = code;
    this.status = status;
    this.upstreamRequestId = upstreamRequestId;
  }
}
const assistantModelTimeoutMs = resolveAssistantModelTimeout(process.env.ASSISTANT_MODEL_TIMEOUT_MS, { isTest: process.env.NODE_ENV === 'test' });
const assistantModelRetryDelayMs = (() => {
  const configured = Number.parseInt(process.env.ASSISTANT_MODEL_RETRY_DELAY_MS || '350', 10);
  return Number.isFinite(configured) ? Math.max(0, Math.min(configured, 5_000)) : 350;
})();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isTimeoutError = (error) => error?.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(safeError(error));
const callTextModel = async ({ apiKey, baseUrl: upstreamBaseUrl, model, protocol, reasoningEffort, system, prompt, temperature }) => {
  let response;
  const requestBody = JSON.stringify(protocol === 'responses' ? {
    model,
    input: prompt,
    ...(system ? { instructions: system } : {}),
    reasoning: { effort: reasoningEffort },
    ...(typeof temperature === 'number' ? { temperature } : {}),
    stream: false
  } : {
    model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
    reasoning_effort: reasoningEffort,
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    stream: false
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(`${upstreamBaseUrl}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(assistantModelTimeoutMs),
        body: requestBody
      });
      break;
    } catch (error) {
      if (attempt === 0) {
        await wait(assistantModelRetryDelayMs);
        continue;
      }
      if (isTimeoutError(error)) throw new TextModelError('上游模型响应超时，已自动重试 1 次；请稍后重试或切换模型', 'ASSISTANT_MODEL_TIMEOUT', 504);
      throw new TextModelError(`上游模型网络连接失败，已自动重试 1 次：${safeError(error)}`, 'ASSISTANT_MODEL_NETWORK_ERROR', 502);
    }
  }
  const data = await response.json().catch(() => ({}));
  const upstreamRequestId = response.headers.get('x-request-id') || data?.request_id || '';
  if (!response.ok) throw new TextModelError(data?.error?.message || `模型服务返回 ${response.status}`, 'ASSISTANT_MODEL_UPSTREAM_ERROR', response.status, upstreamRequestId);
  const output = protocol === 'responses' ? responseOutputText(data) : data?.choices?.[0]?.message?.content ?? '';
  if (typeof output !== 'string' || !output.trim()) throw new TextModelError('模型返回了空内容', 'ASSISTANT_MODEL_EMPTY_RESPONSE', 502, upstreamRequestId);
  return { text: output, usage: data?.usage ?? null, model: data?.model || model, upstreamRequestId };
};
const redactSecrets = (value) => JSON.parse(JSON.stringify(value ?? null).replace(/sk-[A-Za-z0-9_-]{16,}/gi, '[REDACTED]').replace(/bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]'));
const publicConfig = () => ({
  baseUrl,
  chatBaseUrl,
  imageBaseUrl,
  chatConfigured: false,
  imageConfigured: false,
  chatKeyHint: null,
  imageKeyHint: null,
  defaultChatModel,
  imageModel,
  credentialStorage: 'browser-localStorage'
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'AIFlow Studio local gateway' });
});

app.get('/api/config/status', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(publicConfig());
});

app.get('/api/skills', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ schemaVersion: 1, skills: listPublicSkills(skillRegistry) });
});

app.post('/api/workflow-assistant/turn', async (req, res) => {
  const id = requestId();
  res.set('X-AIFlow-Request-ID', id);
  const chatApiKey = requestApiKey(req);
  if (!chatApiKey) return res.status(503).json({ code: 'CHAT_KEY_MISSING', message: '请先为 AI 工作流助手选择已配置 API Key 的文本模型', requestId: id });

  const body = req.body ?? {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 20_000) return res.status(400).json({ code: 'ASSISTANT_MESSAGE_INVALID', message: 'Session 消息不能为空且不能超过 20000 个字符', requestId: id });
  const confirmationInput = body.confirmation && typeof body.confirmation === 'object' ? body.confirmation : null;
  const confirmation = confirmationInput && ['yes', 'no', 'other'].includes(confirmationInput.answer) ? {
    answer: confirmationInput.answer,
    question: typeof confirmationInput.question === 'string' ? confirmationInput.question.trim().slice(0, 500) : '',
    detail: typeof confirmationInput.detail === 'string' ? confirmationInput.detail.trim().slice(0, 2_000) : ''
  } : null;

  let builder;
  let critic;
  try {
    const provider = body.provider && typeof body.provider === 'object' ? body.provider : {};
    builder = {
      id: typeof provider.id === 'string' ? provider.id.slice(0, 100) : '',
      baseUrl: requestBaseUrl(provider.baseUrl, chatBaseUrl),
      model: requestModel(provider.model, defaultChatModel),
      protocol: requestChatProtocol(provider.protocol),
      reasoningEffort: requestReasoningEffort(provider.reasoningEffort),
      contextWindow: Number.isFinite(provider.contextWindow) ? Math.max(4_096, Math.min(Number(provider.contextWindow), 2_000_000)) : 128_000,
      apiKey: chatApiKey
    };
    const criticProvider = body.criticProvider && typeof body.criticProvider === 'object' ? body.criticProvider : null;
    const criticApiKey = typeof req.get('x-aiflow-critic-key') === 'string' && req.get('x-aiflow-critic-key').length <= 4096 ? req.get('x-aiflow-critic-key').trim() : chatApiKey;
    critic = criticProvider ? {
      id: typeof criticProvider.id === 'string' ? criticProvider.id.slice(0, 100) : '',
      baseUrl: requestBaseUrl(criticProvider.baseUrl, chatBaseUrl),
      model: requestModel(criticProvider.model, defaultChatModel),
      protocol: requestChatProtocol(criticProvider.protocol),
      reasoningEffort: requestReasoningEffort(criticProvider.reasoningEffort),
      apiKey: criticApiKey || chatApiKey
    } : { ...builder, apiKey: chatApiKey };
  } catch (error) {
    return res.status(400).json({ code: 'MODEL_CONFIG_INVALID', message: safeError(error), requestId: id });
  }

  const providerCatalog = publicAssistantProviderCatalog(body.providers);
  const currentWorkflow = redactSecrets(body.currentWorkflow && typeof body.currentWorkflow === 'object' ? body.currentWorkflow : null);
  let session = normalizeAssistantSession(body.session, { providerId: builder.id, modelId: builder.model, currentWorkflowRevision: body.currentWorkflowRevision });
  session.providerId = builder.id;
  session.modelId = builder.model;
  session.currentWorkflowRevision = typeof body.currentWorkflowRevision === 'string' ? body.currentWorkflowRevision.slice(0, 200) : session.currentWorkflowRevision;
  const expectedInputOutputQuestion = inputOutputConfirmationQuestion(session.contract);
  const confirmingCurrentInputOutput = confirmation?.question === expectedInputOutputQuestion
    && session.contract.inputs.length > 0
    && session.contract.outputs.length > 0;
  if (confirmation?.answer === 'yes' && confirmingCurrentInputOutput) session.confirmedInputOutputSignature = inputOutputSignature(session.contract);
  else if (confirmation) session.confirmedInputOutputSignature = '';
  const lastTurn = session.recentTurns.at(-1);
  const retryingSameTurn = body.retry === true && lastTurn?.role === 'user' && lastTurn.content === message;
  if (!retryingSameTurn) session = addSessionTurn(session, 'user', message);

  const requestedPermissions = body.permissions && typeof body.permissions === 'object' ? body.permissions : session.contract.constraints;
  const authoritativeConstraints = {
    allowHttp: requestedPermissions.allowHttp === true,
    allowCode: requestedPermissions.allowCode === true,
    maxModelCalls: Number.isInteger(requestedPermissions.maxModelCalls) ? Math.max(0, Math.min(requestedPermissions.maxModelCalls, 40)) : 8,
    maxImageCalls: Number.isInteger(requestedPermissions.maxImageCalls) ? Math.max(0, Math.min(requestedPermissions.maxImageCalls, 20)) : 4
  };
  const stages = [];
  let compression = { attempted: false, compressed: false, estimatedTokens: 0, threshold: 0 };
  const streamsProgress = /application\/x-ndjson/i.test(req.get('accept') || '');
  if (streamsProgress) {
    res.status(200);
    res.set({
      'Cache-Control': 'no-store, no-transform',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
  }
  const streamEvent = (event) => {
    if (streamsProgress && !res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  const heartbeatTimer = streamsProgress ? setInterval(() => streamEvent({ type: 'heartbeat', at: Date.now() }), 15_000) : null;
  heartbeatTimer?.unref();
  res.once('close', () => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
  const publishStage = (index) => {
    if (stages[index]) streamEvent({ type: 'stage', index, stage: stages[index] });
  };
  const finishTurn = (status, payload) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (!streamsProgress) return res.status(status).set('Cache-Control', 'no-store').json(payload);
    streamEvent({ type: 'result', status, body: payload });
    if (!res.writableEnded) res.end();
    return res;
  };
  const callStructuredModel = async (options, schemaName) => {
    const response = await callTextModel(options);
    try {
      return extractJsonObject(response.text);
    } catch (firstError) {
      const formatStageIndex = stages.push({ stage: 'format_repair', status: 'running', detail: `${schemaName} 包含额外或无效内容，正在进行一次无损 JSON 格式修复` }) - 1;
      publishStage(formatStageIndex);
      try {
        const reformatted = await callTextModel({
          ...options,
          system: 'You are a Strict JSON Reformatter. Return exactly one valid JSON object and no markdown or commentary. Preserve the first complete object and its semantics. Remove duplicated or trailing objects. Repair syntax only when required. Never invent new fields or values.',
          prompt: JSON.stringify({ schemaName, invalidOutput: response.text.slice(0, 200_000) }),
          temperature: 0
        });
        const parsed = extractJsonObject(reformatted.text);
        stages[formatStageIndex] = { stage: 'format_repair', status: 'success', detail: `${schemaName} 已恢复为单一 JSON 对象，将继续执行全部结构校验` };
        publishStage(formatStageIndex);
        return parsed;
      } catch (repairError) {
        stages[formatStageIndex] = { stage: 'format_repair', status: 'error', detail: `${schemaName} 格式修复失败：${safeError(repairError)}` };
        publishStage(formatStageIndex);
        throw new Error(`${safeError(firstError)}；自动格式修复失败：${safeError(repairError)}`);
      }
    }
  };
  const bindCandidateModels = (draft) => {
    const bindings = [];
    const bound = bindWorkflowDraftModels(draft, {
      providers: providerCatalog,
      builderProviderId: builder.id,
      builderModelId: builder.model,
      onBind: (binding) => bindings.push(binding)
    });
    if (bindings.length) {
      const bindingStageIndex = stages.push({ stage: 'model_binding', status: 'success', detail: `已将 ${bindings.length} 个无效模型引用绑定到用户配置中真实存在的兼容模型` }) - 1;
      publishStage(bindingStageIndex);
    }
    return bound;
  };

  const contextForBuilder = () => ({
    session: {
      id: session.id,
      phase: session.phase,
      contract: session.contract,
      summary: session.summary,
      recentTurns: session.recentTurns,
      currentWorkflowRevision: session.currentWorkflowRevision,
      repairAttempt: session.repairAttempt,
      confirmedInputOutputSignature: session.confirmedInputOutputSignature
    },
    currentWorkflow,
    providers: providerCatalog,
    availableNodeKinds: ['start', 'llm', 'image', 'condition', 'http', 'code', 'aggregate', 'output'],
    permissions: authoritativeConstraints,
    confirmation,
    latestMessage: message
  });

  const initialCompressionCheck = shouldCompressSession(session, { skill: workflowAssistantSkill.builder, contracts: workflowAssistantSkill.contracts, context: contextForBuilder() }, builder.contextWindow);
  compression = { ...compression, estimatedTokens: initialCompressionCheck.estimatedTokens, threshold: initialCompressionCheck.threshold };
  if (initialCompressionCheck.shouldCompress) {
    compression.attempted = true;
    const sourceTurns = session.recentTurns.slice(0, -6);
    if (!sourceTurns.length) {
      session.phase = 'blocked';
      session = addSessionTurn(session, 'assistant', '当前工作流和契约已超过模型上下文预算，且没有可安全压缩的旧消息。请缩小当前工作流或新建 Session。', 'blocked');
      return finishTurn(413, { code: 'ASSISTANT_CONTEXT_TOO_LARGE', message: '上下文超过安全预算且无法压缩', session, compression, stages, requestId: id });
    }
    const sourceTurnIds = sourceTurns.map((turn) => turn.id);
    let compressionError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const compressionStageIndex = stages.push({ stage: 'compression', status: 'running', detail: `正在压缩较早上下文 · 第 ${attempt} 次` }) - 1;
      publishStage(compressionStageIndex);
      try {
        const summary = await callStructuredModel({
          ...builder,
          system: `${workflowAssistantSkill.memory}\n\nReturn one JSON object with confirmedDecisions, rejectedAlternatives, assumptions, pendingQuestions, appliedRevisions, terminology, and sourceTurnIds. Preserve every supplied source turn id.`,
          prompt: JSON.stringify({ priorSummary: session.summary, sourceTurns, contract: session.contract, currentWorkflowRevision: session.currentWorkflowRevision })
        }, 'SessionSummary');
        if (!Array.isArray(summary.sourceTurnIds) || sourceTurnIds.some((turnId) => !summary.sourceTurnIds.includes(turnId))) throw new Error('压缩摘要未覆盖所有来源消息');
        session = applySessionCompression(session, summary, sourceTurnIds);
        compression = { ...compression, compressed: true, sourceTurns: sourceTurnIds.length, retainedTurns: session.recentTurns.length };
        stages[compressionStageIndex] = { stage: 'compression', status: 'success', detail: `已压缩 ${sourceTurnIds.length} 条旧消息，保留最近 ${session.recentTurns.length} 条` };
        publishStage(compressionStageIndex);
        compressionError = null;
        break;
      } catch (error) {
        compressionError = error;
        stages[compressionStageIndex] = { stage: 'compression', status: 'error', detail: safeError(error) };
        publishStage(compressionStageIndex);
      }
    }
    if (compressionError) {
      session.phase = 'blocked';
      session = addSessionTurn(session, 'assistant', '上下文压缩连续两次未通过完整性检查。为避免丢失已确认边界，本 Session 已暂停。', 'blocked');
      return finishTurn(422, { code: 'SESSION_COMPRESSION_FAILED', message: safeError(compressionError), session, compression, stages, requestId: id });
    }
  }

  const applyAuthoritativeConstraints = (contract) => ({ ...normalizeTaskContract(contract), constraints: { ...normalizeTaskContract(contract).constraints, ...authoritativeConstraints } });
  const builderSystem = `${workflowAssistantSkill.builder}\n\n${workflowAssistantSkill.contracts}\n\nYou are the Builder entrypoint. Return exactly one JSON AssistantTurn object and no markdown. WorkflowPlan is the sole source of truth: define every step, responsibility, input/output, and justified connection there first. The application will ignore model-authored positions and compile canvas edges exclusively from WorkflowPlan.connections. Use only the supplied node, provider, and model catalogs. Every draft node status must be idle. Condition nodes must set conditionOperator to exactly one of contains, not_contains, equals, or not_equals. Treat a supplied confirmation object as the user's authoritative answer to that exact question. The only user-facing clarification allowed is confirmation of the inferred inputs and outputs. Infer scope, exclusions, acceptance criteria, permissions, budgets, and implementation details using safe defaults; never ask the user to confirm them. The application itself will render the one input/output confirmation question.`;
  let envelope;
  let intentStageIndex = -1;
  try {
    session.phase = 'drafting';
    intentStageIndex = stages.push({ stage: 'intent', status: 'running', detail: '系统 Skill 正在识别并核对任务输入与输出' }) - 1;
    publishStage(intentStageIndex);
    const builderJson = await callStructuredModel({ ...builder, system: builderSystem, prompt: JSON.stringify(contextForBuilder()) }, 'AssistantTurn');
    envelope = normalizeAssistantEnvelope(builderJson);
    envelope.contract = applyAuthoritativeConstraints(envelope.contract);
    if (!envelope.contract.objective) envelope.contract.objective = message.slice(0, 1_000);
    const nextInputOutputSignature = inputOutputSignature(envelope.contract);
    const inputOutputConfirmed = envelope.contract.inputs.length > 0
      && envelope.contract.outputs.length > 0
      && session.confirmedInputOutputSignature === nextInputOutputSignature;
    if (!['blocked', 'cancelled'].includes(envelope.status) && !inputOutputConfirmed) {
      const question = inputOutputConfirmationQuestion(envelope.contract);
      session.confirmedInputOutputSignature = '';
      envelope = {
        status: 'needs_clarification',
        message: '请确认 AI 识别出的输入与输出是否符合你的要求。',
        contract: { ...envelope.contract, unresolvedQuestions: [question] },
        questions: [question]
      };
    } else if (envelope.status === 'needs_clarification') {
      throw new Error('输入与输出已经确认，Builder 不应继续请求其他确认');
    } else {
      envelope.contract.unresolvedQuestions = [];
    }
    stages[intentStageIndex] = { stage: 'intent', status: 'success', detail: envelope.status === 'needs_clarification' ? '等待用户确认输入与输出' : '输入与输出已经确认' };
    publishStage(intentStageIndex);
  } catch (error) {
    const status = error instanceof TextModelError ? error.status : 502;
    session.phase = 'blocked';
    if (intentStageIndex >= 0 && stages[intentStageIndex]?.status === 'running') {
      stages[intentStageIndex] = { ...stages[intentStageIndex], status: 'error', detail: safeError(error) };
      publishStage(intentStageIndex);
    }
    return finishTurn(status, { code: error.code || 'ASSISTANT_BUILDER_INVALID', message: safeError(error), requestId: id, upstreamRequestId: error.upstreamRequestId || '', session, stages });
  }

  session.contract = envelope.contract;
  if (envelope.status !== 'draft_ready') {
    session.phase = envelope.status === 'blocked' ? 'blocked' : 'discovery';
    session = addSessionTurn(session, 'assistant', [envelope.message, ...envelope.questions].join('\n'), envelope.status);
    return finishTurn(200, { schemaVersion: 1, response: envelope, session, stages, compression, systemSkill: { id: workflowAssistantSkill.id, version: workflowAssistantSkill.version, autoApplied: true }, requestId: id });
  }

  let candidateDraft = bindCandidateModels(compileWorkflowDraft(envelope.draft));
  let report = validationReport({ valid: false, issues: [] }, [], 0);
  let repairAttempt = 0;
  while (repairAttempt <= maxAssistantRepairAttempts) {
    session.phase = 'validating';
    const deterministicStageIndex = stages.push({ stage: 'deterministic_validation', status: 'running', detail: '正在按流程图编译并检查 Schema、连线、权限、模型引用、Secret 与预算' }) - 1;
    publishStage(deterministicStageIndex);
    const deterministic = validateWorkflowDraft(candidateDraft, { providers: providerCatalog, constraints: authoritativeConstraints });
    stages[deterministicStageIndex] = { stage: 'deterministic_validation', status: deterministic.valid ? 'success' : 'error', detail: deterministic.valid ? '确定性检查全部通过' : `发现 ${deterministic.issues.length} 个结构问题` };
    publishStage(deterministicStageIndex);

    let criticIssues = [];
    if (deterministic.valid) {
      const criticStageIndex = stages.push({ stage: 'critic', status: 'running', detail: critic.id && critic.id !== builder.id ? '正在使用独立审查模型检查需求覆盖' : '正在使用隔离上下文 Critic 检查需求覆盖' }) - 1;
      publishStage(criticStageIndex);
      try {
        const { edges: compiledEdges = [], ...canonicalDraft } = candidateDraft;
        const criticResult = await callStructuredModel({
          ...critic,
          system: `${workflowAssistantSkill.critic}\n\n${workflowAssistantSkill.contracts}`,
          prompt: JSON.stringify({
            contract: envelope.contract,
            candidateDraft: canonicalDraft,
            compiledGraph: {
              source: 'application-compiler',
              nodeIds: candidateDraft.nodes.map((node) => node.id),
              edges: compiledEdges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) }))
            },
            currentWorkflow,
            deterministicFacts: deterministic,
            providers: providerCatalog
          })
        }, 'CriticResult');
        criticIssues = Array.isArray(criticResult.issues) ? criticResult.issues : [];
        if (criticResult.passed !== true && !criticIssues.some((entry) => entry?.severity === 'error')) criticIssues.push({ severity: 'error', code: 'CRITIC_REJECTED_WITHOUT_DETAILS', message: 'Critic 拒绝草案但未提供有效证据' });
        const criticPassed = criticResult.passed === true && !criticIssues.some((entry) => entry?.severity === 'error');
        stages[criticStageIndex] = { stage: 'critic', status: criticPassed ? 'success' : 'error', detail: criticPassed ? '语义覆盖检查通过' : `Critic 发现 ${criticIssues.length} 个问题` };
        publishStage(criticStageIndex);
      } catch (error) {
        criticIssues = [{ severity: 'error', code: error.code || 'CRITIC_RESPONSE_INVALID', message: safeError(error), evidence: error.upstreamRequestId || '' }];
        stages[criticStageIndex] = { stage: 'critic', status: 'error', detail: safeError(error) };
        publishStage(criticStageIndex);
      }
    }
    report = validationReport(deterministic, criticIssues, repairAttempt);
    if (report.valid) break;
    if (repairAttempt >= maxAssistantRepairAttempts) break;

    repairAttempt += 1;
    session.phase = 'repairing';
    const repairStageIndex = stages.push({ stage: 'repair', status: 'running', detail: `正在进行第 ${repairAttempt}/${maxAssistantRepairAttempts} 轮受限修复` }) - 1;
    publishStage(repairStageIndex);
    try {
      const repairedJson = await callStructuredModel({
        ...builder,
        system: `${workflowAssistantSkill.builder}\n\n${workflowAssistantSkill.contracts}\n\nYou are the Repair entrypoint. Return exactly one JSON object with only \"message\" and the complete repaired \"draft\". Do not return AssistantTurn status, contract, questions, validation, or repair counters. WorkflowPlan remains the sole source of truth; repair the plan first and keep node configs aligned with its step ids and kinds. Condition nodes must set conditionOperator to exactly one of contains, not_contains, equals, or not_equals. Remove a direct connection only when another path carries the same specific dependency unchanged. Topological reachability alone is not redundancy: preserve a direct edge whenever the target inputMapping or output binding reads sourceId.field, or the alternate path carries a transformed or different data value. Preserve the authoritative contract supplied by the application and change only allow-listed workflow draft fields. Never change permissions, provider credentials, schema version, validation state, or repair counters.`,
        prompt: JSON.stringify({ contract: envelope.contract, candidateDraft, validation: report, currentWorkflow, providers: providerCatalog, permissions: authoritativeConstraints })
      }, 'WorkflowRepair');
      const repaired = normalizeWorkflowRepairResponse(repairedJson);
      candidateDraft = bindCandidateModels(compileWorkflowDraft(repaired.draft));
      envelope.message = repaired.message || envelope.message;
      stages[repairStageIndex] = { stage: 'repair', status: 'success', detail: `第 ${repairAttempt} 轮修复已生成，重新执行全部检查` };
      publishStage(repairStageIndex);
    } catch (error) {
      stages[repairStageIndex] = { stage: 'repair', status: 'error', detail: safeError(error) };
      publishStage(repairStageIndex);
      report = { ...report, valid: false, issues: [...report.issues, { source: 'critic', severity: 'error', code: error.code || 'REPAIR_RESPONSE_INVALID', message: safeError(error) }] };
      break;
    }
  }

  session.repairAttempt = repairAttempt;
  session.candidateDraft = candidateDraft;
  session.validation = report;
  if (report.valid) {
    session.phase = 'awaiting_confirmation';
    envelope = { ...envelope, status: 'draft_ready', draft: candidateDraft, validation: report };
    session = addSessionTurn(session, 'assistant', envelope.message || '草案已通过全部检查，等待确认应用。', 'draft_ready');
  } else {
    session.phase = 'blocked';
    envelope = { ...envelope, status: 'blocked', message: `草案在 ${repairAttempt} 轮修复后仍未通过严格校验，未修改当前画布。`, draft: candidateDraft, validation: report };
    session = addSessionTurn(session, 'assistant', envelope.message, 'blocked');
  }
  return finishTurn(200, { schemaVersion: 1, response: envelope, session, stages, compression, systemSkill: { id: workflowAssistantSkill.id, version: workflowAssistantSkill.version, autoApplied: true }, requestId: id });
});

app.post('/api/chat', async (req, res) => {
  const id = requestId();
  const chatApiKey = requestApiKey(req);
  if (!chatApiKey) {
    return res.status(503).json({ code: 'CHAT_KEY_MISSING', message: '基础模型 Key 未配置', requestId: id });
  }

  const { prompt, system, model, baseUrl: customBaseUrl, protocol, reasoningEffort, temperature, skillIds, localSkills } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ code: 'PROMPT_REQUIRED', message: '请输入提示词', requestId: id });
  }

  let upstreamBaseUrl;
  let upstreamModel;
  let upstreamProtocol;
  let upstreamReasoningEffort;
  let appliedSkills;
  try {
    upstreamBaseUrl = requestBaseUrl(customBaseUrl, chatBaseUrl);
    upstreamModel = requestModel(model, defaultChatModel);
    upstreamProtocol = requestChatProtocol(protocol);
    upstreamReasoningEffort = requestReasoningEffort(reasoningEffort);
  } catch (error) {
    return res.status(400).json({ code: 'MODEL_CONFIG_INVALID', message: safeError(error), requestId: id });
  }
  try {
    const serverSkills = resolveSkills(skillIds, skillRegistry, 'llm');
    const requestLocalSkills = resolveLocalSkills(localSkills, skillRegistry, 'llm');
    appliedSkills = [...serverSkills, ...requestLocalSkills];
    if (appliedSkills.length > 8) throw new Error('A node can apply at most 8 Skills');
  } catch (error) {
    return res.status(400).json({ code: 'SKILL_CONFIG_INVALID', message: safeError(error), requestId: id });
  }
  const upstreamSystem = composeSkillInstructions(system, appliedSkills);

  try {
    const response = await fetch(`${upstreamBaseUrl}/${upstreamProtocol === 'responses' ? 'responses' : 'chat/completions'}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chatApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(upstreamProtocol === 'responses' ? {
        model: upstreamModel,
        input: prompt,
        ...(upstreamSystem ? { instructions: upstreamSystem } : {}),
        reasoning: { effort: upstreamReasoningEffort },
        ...(typeof temperature === 'number' ? { temperature } : {}),
        stream: false
      } : {
        model: upstreamModel,
        messages: [
          ...(upstreamSystem ? [{ role: 'system', content: upstreamSystem }] : []),
          { role: 'user', content: prompt }
        ],
        reasoning_effort: upstreamReasoningEffort,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        stream: false
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        code: 'CHAT_UPSTREAM_ERROR',
        message: data?.error?.message || `模型服务返回 ${response.status}`,
        requestId: id
      });
    }
    return res.json({
      text: upstreamProtocol === 'responses' ? responseOutputText(data) : data?.choices?.[0]?.message?.content ?? '',
      usage: data?.usage ?? null,
      model: data?.model || upstreamModel,
      protocol: upstreamProtocol,
      reasoningEffort: upstreamReasoningEffort,
      skills: appliedSkills.map(({ id: skillId, name, version, mode, source }) => ({ id: skillId, name, version, mode, source })),
      requestId: id
    });
  } catch (error) {
    return res.status(502).json({ code: 'CHAT_NETWORK_ERROR', message: safeError(error), requestId: id });
  }
});

app.post('/api/images', async (req, res) => {
  const id = requestId();
  const imageApiKey = requestApiKey(req);
  if (!imageApiKey) {
    return res.status(503).json({ code: 'IMAGE_KEY_MISSING', message: '图像模型 Key 未配置', requestId: id });
  }
  const { prompt, size = '1024x1024', quality = 'high', count = 1, referenceImage = null, baseUrl: customBaseUrl, model } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ code: 'PROMPT_REQUIRED', message: '请输入图像提示词', requestId: id });
  }
  const imageCount = Number(count);
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 4) {
    return res.status(400).json({ code: 'INVALID_IMAGE_COUNT', message: '单个图像节点每次可生成 1–4 张图片', requestId: id });
  }
  if (referenceImage !== null && (typeof referenceImage !== 'object' || typeof referenceImage.dataUrl !== 'string')) {
    return res.status(400).json({ code: 'INVALID_REFERENCE_IMAGE', message: '参考图片格式无效', requestId: id });
  }

  let upstreamBaseUrl;
  let upstreamModel;
  try {
    upstreamBaseUrl = requestBaseUrl(customBaseUrl, imageBaseUrl);
    upstreamModel = requestModel(model, imageModel);
  } catch (error) {
    return res.status(400).json({ code: 'MODEL_CONFIG_INVALID', message: safeError(error), requestId: id });
  }

  let imageInput = null;
  if (referenceImage) {
    const match = referenceImage.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({ code: 'INVALID_REFERENCE_IMAGE', message: '参考图片仅支持 PNG、JPEG 或 WebP', requestId: id });
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 10 * 1024 * 1024) {
      return res.status(413).json({ code: 'REFERENCE_IMAGE_TOO_LARGE', message: '参考图片不能超过 10 MB', requestId: id });
    }
    const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    imageInput = {
      blob: new Blob([bytes], { type: match[1] }),
      filename: typeof referenceImage.name === 'string' && referenceImage.name.trim() ? referenceImage.name : `reference.${extension}`
    };
  }

  try {
    let response;
    let data;
    let attempts = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      attempts = attempt;
      if (imageInput) {
        const form = new FormData();
        form.append('model', upstreamModel);
        form.append('prompt', prompt);
        form.append('size', size);
        form.append('quality', quality);
        form.append('n', String(imageCount));
        form.append('image', imageInput.blob, imageInput.filename);
        response = await fetch(`${upstreamBaseUrl}/images/edits`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${imageApiKey}` },
          body: form
        });
      } else {
        response = await fetch(`${upstreamBaseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${imageApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: upstreamModel, prompt, size, quality, n: imageCount })
        });
      }
      data = await response.json().catch(() => ({}));
      if (response.ok) break;
      const message = data?.error?.message || '';
      const retryable = response.status === 429 || response.status >= 500 || message.includes('无可用渠道');
      if (!retryable || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1500 : 4000));
    }
    if (!response.ok) {
      const upstreamMessage = data?.error?.message || `图像服务返回 ${response.status}`;
      if (String(process.env.IMAGE_DEMO_FALLBACK).toLowerCase() === 'true') {
        const images = Array.from({ length: imageCount }, (_, index) => ({
          id: `${id}-${index + 1}`,
          url: '/assets/case-template-1.jpg',
          base64: null,
          revisedPrompt: null
        }));
        return res.json({
          ...images[0],
          images,
          model: upstreamModel,
          mode: imageInput ? 'edit' : 'generate',
          simulated: true,
          attempts,
          warning: `图像渠道暂不可用，已使用品牌演示素材：${upstreamMessage}`,
          requestId: id
        });
      }
      return res.status(response.status).json({
        code: 'IMAGE_UPSTREAM_ERROR',
        message: `${upstreamMessage}；请确认模型渠道配置`,
        requestId: id
      });
    }
    const images = (Array.isArray(data?.data) ? data.data : []).map((item, index) => ({
      id: `${id}-${index + 1}`,
      url: item?.url ?? null,
      base64: item?.b64_json ?? null,
      revisedPrompt: item?.revised_prompt ?? null
    })).filter((item) => item.url || item.base64);
    const first = images[0] ?? {};
    return res.json({
      url: first.url ?? null,
      base64: first.base64 ?? null,
      revisedPrompt: first.revisedPrompt ?? null,
      images,
      count: images.length,
      model: upstreamModel,
      mode: imageInput ? 'edit' : 'generate',
      simulated: false,
      attempts,
      requestId: id
    });
  } catch (error) {
    return res.status(502).json({ code: 'IMAGE_NETWORK_ERROR', message: safeError(error), requestId: id });
  }
});

app.post('/api/http', async (req, res) => {
  const id = requestId();
  const { method = 'GET', url, headers = {}, body = '' } = req.body ?? {};
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  if (!allowedMethods.has(method)) {
    return res.status(400).json({ code: 'HTTP_METHOD_INVALID', message: '不支持的 HTTP 方法', requestId: id });
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).json({ code: 'HTTP_URL_INVALID', message: '请输入合法的 HTTP(S) URL', requestId: id });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ code: 'HTTP_PROTOCOL_INVALID', message: 'HTTP 节点仅允许 http:// 或 https://', requestId: id });
  }
  if (privateHostname(target.hostname)) {
    return res.status(403).json({ code: 'HTTP_PRIVATE_ADDRESS_BLOCKED', message: '为保护本机安全，HTTP 节点不能访问本地或私有网络地址', requestId: id });
  }

  const safeHeaders = {};
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (!['host', 'content-length', 'connection'].includes(key.toLowerCase()) && typeof value === 'string') safeHeaders[key] = value;
    }
  }

  try {
    const response = await fetch(target, {
      method,
      headers: safeHeaders,
      body: method === 'GET' ? undefined : String(body || ''),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let responseBody = text;
    if (contentType.includes('application/json')) {
      try { responseBody = JSON.parse(text); } catch { responseBody = text; }
    }
    return res.json({
      status: response.status,
      ok: response.ok,
      contentType,
      body: responseBody,
      requestId: id
    });
  } catch (error) {
    return res.status(502).json({ code: 'HTTP_REQUEST_FAILED', message: safeError(error), requestId: id });
  }
});

const dist = path.resolve(root, process.env.STATIC_DIR || 'dist');
app.use(express.static(dist));
app.use((_req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  res.sendFile(path.join(dist, 'index.html'));
});

const server = app.listen(port, host, () => {
  console.log(`[AIFlow] API running at http://${host}:${port}`);
});

const shutdown = (signal) => {
  console.log(`[AIFlow] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
