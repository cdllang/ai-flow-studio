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
  source: 'schema' | 'graph' | 'node-config' | 'provider' | 'permission' | 'secret' | 'budget' | 'critic';
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

export type WorkflowAssistantDraft = {
  schema: 'aiflow.workflow-draft';
  schemaVersion: 1;
  title: string;
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
    repairAttempt: 0
  };
}

export function normalizeStoredAssistantSession(value: unknown): WorkflowAssistantSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<WorkflowAssistantSession>;
  if (candidate.version !== 1 || typeof candidate.id !== 'string' || !Array.isArray(candidate.recentTurns) || !candidate.contract) return null;
  const phase = ['discovery', 'drafting', 'validating', 'repairing', 'awaiting_confirmation', 'applied', 'blocked'].includes(String(candidate.phase)) ? candidate.phase! : 'discovery';
  return {
    ...createWorkflowAssistantSession(),
    ...candidate,
    version: 1,
    phase,
    providerId: typeof candidate.providerId === 'string' ? candidate.providerId : '',
    modelId: typeof candidate.modelId === 'string' ? candidate.modelId : '',
    recentTurns: candidate.recentTurns.filter((turn): turn is AssistantTurn => Boolean(turn && ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string')).slice(-40),
    contract: { ...emptyContract(), ...candidate.contract, constraints: { ...emptyContract().constraints, ...candidate.contract.constraints } },
    summary: candidate.summary && typeof candidate.summary === 'object' ? candidate.summary : { sourceTurnIds: [] },
    repairAttempt: Number.isInteger(candidate.repairAttempt) ? Math.max(0, Math.min(candidate.repairAttempt!, 2)) : 0
  } as WorkflowAssistantSession;
}

export function loadStoredAssistantSession(): WorkflowAssistantSession | null {
  try { return normalizeStoredAssistantSession(JSON.parse(localStorage.getItem(assistantSessionStorageKey) || 'null')); } catch { return null; }
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
