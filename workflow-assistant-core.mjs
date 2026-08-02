const nodeIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const allowedKinds = new Set(['start', 'llm', 'image', 'condition', 'http', 'code', 'aggregate', 'output']);
const allowedPhases = new Set(['discovery', 'drafting', 'validating', 'repairing', 'awaiting_confirmation', 'applied', 'blocked']);
const allowedStatuses = new Set(['needs_clarification', 'draft_ready', 'blocked', 'cancelled']);
const secretPattern = /(?:sk-[A-Za-z0-9_-]{16,}|bearer\s+[A-Za-z0-9._-]{20,})/i;

export const workflowAssistantSessionVersion = 1;
export const maxAssistantRepairAttempts = 2;
export const maxAssistantTurns = 40;

const text = (value, maxLength = 10_000) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const strings = (value, maxItems = 24, maxLength = 500) => Array.isArray(value)
  ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim().slice(0, maxLength)] : []).slice(0, maxItems)
  : [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function emptyTaskContract() {
  return {
    objective: '',
    operation: 'create',
    inScope: [],
    outOfScope: [],
    inputs: [],
    outputs: [],
    constraints: { allowHttp: false, allowCode: false, maxModelCalls: 8, maxImageCalls: 4 },
    acceptanceCriteria: [],
    assumptions: [],
    unresolvedQuestions: []
  };
}

export function normalizeTaskContract(value) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const operation = ['create', 'adjust', 'repair', 'explain'].includes(candidate.operation) ? candidate.operation : 'create';
  const normalizePorts = (ports, output = false) => Array.isArray(ports) ? ports.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const type = ['text', 'image', 'file', 'json'].includes(entry.type) ? entry.type : null;
    const name = text(entry.name, 100);
    if (!type || !name) return [];
    return [{ name, type, ...(output ? { count: Number.isInteger(entry.count) && entry.count > 0 ? Math.min(entry.count, 20) : undefined } : { required: entry.required !== false }) }];
  }).slice(0, 24) : [];
  const constraints = candidate.constraints && typeof candidate.constraints === 'object' ? candidate.constraints : {};
  return {
    objective: text(candidate.objective, 1_000),
    operation,
    inScope: strings(candidate.inScope),
    outOfScope: strings(candidate.outOfScope),
    inputs: normalizePorts(candidate.inputs),
    outputs: normalizePorts(candidate.outputs, true),
    constraints: {
      allowHttp: constraints.allowHttp === true,
      allowCode: constraints.allowCode === true,
      maxModelCalls: Number.isInteger(constraints.maxModelCalls) ? Math.max(0, Math.min(constraints.maxModelCalls, 40)) : 8,
      maxImageCalls: Number.isInteger(constraints.maxImageCalls) ? Math.max(0, Math.min(constraints.maxImageCalls, 20)) : 4,
      ...(text(constraints.costCeiling, 100) ? { costCeiling: text(constraints.costCeiling, 100) } : {}),
      ...(text(constraints.latencyCeiling, 100) ? { latencyCeiling: text(constraints.latencyCeiling, 100) } : {})
    },
    acceptanceCriteria: strings(candidate.acceptanceCriteria),
    assumptions: strings(candidate.assumptions),
    unresolvedQuestions: strings(candidate.unresolvedQuestions, 12)
  };
}

export function taskContractReady(contract) {
  const normalized = normalizeTaskContract(contract);
  return Boolean(normalized.objective && normalized.inputs.length && normalized.outputs.length && normalized.outOfScope.length && normalized.acceptanceCriteria.length && !normalized.unresolvedQuestions.length);
}

export function createAssistantSession(options = {}) {
  const createdAt = nowIso();
  return {
    id: id('was'),
    version: workflowAssistantSessionVersion,
    createdAt,
    updatedAt: createdAt,
    phase: 'discovery',
    providerId: text(options.providerId, 100),
    modelId: text(options.modelId, 200),
    contract: emptyTaskContract(),
    summary: {
      confirmedDecisions: [],
      rejectedAlternatives: [],
      assumptions: [],
      pendingQuestions: [],
      appliedRevisions: [],
      terminology: [],
      sourceTurnIds: []
    },
    recentTurns: [],
    currentWorkflowRevision: text(options.currentWorkflowRevision, 200),
    repairAttempt: 0
  };
}

