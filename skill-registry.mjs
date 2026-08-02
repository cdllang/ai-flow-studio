import fs from 'node:fs';
import path from 'node:path';

const skillIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const localSkillIdPattern = /^local-[a-z0-9][a-z0-9-]{0,55}$/;
const versionPattern = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;
const metadataTokenPattern = /^[a-z][a-z0-9-]{0,63}$/;
const supportedNodeKinds = new Set(['llm']);

export class SkillRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SkillRegistryError';
    this.code = 'SKILL_CONFIG_INVALID';
  }
}

const requiredText = (value, field, maxLength) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new SkillRegistryError(`Skill ${field} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
};

const safeInstructionPath = (skillDirectory, filename) => {
  const relativeName = requiredText(filename, 'instructions', 160);
  const resolved = path.resolve(skillDirectory, relativeName);
  const relative = path.relative(skillDirectory, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SkillRegistryError('Skill instructions must resolve to a file inside its skill directory');
  }
  return resolved;
};

const parseManifest = (skillDirectory, directoryName) => {
  const manifestPath = path.join(skillDirectory, 'skill.json');
  if (!fs.existsSync(manifestPath)) throw new SkillRegistryError(`Missing skill.json for ${directoryName}`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new SkillRegistryError(`Invalid skill.json for ${directoryName}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const id = requiredText(manifest.id, 'id', 64);
  if (!skillIdPattern.test(id) || id !== directoryName) {
    throw new SkillRegistryError(`Skill id ${id} must match its directory and use lowercase letters, digits, or hyphens`);
  }
  const version = requiredText(manifest.version, 'version', 32);
  if (!versionPattern.test(version)) throw new SkillRegistryError(`Skill ${id} has an invalid version`);
  if (!Array.isArray(manifest.nodeKinds) || manifest.nodeKinds.length === 0 || manifest.nodeKinds.some((kind) => !supportedNodeKinds.has(kind))) {
    throw new SkillRegistryError(`Skill ${id} must declare supported nodeKinds`);
  }

  const instructionsPath = safeInstructionPath(skillDirectory, manifest.instructions);
  if (!fs.existsSync(instructionsPath) || !fs.statSync(instructionsPath).isFile()) {
    throw new SkillRegistryError(`Skill ${id} instructions file is missing`);
  }
  const instructions = fs.readFileSync(instructionsPath, 'utf8').trim();
  if (!instructions || instructions.length > 40_000) {
    throw new SkillRegistryError(`Skill ${id} instructions must contain 1-40000 characters`);
  }

  const category = requiredText(manifest.category, 'category', 64);
  const mode = requiredText(manifest.mode, 'mode', 32);
  if (!metadataTokenPattern.test(category) || !metadataTokenPattern.test(mode)) throw new SkillRegistryError(`Skill ${id} has invalid category or mode metadata`);
  return Object.freeze({
    id,
    name: requiredText(manifest.name, 'name', 80),
    version,
    description: requiredText(manifest.description, 'description', 240),
    category,
    mode,
    source: 'server',
    nodeKinds: Object.freeze([...new Set(manifest.nodeKinds)]),
    instructions
  });
};

export function loadSkillRegistry(skillsDirectory) {
  const registry = new Map();
  if (!fs.existsSync(skillsDirectory)) return registry;
  const directories = fs.readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const directory of directories) {
    const skill = parseManifest(path.join(skillsDirectory, directory.name), directory.name);
    if (registry.has(skill.id)) throw new SkillRegistryError(`Duplicate skill id: ${skill.id}`);
    registry.set(skill.id, skill);
  }
  return registry;
}

export function listPublicSkills(registry) {
  return [...registry.values()].map(({ instructions: _instructions, ...skill }) => skill);
}

export function resolveSkills(skillIds, registry, nodeKind = 'llm') {
  if (skillIds === undefined || skillIds === null) return [];
  if (!Array.isArray(skillIds) || skillIds.length > 8) throw new SkillRegistryError('skillIds must be an array with at most 8 entries');

  const resolved = [];
  const seen = new Set();
  for (const rawId of skillIds) {
    if (typeof rawId !== 'string' || !skillIdPattern.test(rawId)) throw new SkillRegistryError('skillIds contains an invalid skill id');
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    const skill = registry.get(rawId);
    if (!skill) throw new SkillRegistryError(`Skill not found: ${rawId}`);
    if (!skill.nodeKinds.includes(nodeKind)) throw new SkillRegistryError(`Skill ${rawId} does not support ${nodeKind} nodes`);
    resolved.push(skill);
  }
  return resolved;
}

export function resolveLocalSkills(localSkills, registry, nodeKind = 'llm') {
  if (localSkills === undefined || localSkills === null) return [];
  if (!Array.isArray(localSkills) || localSkills.length > 8) throw new SkillRegistryError('localSkills must be an array with at most 8 entries');

  const resolved = [];
  const seen = new Set();
  let totalInstructionLength = 0;
  for (const candidate of localSkills) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new SkillRegistryError('localSkills contains an invalid definition');
    const id = requiredText(candidate.id, 'id', 64);
    if (!localSkillIdPattern.test(id)) throw new SkillRegistryError('Local skill ids must start with local- and use lowercase letters, digits, or hyphens');
    if (seen.has(id)) continue;
    if (registry.has(id)) throw new SkillRegistryError(`Local skill id conflicts with a server skill: ${id}`);
    seen.add(id);

    const nodeKinds = Array.isArray(candidate.nodeKinds) ? [...new Set(candidate.nodeKinds)] : [];
    if (nodeKinds.length !== 1 || nodeKinds[0] !== 'llm' || !nodeKinds.includes(nodeKind)) {
      throw new SkillRegistryError(`Local skill ${id} does not support ${nodeKind} nodes`);
    }
    const instructions = requiredText(candidate.instructions, 'instructions', 20_000);
    totalInstructionLength += instructions.length;
    if (totalInstructionLength > 40_000) throw new SkillRegistryError('Selected local skill instructions exceed 40000 characters in total');

    const version = requiredText(candidate.version, 'version', 32);
    const category = requiredText(candidate.category, 'category', 64);
    const mode = requiredText(candidate.mode, 'mode', 32);
    if (!versionPattern.test(version) || !metadataTokenPattern.test(category) || !metadataTokenPattern.test(mode)) {
      throw new SkillRegistryError(`Local skill ${id} has invalid version, category, or mode metadata`);
    }

    resolved.push(Object.freeze({
      id,
      name: requiredText(candidate.name, 'name', 80),
      version,
      description: requiredText(candidate.description, 'description', 240),
      category,
      mode,
      source: 'local',
      nodeKinds: Object.freeze(nodeKinds),
      instructions
    }));
  }
  return resolved;
}

export function composeSkillInstructions(baseInstructions, skills) {
  const sections = [];
  if (typeof baseInstructions === 'string' && baseInstructions.trim()) sections.push(baseInstructions.trim());
  for (const skill of skills) {
    sections.push(`<skill id="${skill.id}" version="${skill.version}" mode="${skill.mode}">\n${skill.instructions}\n</skill>`);
  }
  return sections.join('\n\n');
}
