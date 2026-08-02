import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalSkill, localSkillRequest, normalizeLocalSkillStore, normalizeServerSkillCatalog, validateLocalSkill } from '../src/skillConfig.ts';

test('local skill store keeps valid browser-only definitions and removes invalid entries', () => {
  const skill = { ...createLocalSkill(), id: 'local-brand-voice', name: '品牌视觉', description: '将品牌规范转换为图像提示词', instructions: '保持克制、专业，并输出完整图像提示词。' };
  assert.equal(validateLocalSkill(skill), null);
  const normalized = normalizeLocalSkillStore({ schemaVersion: 1, skills: [skill, skill, { ...skill, id: '../escape' }] });
  assert.deepEqual(normalized, [skill]);
});

test('local skill request omits browser storage metadata', () => {
  const skill = { ...createLocalSkill(), id: 'local-product-photo', name: '产品摄影', description: '产品摄影提示词', instructions: '输出商业产品摄影提示词。' };
  const request = localSkillRequest(skill);
  assert.equal('source' in request, false);
  assert.equal(request.instructions, skill.instructions);
});

test('server skill catalog is normalized as read-only metadata', () => {
  const skills = normalizeServerSkillCatalog({ skills: [{ id: 'gpt-image-2', name: 'GPT Image 2', version: '1.0.0', description: 'Prompt advisor', category: 'image-prompting', mode: 'advisor', nodeKinds: ['llm'], instructions: 'must not leak' }] });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].source, 'server');
  assert.equal('instructions' in skills[0], false);
});
