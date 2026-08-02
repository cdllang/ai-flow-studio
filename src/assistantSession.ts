import type { ModelProvider } from './providerConfig';

export const assistantSessionStorageKey = 'aiflow.demo.workflow-assistant-session';

export type AssistantPort = { name: string; type: 'text' | 'image' | 'file' | 'json'; required?: boolean; count?: number };
export type TaskContract = {
  objective: string;
  operation: 'create' | 'adjust' | 'repair' | 'explain';
  inScope: string[];
  outOfScope: string[];
  inputs: AssistantPort[];
  outputs: AssistantPort[];
  constraints: { allowHttp: boolean; allowCode: boolean; maxModelCalls: number; maxImageCalls: number; costCeiling?: string; latencyCeiling?: string };
  acceptanceCriteria: string[];
  assumptions: string[];
  unresolvedQuestions: string[];
};

export type AssistantTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'needs_clarification' | 'draft_ready' | 'blocked' | 'cancelled';
};

export type ValidationIssue = {
  source: 'schema' | 'plan' | 'graph' | 'node-config' | 'provider' | 'permission' | 'secret' | 'budget' | 'critic';
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
  evidence?: string;
  suggestedFix?: string;
};

export type ValidationReport = {
  valid: boolean;
  deterministicPassed: boolean;
  criticPassed: boolean;
  repairAttempt: number;
  issues: ValidationIssue[];
};

export type WorkflowPlanStep = {
  id: string;
  kind: 'start' | 'llm' | 'image' | 'condition' | 'http' | 'code' | 'aggregate' | 'output';
  title: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
};

export type WorkflowPlanConnection = {
  id: string;
  source: string;
  target: string;
  reason: string;
  dataType: 'text' | 'image' | 'file' | 'json' | 'mixed';
  sourceHandle?: 'true' | 'false';
};

export type WorkflowPlan = {
  schema: 'aiflow.workflow-plan';
  schemaVersion: 1;
  summary: string;
  steps: WorkflowPlanStep[];
  connections: WorkflowPlanConnection[];
};

