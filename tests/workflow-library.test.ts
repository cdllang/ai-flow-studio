import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloneWorkflowLibraryDefinition,
  createWorkflowLibraryItem,
  markWorkflowLibraryRun,
  normalizeWorkflowLibrary,
  upsertWorkflowLibraryItem
} from '../src/workflow/library.ts';

const timestamp = '2026-08-09T12:00:00.000Z';

test('normalizes valid workflow library records and rejects malformed entries', () => {
  const valid = createWorkflowLibraryItem({
    id: 'workflow-1',
    title: ' 内容生产 ',
    description: '已调试流程',
    input: '主题',
    nodes: [{ id: 'start' }],
    edges: [],
    runCount: 2
  }, timestamp);

  const normalized = normalizeWorkflowLibrary([valid, { id: 'broken' }, null]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.title, '内容生产');
  assert.equal(normalized[0]?.runCount, 2);
});

test('upserts by id and keeps the most recently updated workflow first', () => {
  const old = createWorkflowLibraryItem({ id: 'old', title: '旧流程', description: '旧', input: '', nodes: [], edges: [] }, '2026-08-08T12:00:00.000Z');
  const current = createWorkflowLibraryItem({ id: 'current', title: '当前流程', description: '新', input: '', nodes: [], edges: [] }, timestamp);
  const updated = createWorkflowLibraryItem({ ...old, title: '已更新', updatedAt: '2026-08-10T12:00:00.000Z' });

  const result = upsertWorkflowLibraryItem([current, old], updated);
  assert.deepEqual(result.map((item) => item.id), ['old', 'current']);
  assert.equal(result[0]?.title, '已更新');
});

test('tracks read-only runs without changing the stored workflow definition', () => {
  const item = createWorkflowLibraryItem({ id: 'workflow-1', title: '流程', description: '说明', input: '输入', nodes: [{ data: { status: 'idle' } }], edges: [] }, timestamp);
  const definition = cloneWorkflowLibraryDefinition(item);
  definition.nodes[0]!.data.status = 'running';
  const tracked = markWorkflowLibraryRun([item], item.id, '2026-08-09T12:05:00.000Z');

  assert.equal(item.nodes[0]!.data.status, 'idle');
  assert.equal(tracked[0]?.runCount, 1);
  assert.equal(tracked[0]?.lastRunAt, '2026-08-09T12:05:00.000Z');
});
