# Workflow Assistant Contracts

Use these contracts as closed output interfaces. Do not add free-form fields outside `metadata`.

## TaskContract

```ts
type TaskContract = {
  objective: string;
  operation: 'create' | 'adjust' | 'repair' | 'explain';
  inScope: string[];
  outOfScope: string[];
  inputs: Array<{ name: string; type: 'text' | 'image' | 'file' | 'json'; required: boolean }>;
  outputs: Array<{ name: string; type: 'text' | 'image' | 'file' | 'json'; count?: number }>;
  constraints: {
    allowHttp: boolean;
    allowCode: boolean;
    maxModelCalls: number;
    maxImageCalls: number;
    costCeiling?: string;
    latencyCeiling?: string;
  };
  acceptanceCriteria: string[];
  assumptions: string[];
  unresolvedQuestions: string[];
};
```

The contract is ready only when `objective`, `inputs`, `outputs`, `outOfScope`, and `acceptanceCriteria` are explicit and `unresolvedQuestions` has no blocking item.

## Assistant turn

Return exactly one envelope:

```ts
type AssistantTurn = {
  status: 'needs_clarification' | 'draft_ready' | 'blocked' | 'cancelled';
  message: string;
  contract: TaskContract;
  questions: string[];
  draft?: WorkflowDraft;
  changeSet?: WorkflowChangeSet;
  validation?: ValidationReport;
};
```

`questions` must contain zero to three items. Only `draft_ready` may contain an applicable draft, and the surrounding application must still require user confirmation.

## Workflow draft

```ts
type WorkflowDraft = {
  schema: 'aiflow.workflow-draft';
  schemaVersion: 1;
  title: string;
  nodes: Array<{
    id: string;
    type: 'flowNode';
    position: { x: number; y: number };
    data: Record<string, unknown> & { kind: string; title: string; subtitle: string; status: 'idle' };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: 'true' | 'false';
  }>;
};
```

Use stable lowercase IDs. Allow only node kinds present in the runtime catalog. Never embed provider credentials. Provider and model references must point to catalog entries included by the application.

## Validation report

```ts
type ValidationIssue = {
  source: 'schema' | 'graph' | 'node-config' | 'provider' | 'permission' | 'secret' | 'budget' | 'critic';
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
  evidence?: string;
  suggestedFix?: string;
};

type ValidationReport = {
  valid: boolean;
  deterministicPassed: boolean;
  criticPassed: boolean;
  repairAttempt: number;
  issues: ValidationIssue[];
};
```

Any `error` makes the report invalid. Warnings remain visible in the confirmation preview.

## Allowed repair surface

Permit repairs only to workflow title, node positions, node non-secret configuration, prompts, output bindings, and edges. Reject patches that alter schema version, provider credentials, session security policy, approval state, validation results, or repair counters.
