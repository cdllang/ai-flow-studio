import fs from 'node:fs';
import path from 'node:path';

const requiredFile = (root, relativePath) => {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid system Skill path: ${relativePath}`);
  const content = fs.readFileSync(resolved, 'utf8').trim();
  if (!content || content.length > 80_000) throw new Error(`Invalid system Skill file: ${relativePath}`);
  return content;
};

export function loadWorkflowAssistantSkill(systemSkillsRoot) {
  const root = path.resolve(systemSkillsRoot, 'guard-workflow-intent');
  return Object.freeze({
    id: 'guard-workflow-intent',
    version: '1.0.0',
    builder: requiredFile(root, 'SKILL.md'),
    contracts: requiredFile(root, 'references/contracts.md'),
    critic: requiredFile(root, 'references/critic.md'),
    memory: requiredFile(root, 'references/session-memory.md')
  });
}