const normalizeSummary = (value) => {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    confirmedDecisions: strings(candidate.confirmedDecisions),
    rejectedAlternatives: strings(candidate.rejectedAlternatives),
    assumptions: strings(candidate.assumptions),
    pendingQuestions: strings(candidate.pendingQuestions),
    appliedRevisions: strings(candidate.appliedRevisions),
    terminology: strings(candidate.terminology),
    sourceTurnIds: strings(candidate.sourceTurnIds, 40, 100)
  };
};

const normalizeTurn = (value) => {
  if (!value || typeof value !== 'object' || !['user', 'assistant'].includes(value.role)) return null;
  const content = text(value.content, 20_000);
  if (!content) return null;
  return {
    id: text(value.id, 100) || id('turn'),
    role: value.role,
    content,
    createdAt: text(value.createdAt, 100) || nowIso(),
    ...(allowedStatuses.has(value.status) ? { status: value.status } : {})
  };
};

export function normalizeAssistantSession(value, options = {}) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : createAssistantSession(options);
  const fallback = createAssistantSession(options);
  const session = {
    id: text(candidate.id, 100) || fallback.id,
    version: workflowAssistantSessionVersion,
    createdAt: text(candidate.createdAt, 100) || fallback.createdAt,
    updatedAt: nowIso(),
    phase: allowedPhases.has(candidate.phase) ? candidate.phase : 'discovery',
    providerId: text(candidate.providerId, 100) || text(options.providerId, 100),
    modelId: text(candidate.modelId, 200) || text(options.modelId, 200),
    contract: normalizeTaskContract(candidate.contract),
    summary: normalizeSummary(candidate.summary),
    recentTurns: Array.isArray(candidate.recentTurns) ? candidate.recentTurns.map(normalizeTurn).filter(Boolean).slice(-maxAssistantTurns) : [],
    currentWorkflowRevision: text(candidate.currentWorkflowRevision, 200) || text(options.currentWorkflowRevision, 200),
    repairAttempt: Number.isInteger(candidate.repairAttempt) ? Math.max(0, Math.min(candidate.repairAttempt, maxAssistantRepairAttempts)) : 0
  };
  if (candidate.candidateDraft && typeof candidate.candidateDraft === 'object') session.candidateDraft = clone(candidate.candidateDraft);
  if (candidate.validation && typeof candidate.validation === 'object') session.validation = clone(candidate.validation);
  return session;
}

export function addSessionTurn(session, role, content, status) {
  const normalized = normalizeAssistantSession(session);
  normalized.recentTurns = [...normalized.recentTurns, {
    id: id('turn'),
    role,
    content: text(content, 20_000),
    createdAt: nowIso(),
    ...(status && allowedStatuses.has(status) ? { status } : {})
  }].slice(-maxAssistantTurns);
  normalized.updatedAt = nowIso();
  return normalized;
}

export function estimateTokens(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(serialized.length / 3.5));
}

export function shouldCompressSession(session, assembledContext, contextWindow = 128_000) {
  const normalizedWindow = Number.isFinite(contextWindow) ? Math.max(4_096, Math.min(contextWindow, 2_000_000)) : 128_000;
  const estimatedTokens = estimateTokens(assembledContext);
  return {
    shouldCompress: session.recentTurns.length > 12 || estimatedTokens >= Math.floor(normalizedWindow * 0.7),
    estimatedTokens,
    contextWindow: normalizedWindow,
    threshold: Math.floor(normalizedWindow * 0.7)
  };
}

export function applySessionCompression(session, summary, sourceTurnIds) {
  const normalized = normalizeAssistantSession(session);
  const sourceIds = new Set(strings(sourceTurnIds, 40, 100));
  const allIds = new Set(normalized.recentTurns.map((turn) => turn.id));
  if (!sourceIds.size || [...sourceIds].some((turnId) => !allIds.has(turnId))) throw new Error('Compressed summary references unknown turns');
  const latestIds = new Set(normalized.recentTurns.slice(-6).map((turn) => turn.id));
  if ([...sourceIds].some((turnId) => latestIds.has(turnId))) throw new Error('Compression cannot replace the most recent six turns');
  const retained = normalized.recentTurns.filter((turn) => !sourceIds.has(turn.id));
  if (retained.length < Math.min(6, normalized.recentTurns.length)) throw new Error('Compression must retain the most recent turns');
  const normalizedSummary = normalizeSummary(summary);
  if (normalizedSummary.sourceTurnIds.some((turnId) => !sourceIds.has(turnId))) throw new Error('Summary source turn ids do not match the compression set');
  normalized.summary = normalizedSummary;
  normalized.recentTurns = retained;
  normalized.updatedAt = nowIso();
  return normalized;
}

