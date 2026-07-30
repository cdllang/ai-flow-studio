import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOutputBindings,
  createWorkflowExport,
  evaluateCondition,
  mergeOutputGroups,
  normalizeRuntimeOutputGroup,
  parseWorkflowExport,
  reachable,
  topologicalLayers,
  topologicalSort,
  validateWorkflowGraph,
  type WorkflowGraph
} from '../src/workflow/core.ts';

test('output bindings create stable business keys for copy and multiple images', () => {
  const group = normalizeRuntimeOutputGroup('end', 'Campaign assets', [
    { sourceNodeId: 'copy', sourceTitle: 'Copy', text: 'Summer launch' },
    { sourceNodeId: 'visual', sourceTitle: 'Visual', images: ['one.png', 'two.png'] }
  ]);
  const bound = applyOutputBindings(group, [
    { key: 'campaignCopy', label: 'Campaign copy', type: 'text', source: { nodeId: 'copy' } },
    { key: 'channelImage', label: 'Channel image', type: 'image', source: { nodeId: 'visual' } }
  ]);

  assert.deepEqual(bound.items.map((item) => [item.key, item.label]), [
    ['campaignCopy', 'Campaign copy'],
    ['channelImage[0]', 'Channel image 1'],
    ['channelImage[1]', 'Channel image 2']
  ]);
});

test('condition alternatives route live-stream and short-video requests', () => {
  assert.equal(evaluateCondition('周末直播活动', '直播|短视频', 'contains'), true);
  assert.equal(evaluateCondition('短视频封面', '直播|短视频', 'contains'), true);
  assert.equal(evaluateCondition('桌面端横幅', '直播|短视频', 'contains'), false);
  assert.equal(evaluateCondition('桌面端横幅', '直播|短视频', 'not_contains'), true);
});

const validGraph: WorkflowGraph = {
  nodes: [
    { id: 'start', data: { kind: 'start' } },
    { id: 'condition', data: { kind: 'condition' } },
    { id: 'copy', data: { kind: 'llm' } },
    { id: 'output', data: { kind: 'output' } }
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'condition' },
    { id: 'e2', source: 'condition', sourceHandle: 'true', target: 'copy' },
    { id: 'e3', source: 'copy', target: 'output' }
  ]
};

test('normalizeRuntimeOutputGroup preserves multiple text and three images in stable order', () => {
  const group = normalizeRuntimeOutputGroup('end-product', '商品发布素材', [
    {
      sourceNodeId: 'copy',
      sourceTitle: '商品文案',
      text: '主标题',
      texts: ['副标题', { name: '卖点', text: '轻巧耐用' }]
    },
    {
      sourceNodeId: 'visuals',
      sourceTitle: '渠道主图',
      image: 'https://cdn.example/one.png',
      images: [
        { url: 'https://cdn.example/two.png', name: '详情页竖图', aspectRatio: '3 / 4' },
        'https://cdn.example/three.png'
      ]
    }
  ]);

  assert.deepEqual(group.items.map((item) => item.type), ['text', 'text', 'text', 'image', 'image', 'image']);
  assert.deepEqual(group.items.map((item) => item.id), [
    'end-product:item:1',
    'end-product:item:2',
    'end-product:item:3',
    'end-product:item:4',
    'end-product:item:5',
    'end-product:item:6'
  ]);
  assert.equal(group.items[0].sourceNodeId, 'copy');
  assert.equal(group.items[4].sourceTitle, '渠道主图');
  assert.equal(group.items.filter((item) => item.type === 'image').length, 3);
});

test('normalizeRuntimeOutputGroup retains files and value with source metadata', () => {
  const group = normalizeRuntimeOutputGroup('end-data', '上架数据', [{
    sourceNodeId: 'aggregate',
    sourceTitle: '聚合商品资料',
    files: [{ url: '/exports/products.csv', name: 'products.csv', mimeType: 'text/csv', size: 512 }],
    value: { sku: 'SKU-1', ready: true }
  }]);

  assert.deepEqual(group.items.map((item) => item.type), ['file', 'json']);
  assert.ok(group.items.every((item) => item.sourceNodeId === 'aggregate'));
});

