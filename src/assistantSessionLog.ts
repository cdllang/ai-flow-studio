import type { AssistantStage, WorkflowAssistantSession } from './assistantSession';

type AssistantSessionLogInput = {
  session: WorkflowAssistantSession;
  stages: readonly AssistantStage[];
  currentWorkflow: unknown;
  currentWorkflowRevision: string;
  runtime: {
    sending: boolean;
    elapsedSeconds: number;
    error: string;
    errorCode: string;
    errorRequestId: string;
    composerDraft: string;
    pendingAttempt: unknown;
    builder: { providerId: string; providerName: string; modelId: string } | null;
    critic: { providerId: string; providerName: string; modelId: string } | null;
  };
  generatedAt?: string;
};

const sensitiveKey = /(?:api[-_]?key|authorization|token|secret|password|credential|cookie)/i;

function redactString(value: string) {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED]');
}

function redactSensitiveValues(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValues(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : redactSensitiveValues(item, seen)
  ]));
}

const asJson = (value: unknown) => JSON.stringify(redactSensitiveValues(value), null, 2);

export function assistantSessionLogFilename(sessionId: string) {
  const safeId = sessionId.replace(/[^a-z0-9_-]/gi, '-').slice(-48) || 'unknown';
  return `aiflow-session-${safeId}.session.log`;
}

export function buildAssistantSessionLog({ session, stages, currentWorkflow, currentWorkflowRevision, runtime, generatedAt = new Date().toISOString() }: AssistantSessionLogInput) {
  const completedStages = stages.filter((stage) => stage.status === 'success').length;
  const header = [
    'AI FLOW STUDIO - WORKFLOW ASSISTANT SESSION LOG',
    `generatedAt=${generatedAt}`,
    `sessionId=${session.id}`,
    `phase=${session.phase}`,
    `sessionCreatedAt=${session.createdAt}`,
    `sessionUpdatedAt=${session.updatedAt}`,
    `currentWorkflowRevision=${currentWorkflowRevision}`,
    `runtime=${runtime.sending ? 'running' : 'idle'}`,
    `elapsedSeconds=${runtime.elapsedSeconds}`,
    `stageProgress=${completedStages}/${stages.length}`
  ];
  return [
    ...header,
    '',
    '--- SESSION STATE ---',
    asJson(session),
    '',
    '--- TURN STAGES ---',
    asJson(stages),
    '',
    '--- RUNTIME STATE ---',
    asJson(runtime),
    '',
    '--- CURRENT WORKFLOW SNAPSHOT ---',
    asJson(currentWorkflow),
    ''
  ].join('\n');
}