export function extractJsonObject(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Model returned an empty response');
  const trimmed = value.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model response does not contain a JSON object');
  const json = unfenced.slice(start, end + 1);
  try { return JSON.parse(json); } catch (error) { throw new Error(`Model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

export function normalizeAssistantEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Assistant response must be an object');
  const status = allowedStatuses.has(value.status) ? value.status : null;
  if (!status) throw new Error('Assistant response has an invalid status');
  const message = text(value.message, 5_000);
  if (!message) throw new Error('Assistant response message is required');
  const questions = strings(value.questions, 3, 500);
  const contract = normalizeTaskContract(value.contract);
  if (status === 'needs_clarification' && !questions.length) throw new Error('Clarification response must contain questions');
  if (status === 'draft_ready' && (!value.draft || typeof value.draft !== 'object')) throw new Error('draft_ready response must contain a draft');
  return { status, message, contract, questions, ...(value.draft ? { draft: clone(value.draft) } : {}), ...(value.changeSet ? { changeSet: clone(value.changeSet) } : {}) };
}

const issue = (source, code, message, options = {}) => ({ source, severity: options.severity || 'error', code, message, ...(options.nodeId ? { nodeId: options.nodeId } : {}), ...(options.path ? { path: options.path } : {}), ...(options.evidence ? { evidence: options.evidence } : {}), ...(options.suggestedFix ? { suggestedFix: options.suggestedFix } : {}) });

export function validateWorkflowDraft(draft, options = {}) {
  const issues = [];
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const constraints = normalizeTaskContract({ constraints: options.constraints }).constraints;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return { valid: false, issues: [issue('schema', 'DRAFT_REQUIRED', '候选工作流必须是对象')] };
  if (draft.schema !== 'aiflow.workflow-draft' || draft.schemaVersion !== 1) issues.push(issue('schema', 'DRAFT_SCHEMA_INVALID', '工作流草案 Schema 或版本无效', { path: '/schema' }));
  if (!text(draft.title, 200)) issues.push(issue('schema', 'TITLE_REQUIRED', '工作流标题不能为空', { path: '/title' }));
  if (!Array.isArray(draft.nodes) || !draft.nodes.length || draft.nodes.length > 100) issues.push(issue('schema', 'NODES_INVALID', '工作流必须包含 1–100 个节点', { path: '/nodes' }));
  if (!Array.isArray(draft.edges) || draft.edges.length > 200) issues.push(issue('schema', 'EDGES_INVALID', '工作流连接必须是最多 200 项的数组', { path: '/edges' }));
  if (issues.some((entry) => ['NODES_INVALID', 'EDGES_INVALID'].includes(entry.code))) return { valid: false, issues };

  const nodeIds = new Set();
  const nodeById = new Map();
  for (const [index, node] of draft.nodes.entries()) {
    const path = `/nodes/${index}`;
    if (!node || typeof node !== 'object' || !nodeIdPattern.test(node.id || '')) { issues.push(issue('schema', 'NODE_ID_INVALID', '节点 ID 必须使用小写字母、数字或连字符', { path: `${path}/id` })); continue; }
    if (nodeIds.has(node.id)) issues.push(issue('graph', 'DUPLICATE_NODE_ID', `节点 ID 重复：${node.id}`, { nodeId: node.id }));
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
    if (node.type !== 'flowNode') issues.push(issue('schema', 'NODE_TYPE_INVALID', '节点 type 必须为 flowNode', { nodeId: node.id, path: `${path}/type` }));
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) issues.push(issue('schema', 'NODE_POSITION_INVALID', '节点位置必须包含有限数值 x/y', { nodeId: node.id, path: `${path}/position` }));
    const data = node.data;
    if (!data || typeof data !== 'object' || !allowedKinds.has(data.kind)) { issues.push(issue('node-config', 'NODE_KIND_INVALID', '节点类型不在运行时目录中', { nodeId: node.id, path: `${path}/data/kind` })); continue; }
    if (!text(data.title, 100) || !text(data.subtitle, 240)) issues.push(issue('node-config', 'NODE_LABEL_REQUIRED', '节点标题和说明不能为空', { nodeId: node.id }));
    if (data.status !== 'idle') issues.push(issue('node-config', 'NODE_STATUS_INVALID', 'AI 草案中的节点状态必须为 idle', { nodeId: node.id }));
    if (data.kind === 'http' && !constraints.allowHttp) issues.push(issue('permission', 'HTTP_NOT_AUTHORIZED', '用户尚未授权生成 HTTP 节点', { nodeId: node.id }));
    if (data.kind === 'code' && !constraints.allowCode) issues.push(issue('permission', 'CODE_NOT_AUTHORIZED', '用户尚未授权生成代码节点', { nodeId: node.id }));
    if (data.kind === 'llm' || data.kind === 'image') {
      const capability = data.kind === 'llm' ? 'chat' : 'image';
      const provider = providers.find((entry) => entry.id === data.providerId);
      if (!provider) issues.push(issue('provider', 'PROVIDER_NOT_FOUND', '节点引用了不存在的供应商', { nodeId: node.id }));
      else if (!Array.isArray(provider.models) || !provider.models.some((model) => model.id === data.model && model.capability === capability)) issues.push(issue('provider', 'MODEL_NOT_FOUND', '节点引用了该供应商未声明的模型', { nodeId: node.id }));
      if (data.kind === 'llm' && !text(data.prompt, 20_000)) issues.push(issue('node-config', 'PROMPT_REQUIRED', '大模型节点必须包含提示词', { nodeId: node.id }));
    }
    if (data.kind === 'condition' && !['contains', 'not_contains', 'equals', 'not_equals'].includes(data.conditionOperator)) issues.push(issue('node-config', 'CONDITION_OPERATOR_INVALID', '条件节点运算符无效', { nodeId: node.id }));
  }

  const edgeIds = new Set();
  const outgoing = new Map([...nodeIds].map((nodeId) => [nodeId, []]));
  const indegree = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));
  const conditionHandles = new Map();
  for (const [index, edge] of draft.edges.entries()) {
    const path = `/edges/${index}`;
    if (!edge || typeof edge !== 'object' || !nodeIdPattern.test(edge.id || '')) { issues.push(issue('schema', 'EDGE_ID_INVALID', '连接 ID 格式无效', { path: `${path}/id` })); continue; }
    if (edgeIds.has(edge.id)) issues.push(issue('graph', 'DUPLICATE_EDGE_ID', `连接 ID 重复：${edge.id}`));
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) { issues.push(issue('graph', 'DANGLING_EDGE', `连接 ${edge.id} 指向不存在的节点`, { path })); continue; }
    const sourceKind = nodeById.get(edge.source)?.data?.kind;
    if (sourceKind === 'condition' && !['true', 'false'].includes(edge.sourceHandle)) issues.push(issue('graph', 'CONDITION_HANDLE_INVALID', '条件节点连接必须指定 true 或 false 出口', { nodeId: edge.source }));
    else if (sourceKind === 'condition') conditionHandles.set(edge.source, new Set([...(conditionHandles.get(edge.source) || []), edge.sourceHandle]));
    if (sourceKind !== 'condition' && edge.sourceHandle != null) issues.push(issue('graph', 'UNEXPECTED_SOURCE_HANDLE', '非条件节点不能使用条件出口', { nodeId: edge.source }));
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
  }

  const starts = draft.nodes.filter((node) => node?.data?.kind === 'start');
  const outputs = draft.nodes.filter((node) => node?.data?.kind === 'output');
  if (starts.length !== 1) issues.push(issue('graph', 'START_COUNT_INVALID', '工作流必须且只能有一个开始节点'));
  if (!outputs.length) issues.push(issue('graph', 'OUTPUT_REQUIRED', '工作流至少需要一个结束节点'));
  starts.filter((node) => (indegree.get(node.id) || 0) > 0).forEach((node) => issues.push(issue('graph', 'START_HAS_INCOMING', '开始节点不能有入边', { nodeId: node.id })));
  outputs.filter((node) => (outgoing.get(node.id) || []).length > 0).forEach((node) => issues.push(issue('graph', 'OUTPUT_HAS_OUTGOING', '结束节点不能有出边', { nodeId: node.id })));
  draft.nodes.filter((node) => node?.data?.kind === 'condition').forEach((node) => {
    const handles = conditionHandles.get(node.id) || new Set();
    if (!handles.has('true') || !handles.has('false')) issues.push(issue('graph', 'CONDITION_BRANCH_INCOMPLETE', '条件节点必须同时连接 true 与 false 分支', { nodeId: node.id }));
  });

  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([nodeId]) => nodeId);
  let sorted = 0;
  while (queue.length) {
    const current = queue.shift();
    sorted += 1;
    for (const target of outgoing.get(current) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (sorted !== nodeIds.size) issues.push(issue('graph', 'CYCLE_DETECTED', '工作流包含环路'));

  if (starts.length === 1) {
    const reachable = new Set();
    const pending = [starts[0].id];
    while (pending.length) {
      const current = pending.shift();
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const target of outgoing.get(current) || []) pending.push(target);
    }
    draft.nodes.filter((node) => !reachable.has(node.id)).forEach((node) => issues.push(issue('graph', 'NODE_UNREACHABLE', '节点无法从开始节点到达', { nodeId: node.id })));
    outputs.filter((node) => !reachable.has(node.id)).forEach((node) => issues.push(issue('graph', 'OUTPUT_UNREACHABLE', '结束节点无法从开始节点到达', { nodeId: node.id })));
  }

  const modelCalls = draft.nodes.filter((node) => node?.data?.kind === 'llm').length;
  const imageCalls = draft.nodes.filter((node) => node?.data?.kind === 'image').reduce((total, node) => total + (Number.isInteger(node.data.imageCount) ? node.data.imageCount : 1), 0);
  if (modelCalls > constraints.maxModelCalls) issues.push(issue('budget', 'MODEL_CALL_BUDGET_EXCEEDED', `草案需要 ${modelCalls} 次文本模型调用，超过上限 ${constraints.maxModelCalls}`));
  if (imageCalls > constraints.maxImageCalls) issues.push(issue('budget', 'IMAGE_CALL_BUDGET_EXCEEDED', `草案最多生成 ${imageCalls} 张图片，超过上限 ${constraints.maxImageCalls}`));
  if (secretPattern.test(JSON.stringify(draft))) issues.push(issue('secret', 'SECRET_DETECTED', '工作流草案疑似包含 API Key 或 Bearer Token'));
  return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function validationReport(deterministic, criticIssues = [], repairAttempt = 0) {
  const normalizedCriticIssues = Array.isArray(criticIssues) ? criticIssues.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    return [issue('critic', text(entry.code, 100) || 'CRITIC_ISSUE', text(entry.message, 1_000) || '语义审查发现问题', {
      severity: entry.severity === 'warning' ? 'warning' : 'error',
      nodeId: text(entry.nodeId, 100),
      evidence: text(entry.evidence, 1_000),
      suggestedFix: text(entry.suggestedFix, 1_000)
    })];
  }) : [];
  const issues = [...deterministic.issues, ...normalizedCriticIssues];
  const deterministicPassed = deterministic.valid;
  const criticPassed = deterministicPassed && !normalizedCriticIssues.some((entry) => entry.severity === 'error');
  return { valid: deterministicPassed && criticPassed, deterministicPassed, criticPassed, repairAttempt, issues };
}

export function publicAssistantProviderCatalog(providers) {
  if (!Array.isArray(providers)) return [];
  return providers.flatMap((provider) => {
    if (!provider || typeof provider !== 'object' || !text(provider.id, 100)) return [];
    return [{ id: text(provider.id, 100), name: text(provider.name, 100), models: Array.isArray(provider.models) ? provider.models.flatMap((model) => model && typeof model === 'object' && text(model.id, 200) && ['chat', 'image'].includes(model.capability) ? [{ id: text(model.id, 200), capability: model.capability }] : []) : [] }];
  });
}
