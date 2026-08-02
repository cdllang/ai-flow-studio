export const localSkillStorageKey = 'aiflow.demo.local-skills';
export const maxLocalSkills = 24;

export type SkillNodeKind = 'llm';
export type SkillSource = 'server' | 'local';

export type SkillSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  mode: string;
  source: SkillSource;
  nodeKinds: SkillNodeKind[];
};

export type LocalSkillDefinition = SkillSummary & {
  source: 'local';
  instructions: string;
};

const localSkillIdPattern = /^local-[a-z0-9][a-z0-9-]{0,55}$/;

export function createLocalSkill(): LocalSkillDefinition {
  return {
    id: `local-skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    version: 'local-1',
    description: '',
    category: 'custom',
    mode: 'advisor',
    source: 'local',
    nodeKinds: ['llm'],
    instructions: ''
  };
}

export function validateLocalSkill(skill: LocalSkillDefinition): string | null {
  if (!localSkillIdPattern.test(skill.id)) return '本地 Skill ID 格式无效';
  if (!skill.name.trim() || skill.name.length > 80) return '名称不能为空且不能超过 80 个字符';
  if (!skill.description.trim() || skill.description.length > 240) return '说明不能为空且不能超过 240 个字符';
  if (!skill.instructions.trim() || skill.instructions.length > 20_000) return 'Skill 指令不能为空且不能超过 20000 个字符';
  if (skill.version !== 'local-1' || skill.category !== 'custom' || skill.mode !== 'advisor') return '本地 Skill 元数据无效';
  if (skill.nodeKinds.length !== 1 || skill.nodeKinds[0] !== 'llm') return '当前仅支持大模型节点 Skill';
  return null;
}

const normalizeLocalSkill = (value: unknown): LocalSkillDefinition | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<LocalSkillDefinition>;
  const normalized: LocalSkillDefinition = {
    id: typeof candidate.id === 'string' ? candidate.id : '',
    name: typeof candidate.name === 'string' ? candidate.name.trim() : '',
    version: 'local-1',
    description: typeof candidate.description === 'string' ? candidate.description.trim() : '',
    category: 'custom',
    mode: 'advisor',
    source: 'local',
    nodeKinds: ['llm'],
    instructions: typeof candidate.instructions === 'string' ? candidate.instructions.trim() : ''
  };
  return validateLocalSkill(normalized) ? null : normalized;
};

export function normalizeLocalSkillStore(value: unknown): LocalSkillDefinition[] {
  const records = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { skills?: unknown }).skills) ? (value as { skills: unknown[] }).skills : [];
  const skills = records.map(normalizeLocalSkill).filter((skill): skill is LocalSkillDefinition => Boolean(skill));
  const seen = new Set<string>();
  return skills.filter((skill) => !seen.has(skill.id) && seen.add(skill.id)).slice(0, maxLocalSkills);
}

export function normalizeServerSkillCatalog(value: unknown): SkillSummary[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { skills?: unknown }).skills)) return [];
  return (value as { skills: unknown[] }).skills.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<SkillSummary>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.version !== 'string' || typeof candidate.description !== 'string' || typeof candidate.category !== 'string' || typeof candidate.mode !== 'string' || !Array.isArray(candidate.nodeKinds)) return [];
    if (!candidate.nodeKinds.includes('llm')) return [];
    return [{
      id: candidate.id,
      name: candidate.name,
      version: candidate.version,
      description: candidate.description,
      category: candidate.category,
      mode: candidate.mode,
      source: 'server',
      nodeKinds: ['llm']
    } as SkillSummary];
  });
}

export function localSkillRequest(skill: LocalSkillDefinition) {
  const { source: _source, ...request } = skill;
  return request;
}
