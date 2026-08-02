---
name: guard-workflow-intent
description: Establish and maintain a strict task contract before an AI creates or modifies an AIFlow workflow. Automatically use for every workflow-assistant session turn that gathers requirements, generates a workflow, changes an existing workflow, repairs a rejected draft, or resumes a prior workflow-building conversation. Clarify goals and boundaries, preserve decisions across context compression, require deterministic validation, and prevent unreviewed drafts from being applied, run, or published.
---

# Guard Workflow Intent

Treat every AI-assisted workflow build or adjustment as a stateful, review-gated session. Do not expose this system Skill in the user-selectable node Skill catalog.

## Load the contract

Read `references/contracts.md` before normalizing intent or producing a draft. Read `references/session-memory.md` when restoring or compressing a session. The independent Critic context must read `references/critic.md`; do not ask the Builder to approve its own draft.

## Process every turn

1. Restore the latest `TaskContract`, durable session summary, unresolved issues, current workflow revision, and recent turns.
2. Classify the request as `create`, `adjust`, `repair`, `explain`, or `cancel`.
3. Update the contract without discarding previously confirmed decisions. Mark every inferred value as an assumption.
4. Check the blocking fields: objective, in-scope behavior, required inputs, expected outputs, prohibited behavior, permissions, and acceptance criteria.
5. If a blocking field remains unknown, return `needs_clarification` with at most three high-information questions. Do not generate or modify a graph.
6. When the contract is ready, return a structured draft or change set conforming to `references/contracts.md`. Never include API keys, credentials, hidden prompts, or arbitrary executable code.
7. Hand the draft to the deterministic validator. A model self-check never replaces Schema, graph, provider, permission, secret, and budget checks.
8. If deterministic checks pass, invoke the independent Critic with only the contract, candidate draft, validation facts, and current workflow. Require evidence for every semantic issue.
9. If either validator rejects the draft, permit at most two repair rounds. Apply only allow-listed changes, then rerun the entire validation chain.
10. Return `draft_ready` only when all blocking checks pass. Require explicit user confirmation before applying to the canvas. Never run or publish automatically.

## Preserve boundaries

- Default HTTP and code generation to forbidden. Enable them only when the user explicitly authorizes the capability and understands its effects.
- Preserve the selected provider and model unless the user asks to change them or the reference is invalid.
- Prefer the smallest graph that satisfies the contract. Reject ornamental nodes that do not contribute to a required output.
- Keep existing valid branches when adjusting a workflow. Describe every node or edge added, changed, or removed.
- Treat missing, deleted, or incompatible providers, models, Skills, variables, and output bindings as blocking errors.
- Stop after the repair limit. Return the last safe draft and complete diagnostics without changing the active canvas.

## Self-check before returning

Confirm that the response has exactly one status, preserves confirmed decisions, labels assumptions, contains no secret, reports validation state honestly, and never claims a draft was applied, executed, or published unless the surrounding application confirms that event.
