import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ecommerceWorkflowPresets,
  instantiatePreset,
  type WorkflowPreset
} from '../src/workflow/presets.ts';

function validateBasicGraph(preset: WorkflowPreset) {
  const nodeIds = new Set(preset.nodes.map((node) => node.id));
  const edgeIds = new Set(preset.edges.map((edge) => edge.id));

  assert.equal(nodeIds.size, preset.nodes.length);
  assert.equal(edgeIds.size, preset.edges.length);
  assert.equal(preset.nodes.filter((node) => node.data.kind === 'start').length, 1);
  assert.ok(preset.nodes.filter((node) => node.data.kind === 'output').length >= 1);
  assert.ok(preset.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
  assert.ok(preset.expectedOutputs.every((output) => nodeIds.has(output.sourceNodeId)));

  const start = preset.nodes.find((node) => node.data.kind === 'start')!;
  const reachable = new Set<string>();
  const queue = [start.id];
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    preset.edges.filter((edge) => edge.source === current).forEach((edge) => queue.push(edge.target));
  }
  assert.equal(reachable.size, preset.nodes.length);

  const indegree = new Map(preset.nodes.map((node) => [node.id, 0]));
  preset.edges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1));
  const ready = preset.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (ready.length) {
    const current = ready.shift()!;
    visited += 1;
    preset.edges.filter((edge) => edge.source === current).forEach((edge) => {
      const next = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, next);
      if (next === 0) ready.push(edge.target);
    });
  }
  assert.equal(visited, preset.nodes.length);
}

describe('ecommerce workflow presets', () => {
  it('provides at least four complete, data-only ecommerce workflows', () => {
    assert.ok(ecommerceWorkflowPresets.length >= 4);
    ecommerceWorkflowPresets.forEach((preset) => {
      assert.ok(preset.id);
      assert.ok(preset.version > 0);
      assert.ok(preset.name);
      assert.ok(preset.description);
      assert.ok(preset.category);
      assert.ok(preset.tags.length > 0);
      assert.ok(preset.sampleInput);
      assert.ok(preset.expectedOutputs.length > 0);
      validateBasicGraph(preset);
    });
  });

  it('creates isolated instances without mutating the source preset', () => {
    const preset = ecommerceWorkflowPresets[0];
    const original = JSON.stringify(preset);
    let firstSequence = 0;
    let secondSequence = 0;
    const first = instantiatePreset(preset, () => `first-${++firstSequence}`);
    const second = instantiatePreset(preset, () => `second-${++secondSequence}`);

    assert.equal(JSON.stringify(preset), original);
    assert.notStrictEqual(first.nodes, preset.nodes);
    assert.notStrictEqual(first.edges, preset.edges);
    const firstNodeIds = new Set(first.nodes.map((node) => node.id));
    const secondNodeIds = new Set(second.nodes.map((node) => node.id));
    const firstEdgeIds = new Set(first.edges.map((edge) => edge.id));
    const secondEdgeIds = new Set(second.edges.map((edge) => edge.id));
    assert.ok([...firstNodeIds].every((id) => !secondNodeIds.has(id)));
    assert.ok([...firstEdgeIds].every((id) => !secondEdgeIds.has(id)));
    assert.ok(first.nodes.every((node) => node.data.status === undefined));
    validateBasicGraph(first);
    validateBasicGraph(second);
  });

  it('remaps output bindings and preserves conditional source handles', () => {
    const preset = ecommerceWorkflowPresets.find((item) => item.id === 'ecommerce-event-channel-router')!;
    let sequence = 0;
    const instance = instantiatePreset(preset, () => `conditional-${++sequence}`);
    const handles = instance.edges.map((edge) => edge.sourceHandle).filter(Boolean).sort();
    const nodeIds = new Set(instance.nodes.map((node) => node.id));
    const outputNode = instance.nodes.find((node) => node.data.kind === 'output')!;
    const bindings = outputNode.data.bindings as Array<{ source: { nodeId: string } }>;

    assert.deepEqual(handles, ['false', 'true']);
    assert.ok(bindings.every((item) => nodeIds.has(item.source.nodeId)));
    assert.ok(instance.expectedOutputs.every((output) => nodeIds.has(output.sourceNodeId)));
  });

  it('defines 1:1, 3:4 and 9:16 image branches for the multichannel preset', () => {
    const preset = ecommerceWorkflowPresets.find((item) => item.id === 'ecommerce-multichannel-campaign')!;
    const imageSizes = preset.nodes
      .filter((node) => node.data.kind === 'image')
      .map((node) => node.data.imageSize)
      .sort();

    assert.deepEqual(imageSizes, ['1024x1024', '1152x1536', '864x1536'].sort());
    assert.equal(preset.expectedOutputs.filter((output) => output.type === 'image').length, 3);
  });
});
