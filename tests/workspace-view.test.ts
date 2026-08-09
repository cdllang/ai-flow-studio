import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canShowWorkflowWorkspaceNavigation,
  canUseWorkflowAssistant,
  workspaceViews
} from '../src/workspaceView.ts';

test('AI workflow assistant is available only in the orchestration view', () => {
  assert.equal(canUseWorkflowAssistant('editor'), true);

  for (const view of workspaceViews.filter((candidate) => candidate !== 'editor')) {
    assert.equal(canUseWorkflowAssistant(view), false, `assistant must be unavailable in ${view}`);
  }
});

test('workflow navigation belongs to the editor workspace, not the standalone library or runner', () => {
  assert.equal(canShowWorkflowWorkspaceNavigation('library'), false);
  assert.equal(canShowWorkflowWorkspaceNavigation('runner'), false);

  for (const view of ['editor', 'models', 'skills', 'runs', 'versions'] as const) {
    assert.equal(canShowWorkflowWorkspaceNavigation(view), true, `workflow navigation must be available in ${view}`);
  }
});
