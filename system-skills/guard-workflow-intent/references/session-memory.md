# Session Memory and Compression

Keep workflow assistance as a durable session while minimizing model context.

## Durable state

Preserve these fields outside the raw transcript:

```ts
type WorkflowAssistantSession = {
  id: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  phase: 'discovery' | 'drafting' | 'validating' | 'repairing' | 'awaiting_confirmation' | 'applied' | 'blocked';
  providerId: string;
  modelId: string;
  contract: TaskContract;
  summary: SessionSummary;
  recentTurns: SessionTurn[];
  currentWorkflowRevision: string;
  candidateDraft?: WorkflowDraft;
  validation?: ValidationReport;
  repairAttempt: number;
};
```

Store the session in the browser for the local-first deployment. Send only the active session snapshot to the gateway. The gateway must not persist transcripts, local Skills, or API keys.

## Compression trigger

Estimate tokens before every model call. Compress when the assembled context reaches 70% of the selected model context window or when more than 12 raw turns exist. Never wait for a provider context-length error.

## Compression algorithm

1. Keep the system Skill, current contract, latest workflow revision, candidate draft, validation issues, unresolved questions, and last six turns verbatim.
2. Summarize older turns into a structured `SessionSummary` with confirmed decisions, rejected alternatives, assumptions, pending questions, applied revisions, and stable user terminology.
3. Require every summary fact to cite the source turn IDs.
4. Replace only the summarized raw turns after the summary passes integrity checks.
5. Never compress secrets into the summary. Redact API keys before any model call.

## Integrity checks

Reject a compressed summary if it drops a confirmed acceptance criterion, changes an authorization boundary, revives a rejected option, loses an unresolved question, or claims a draft was applied without a recorded user-confirmation event. On rejection, retain the prior summary and fewer raw turns, then ask the model to recompress once. If it fails again, stop and ask the user to start a new session or manually archive history.