test('mergeOutputGroups keeps every end-node group instead of last-write-wins', () => {
  const first = normalizeRuntimeOutputGroup('end-copy', '文案输出', [{
    sourceNodeId: 'copy', sourceTitle: '文案', text: '商品标题'
  }]);
  const second = normalizeRuntimeOutputGroup('end-images', '图片输出', [{
    sourceNodeId: 'images', sourceTitle: '图片', images: ['/1.png', '/2.png', '/3.png']
  }]);

  const bundle = mergeOutputGroups(first, second);
  assert.equal(bundle.groups.length, 2);
  assert.deepEqual(bundle.groups.map((group) => group.id), ['end-copy', 'end-images']);
  assert.equal(bundle.groups.flatMap((group) => group.items).length, 4);

  first.items.length = 0;
  assert.equal(bundle.groups[0].items.length, 1, 'merged bundle must not alias mutable source groups');
});

test('graph helpers return stable topology and reachable nodes', () => {
  assert.deepEqual(topologicalSort(validGraph), ['start', 'condition', 'copy', 'output']);
  assert.deepEqual(topologicalLayers({
    nodes: [...validGraph.nodes, { id: 'parallel', data: { kind: 'llm' } }],
    edges: [...validGraph.edges, { id: 'e4', source: 'condition', sourceHandle: 'false', target: 'parallel' }]
  }), [['start'], ['condition'], ['copy', 'parallel'], ['output']]);
  assert.deepEqual(reachable(validGraph, 'start'), ['start', 'condition', 'copy', 'output']);
  assert.equal(validateWorkflowGraph(validGraph).valid, true);
});

test('graph validation reports duplicate ids, dangling edges, unreachable output, cycle, and condition handles', () => {
  const invalid: WorkflowGraph = {
    nodes: [
      { id: 'start', data: { kind: 'start' } },
      { id: 'start', data: { kind: 'llm' } },
      { id: 'condition', data: { kind: 'condition' } },
      { id: 'output', data: { kind: 'output' } },
      { id: 'cycle-a', data: { kind: 'code' } },
      { id: 'cycle-b', data: { kind: 'code' } }
    ],
    edges: [
      { id: 'duplicate-edge', source: 'start', target: 'condition' },
      { id: 'duplicate-edge', source: 'condition', target: 'missing' },
      { id: 'condition-without-handle', source: 'condition', target: 'cycle-a' },
      { id: 'cycle-1', source: 'cycle-a', target: 'cycle-b' },
      { id: 'cycle-2', source: 'cycle-b', target: 'cycle-a' }
    ]
  };

  const result = validateWorkflowGraph(invalid);
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert.equal(result.valid, false);
  assert.ok(codes.has('duplicate_node_id'));
  assert.ok(codes.has('duplicate_edge_id'));
  assert.ok(codes.has('dangling_edge'));
  assert.ok(codes.has('invalid_condition_handle'));
  assert.ok(codes.has('unreachable_output'));

  const cycleOnly: WorkflowGraph = {
    nodes: [
      { id: 'start', kind: 'start' },
      { id: 'a', kind: 'code' },
      { id: 'output', kind: 'output' }
    ],
    edges: [
      { source: 'start', target: 'a' },
      { source: 'a', target: 'output' },
      { source: 'output', target: 'a' }
    ]
  };
  assert.ok(validateWorkflowGraph(cycleOnly).issues.some((issue) => issue.code === 'cycle'));
});

test('workflow export round-trips graph and all output groups without shared references', () => {
  const outputs = mergeOutputGroups(
    normalizeRuntimeOutputGroup('end-copy', '文案', [{
      sourceNodeId: 'copy', sourceTitle: '文案节点', texts: ['标题', '正文']
    }]),
    normalizeRuntimeOutputGroup('end-images', '图片', [{
      sourceNodeId: 'visuals', sourceTitle: '图片节点', images: ['/one.png', '/two.png', '/three.png']
    }])
  );
  const timestamp = '2026-07-30T00:00:00.000Z';
  const serialized = createWorkflowExport(validGraph, outputs, timestamp);
  const restored = parseWorkflowExport(serialized);

  assert.equal(restored.exportedAt, timestamp);
  assert.deepEqual(restored.workflow, validGraph);
  assert.deepEqual(restored.outputs, outputs);
  restored.workflow.nodes[0].id = 'changed';
  assert.equal(validGraph.nodes[0].id, 'start');
});

test('parseWorkflowExport rejects invalid JSON and unsupported schemas', () => {
  assert.throws(() => parseWorkflowExport('{'), /valid JSON/);
  assert.throws(
    () => parseWorkflowExport(JSON.stringify({ schema: 'other', schemaVersion: 1, workflow: validGraph })),
    /Unsupported/
  );
});
