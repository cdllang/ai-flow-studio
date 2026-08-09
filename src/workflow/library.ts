export const workflowLibraryStorageKey = 'aiflow.demo.workflow-library.v1';

export type WorkflowLibraryItem<TNode = unknown, TEdge = unknown> = {
  id: string;
  title: string;
  description: string;
  input: string;
  nodes: TNode[];
  edges: TEdge[];
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunAt?: string;
};

type WorkflowLibraryDraft<TNode, TEdge> = Pick<
  WorkflowLibraryItem<TNode, TEdge>,
  'title' | 'description' | 'input' | 'nodes' | 'edges'
> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  runCount?: number;
  lastRunAt?: string;
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createWorkflowLibraryItem<TNode, TEdge>(
  draft: WorkflowLibraryDraft<TNode, TEdge>,
  now = new Date().toISOString()
): WorkflowLibraryItem<TNode, TEdge> {
  return {
    id: draft.id || `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: draft.title.trim(),
    description: draft.description.trim(),
    input: draft.input,
    nodes: clone(draft.nodes),
    edges: clone(draft.edges),
    createdAt: draft.createdAt || now,
    updatedAt: draft.updatedAt || now,
    runCount: Math.max(0, Math.floor(draft.runCount || 0)),
    ...(draft.lastRunAt ? { lastRunAt: draft.lastRunAt } : {})
  };
}

export function normalizeWorkflowLibrary(value: unknown): WorkflowLibraryItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Partial<WorkflowLibraryItem>;
    if (
      typeof item.id !== 'string' || !item.id.trim() ||
      typeof item.title !== 'string' || !item.title.trim() ||
      typeof item.description !== 'string' ||
      typeof item.input !== 'string' ||
      !Array.isArray(item.nodes) || !Array.isArray(item.edges) ||
      typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string'
    ) return [];

    return [createWorkflowLibraryItem({
      id: item.id,
      title: item.title,
      description: item.description,
      input: item.input,
      nodes: item.nodes,
      edges: item.edges,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      runCount: typeof item.runCount === 'number' ? item.runCount : 0,
      lastRunAt: typeof item.lastRunAt === 'string' ? item.lastRunAt : undefined
    }, item.updatedAt)];
  });
}

export function upsertWorkflowLibraryItem<TNode, TEdge>(
  items: readonly WorkflowLibraryItem<TNode, TEdge>[],
  next: WorkflowLibraryItem<TNode, TEdge>
): WorkflowLibraryItem<TNode, TEdge>[] {
  return [next, ...items.filter((item) => item.id !== next.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function markWorkflowLibraryRun<TNode, TEdge>(
  items: readonly WorkflowLibraryItem<TNode, TEdge>[],
  id: string,
  ranAt = new Date().toISOString()
): WorkflowLibraryItem<TNode, TEdge>[] {
  return items.map((item) => item.id === id ? {
    ...item,
    runCount: item.runCount + 1,
    lastRunAt: ranAt
  } : item);
}

export function cloneWorkflowLibraryDefinition<TNode, TEdge>(item: WorkflowLibraryItem<TNode, TEdge>) {
  return {
    nodes: clone(item.nodes),
    edges: clone(item.edges),
    input: item.input,
    title: item.title
  };
}