export type WorkflowAssistantDraft = {
  schema: 'aiflow.workflow-draft';
  schemaVersion: 1;
  title: string;
  plan: WorkflowPlan;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

export type WorkflowAssistantSession = {
  id: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  phase: 'discovery' | 'drafting' | 'validating' | 'repairing' | 'awaiting_confirmation' | 'applied' | 'blocked';
  providerId: string;
  modelId: string;
  contract: TaskContract;
  summary: Record<string, unknown> & { sourceTurnIds?: string[] };
  recentTurns: AssistantTurn[];
  currentWorkflowRevision: string;
  confirmedInputOutputSignature: string;
  candidateDraft?: WorkflowAssistantDraft;
  validation?: ValidationReport;
  repairAttempt: number;
};

export type AssistantStage = { stage: string; status: 'running' | 'success' | 'error'; detail: string };

export type WorkflowAssistantResponse = {
  schemaVersion: 1;
  response: {
    status: 'needs_clarification' | 'draft_ready' | 'blocked' | 'cancelled';
    message: string;
    contract: TaskContract;
    questions: string[];
    draft?: WorkflowAssistantDraft;
    validation?: ValidationReport;
  };
  session: WorkflowAssistantSession;
  stages: AssistantStage[];
  compression: { attempted: boolean; compressed: boolean; estimatedTokens: number; threshold: number; sourceTurns?: number; retainedTurns?: number };
  systemSkill: { id: string; version: string; autoApplied: boolean };
  requestId: string;
};

const emptyContract = (): TaskContract => ({
  objective: '', operation: 'create', inScope: [], outOfScope: [], inputs: [], outputs: [],
  constraints: { allowHttp: false, allowCode: false, maxModelCalls: 8, maxImageCalls: 4 },
  acceptanceCriteria: [], assumptions: [], unresolvedQuestions: []
});

export function createWorkflowAssistantSession(providerId = '', modelId = ''): WorkflowAssistantSession {
  const now = new Date().toISOString();
  return {
    id: `was_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    phase: 'discovery',
    providerId,
    modelId,
    contract: emptyContract(),
    summary: { sourceTurnIds: [] },
    recentTurns: [],
    currentWorkflowRevision: '',
    confirmedInputOutputSignature: '',
    repairAttempt: 0
  };
}

export function normalizeStoredAssistantSession(value: unknown): WorkflowAssistantSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<WorkflowAssistantSession>;
  if (candidate.version !== 1 || typeof candidate.id !== 'string' || !Array.isArray(candidate.recentTurns) || !candidate.contract) return null;
  const phase = ['discovery', 'drafting', 'validating', 'repairing', 'awaiting_confirmation', 'applied', 'blocked'].includes(String(candidate.phase)) ? candidate.phase! : 'discovery';
  const normalized = {
    ...createWorkflowAssistantSession(),
    ...candidate,
    version: 1,
    phase,
    providerId: typeof candidate.providerId === 'string' ? candidate.providerId : '',
    modelId: typeof candidate.modelId === 'string' ? candidate.modelId : '',
    confirmedInputOutputSignature: typeof candidate.confirmedInputOutputSignature === 'string' ? candidate.confirmedInputOutputSignature : '',
    recentTurns: candidate.recentTurns.filter((turn): turn is AssistantTurn => Boolean(turn && ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string')).slice(-40),
    contract: { ...emptyContract(), ...candidate.contract, constraints: { ...emptyContract().constraints, ...candidate.contract.constraints } },
    summary: candidate.summary && typeof candidate.summary === 'object' ? candidate.summary : { sourceTurnIds: [] },
    repairAttempt: Number.isInteger(candidate.repairAttempt) ? Math.max(0, Math.min(candidate.repairAttempt!, 2)) : 0
  } as WorkflowAssistantSession;
  if (normalized.candidateDraft && normalized.candidateDraft.plan?.schema !== 'aiflow.workflow-plan') {
    delete normalized.candidateDraft;
    delete normalized.validation;
    normalized.phase = 'discovery';
  }
  return normalized;
}

export function loadStoredAssistantSession(): WorkflowAssistantSession | null {
  try { return normalizeStoredAssistantSession(JSON.parse(localStorage.getItem(assistantSessionStorageKey) || 'null')); } catch { return null; }
}

export function validateAssistantDraftPlanParity(draft: WorkflowAssistantDraft): string | null {
  const plan = draft.plan;
  if (!plan || plan.schema !== 'aiflow.workflow-plan' || plan.schemaVersion !== 1 || !Array.isArray(plan.steps) || !Array.isArray(plan.connections)) return '候选草案缺少可验证的流程定义';
  const nodeSignatures = new Set(draft.nodes.map((node) => {
    const candidate = node as { id?: unknown; data?: { kind?: unknown } };
    return `${String(candidate.id || '')}::${String(candidate.data?.kind || '')}`;
  }));
  const stepSignatures = new Set(plan.steps.map((step) => `${step.id}::${step.kind}`));
  if (nodeSignatures.size !== draft.nodes.length || stepSignatures.size !== plan.steps.length) return '流程图或画布包含重复节点';
  if (nodeSignatures.size !== stepSignatures.size || [...stepSignatures].some((signature) => !nodeSignatures.has(signature))) return '画布节点与流程图步骤不一致';
  const edgeSignatures = new Set(draft.edges.map((edge) => {
    const candidate = edge as { source?: unknown; target?: unknown; sourceHandle?: unknown };
    return `${String(candidate.source || '')}::${String(candidate.target || '')}::${String(candidate.sourceHandle || '')}`;
  }));
  const connectionSignatures = new Set(plan.connections.map((connection) => `${connection.source}::${connection.target}::${connection.sourceHandle || ''}`));
  if (edgeSignatures.size !== draft.edges.length || connectionSignatures.size !== plan.connections.length) return '流程图或画布包含重复连线';
  if (edgeSignatures.size !== connectionSignatures.size || [...connectionSignatures].some((signature) => !edgeSignatures.has(signature))) return '画布连线与流程图连接不一致';
  return null;
}

export function workflowRevision(workflow: unknown) {
  const value = JSON.stringify(workflow);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function assistantProviderCatalog(providers: readonly ModelProvider[]) {
  return providers.map((provider) => ({ id: provider.id, name: provider.name, models: provider.models.map((model) => ({ id: model.id, capability: model.capability })) }));
}
