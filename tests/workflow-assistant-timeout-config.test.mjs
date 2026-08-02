import assert from 'node:assert/strict';
import test from 'node:test';
import * as assistantCore from '../workflow-assistant-core.mjs';

test('workflow assistant defaults to a five minute model timeout while keeping bounded overrides', () => {
  assert.equal(typeof assistantCore.resolveAssistantModelTimeout, 'function');
  assert.equal(assistantCore.resolveAssistantModelTimeout(undefined), 300_000);
  assert.equal(assistantCore.resolveAssistantModelTimeout('600000'), 600_000);
  assert.equal(assistantCore.resolveAssistantModelTimeout('1000'), 30_000);
  assert.equal(assistantCore.resolveAssistantModelTimeout('9999999'), 900_000);
  assert.equal(assistantCore.resolveAssistantModelTimeout('30', { isTest: true }), 30);
});
