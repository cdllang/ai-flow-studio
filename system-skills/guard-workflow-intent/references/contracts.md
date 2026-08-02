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

The contract is ready for graph generation when `objective`, `inputs`, and `outputs` are explicit, the current input/output signature has been confirmed by the user, and `unresolvedQuestions` is empty. `outOfScope`, `acceptanceCriteria`, permissions, and budgets are inferred with safe defaults and remain visible for audit, but are not user-confirmation questions.

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

`questions` must contain zero or one item. The only clarification turn allowed is a yes/no confirmation summarizing the inferred input ports and output ports; the user's structured `confirmation` object is authoritative for that question. An Other answer updates the ports and requires a new confirmation. Only `draft_ready` may contain an applicable draft, and the surrounding application must still require user confirmation.

## Workflow draft

```ts
type WorkflowDraft = {
  schema: 'aiflow.workflow-draft';
  schemaVersion: 1;
  title: string;
  plan: {
    schema: 'aiflow.workflow-plan';
    schemaVersion: 1;
    summary: string;
    steps: Array<{
      id: string;
      kind: 'start' | 'llm' | 'image' | 'condition' | 'http' | 'code' | 'aggregate' | 'output';
      title: string;
      purpose: string;
      inputs: string[];
      outputs: string[];
    }>;
    connections: Array<{
      id: string;
      source: string;
      target: string;
      reason: string;
      dataType: 'text' | 'image' | 'file' | 'json' | 'mixed';
      sourceHandle?: 'true' | 'false';
    }>;
  };
  nodes: Array<{
    id: string;
    type: 'flowNode';
    position?: { x: number; y: number };
    data: Record<string, unknown> & { kind: string; title: string; subtitle: string; status: 'idle' };
  }>;
  edges?: never;
};
```

`plan` is the only graph definition. The application derives the flowchart, explanation, layout, canvas nodes, and every canvas edge from it. The `nodes` array supplies runtime configuration for exactly the step IDs in `plan.steps`; positions are ignored. Do not return `edges` because the application compiles them exclusively from `plan.connections`.

Use stable lowercase IDs. Every step requires a purpose plus explicit input/output descriptions. Every connection requires a reason and data type. Do not add a direct connection when the same dependency already travels through an existing path. Ordinary processing nodes have one primary upstream; use an aggregate node for fan-in. Allow only node kinds present in the runtime catalog. Never embed provider credentials. Provider and model references must point to catalog entries included by the application.

## Validation report

```ts
type ValidationIssue = {
  source: 'schema' | 'plan' | 'graph' | 'node-config' | 'provider' | 'permission' | 'secret' | 'budget' | 'critic';
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
