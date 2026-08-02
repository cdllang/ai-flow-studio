import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { composeSkillInstructions, listPublicSkills, loadSkillRegistry, resolveLocalSkills, resolveSkills, SkillRegistryError } from '../skill-registry.mjs';

test('skill registry discovers versioned server-side skills without exposing instructions', () => {
  const registry = loadSkillRegistry(path.resolve('skills'));
  assert.deepEqual([...registry.keys()], ['gpt-image-2']);

  const publicSkills = listPublicSkills(registry);
  assert.deepEqual(publicSkills[0], {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    version: '1.0.0',
    description: '将自然语言需求整理为可直接交给 GPT Image 2 或兼容图像节点的高质量提示词。',
    category: 'image-prompting',
    mode: 'advisor',
    source: 'server',
    nodeKinds: ['llm']
  });
  assert.equal('instructions' in publicSkills[0], false);
});

test('selected skills compose after node instructions in stable order', () => {
  const registry = loadSkillRegistry(path.resolve('skills'));
  const selected = resolveSkills(['gpt-image-2', 'gpt-image-2'], registry, 'llm');
  assert.equal(selected.length, 1);

  const instructions = composeSkillInstructions('Preserve the brand voice.', selected);
  assert.match(instructions, /^Preserve the brand voice\./);
  assert.match(instructions, /<skill id="gpt-image-2" version="1\.0\.0" mode="advisor">/);
  assert.match(instructions, /下游“图像生成”节点/);
});

test('skill selection rejects malformed, unknown, or oversized lists', () => {
  const registry = loadSkillRegistry(path.resolve('skills'));
  assert.throws(() => resolveSkills('gpt-image-2', registry), SkillRegistryError);
  assert.throws(() => resolveSkills(['../escape'], registry), SkillRegistryError);
  assert.throws(() => resolveSkills(['missing-skill'], registry), /Skill not found/);
  assert.throws(() => resolveSkills(Array.from({ length: 9 }, () => 'gpt-image-2'), registry), /at most 8/);
});

test('request-local skills are validated and composed without entering the server registry', () => {
  const registry = loadSkillRegistry(path.resolve('skills'));
  const local = resolveLocalSkills([{
    id: 'local-brand-system',
    name: 'Brand system',
    version: 'local-1',
    description: 'User-owned brand instructions',
    category: 'custom',
    mode: 'advisor',
    nodeKinds: ['llm'],
    instructions: 'Use the exact local brand palette.'
  }], registry, 'llm');
  assert.equal(local[0].source, 'local');
  assert.equal(registry.has('local-brand-system'), false);
  assert.match(composeSkillInstructions('', local), /Use the exact local brand palette/);
  assert.throws(() => resolveLocalSkills([{ ...local[0], version: 'bad\"value' }], registry), /invalid version/);
});
