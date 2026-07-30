export type OutputAsset = {
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
};

type OutputItemBase = {
  id: string;
  key: string;
  label: string;
  sourceNodeId: string;
  sourceTitle: string;
};

export type OutputItem =
  | (OutputItemBase & { type: 'text'; text: string })
  | (OutputItemBase & { type: 'json'; value: unknown })
  | (OutputItemBase & { type: 'image'; asset: OutputAsset })
  | (OutputItemBase & { type: 'file'; asset: OutputAsset });

export type OutputGroup = {
  id: string;
  key: string;
  title: string;
  sourceNodeId: string;
  items: OutputItem[];
};

export type OutputBinding = {
  key: string;
  label: string;
  type: OutputItem['type'];
  source: { nodeId: string; path?: string };
};

export type ConditionOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals';

export type WorkflowOutputBundle = {
  schemaVersion: 1;
  groups: OutputGroup[];
  error?: string;
  notice?: string;
};

export type RuntimeText = string | { text: string; name?: string };
export type RuntimeAsset = string | OutputAsset;

export type RuntimeOutputLike = {
  text?: string;
  texts?: readonly RuntimeText[];
  image?: RuntimeAsset;
  images?: readonly RuntimeAsset[];
  files?: readonly OutputAsset[];
  value?: unknown;
};

export type RuntimeOutputSource = RuntimeOutputLike & {
  sourceNodeId: string;
  sourceTitle: string;
};

export type WorkflowNode = {
  id: string;
  type?: string;
  kind?: string;
  data?: { kind?: string; title?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type WorkflowEdge = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  [key: string]: unknown;
};

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  [key: string]: unknown;
};

export type WorkflowValidationIssue = {
  code:
    | 'duplicate_node_id'
    | 'duplicate_edge_id'
    | 'dangling_edge'
    | 'invalid_start_count'
    | 'missing_output'
    | 'unreachable_output'
    | 'cycle'
    | 'invalid_condition_handle'
    | 'unexpected_condition_handle';
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type WorkflowValidationResult = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  reachableNodeIds: string[];
};

export type WorkflowExport = {
  schema: 'aiflow.workflow';
  schemaVersion: 1;
  exportedAt: string;
  workflow: WorkflowGraph;
  outputs?: WorkflowOutputBundle;
};

function nodeKind(node: WorkflowNode): string | undefined {
  return node.kind ?? node.data?.kind ?? node.type;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asAsset(asset: RuntimeAsset, fallbackName: string): OutputAsset {
  return typeof asset === 'string' ? { url: asset, name: fallbackName } : { ...asset };
}

type OutputItemWithoutIdentity = OutputItem extends infer Item
  ? Item extends OutputItem
    ? Omit<Item, 'id' | 'key'>
    : never
  : never;

/**
 * Converts every value exposed by upstream runtime nodes into output items.
 * Source order, then field order (text, texts, image, images, files, value), is stable.
 */
export function normalizeRuntimeOutputGroup(
  groupId: string,
  title: string,
  upstream: readonly RuntimeOutputSource[]
): OutputGroup {
  const items: OutputItem[] = [];

  const add = (item: OutputItemWithoutIdentity) => {
    const id = `${groupId}:item:${items.length + 1}`;
    items.push({ ...item, id, key: id } as OutputItem);
  };

  for (const source of upstream) {
    const origin = { sourceNodeId: source.sourceNodeId, sourceTitle: source.sourceTitle };

    if (source.text !== undefined) {
      add({ ...origin, type: 'text', label: `${source.sourceTitle} · 文本`, text: source.text });
    }
    source.texts?.forEach((entry, index) => {
      const text = typeof entry === 'string' ? entry : entry.text;
      const name = typeof entry === 'string' ? undefined : entry.name;
      add({ ...origin, type: 'text', label: name || `${source.sourceTitle} · 文本 ${index + 1}`, text });
    });
    if (source.image !== undefined) {
      add({
        ...origin,
        type: 'image',
        label: `${source.sourceTitle} · 图片`,
        asset: asAsset(source.image, `${source.sourceNodeId}-image`)
      });
    }
    source.images?.forEach((image, index) => {
      const asset = asAsset(image, `${source.sourceNodeId}-image-${index + 1}`);
      add({ ...origin, type: 'image', label: asset.name || `${source.sourceTitle} · 图片 ${index + 1}`, asset });
    });
    source.files?.forEach((file, index) => {
      add({
        ...origin,
        type: 'file',
        label: file.name || `${source.sourceTitle} · 文件 ${index + 1}`,
        asset: { ...file }
      });
    });
    if (source.value !== undefined) {
      add({ ...origin, type: 'json', label: `${source.sourceTitle} · JSON`, value: clone(source.value) });
    }
  }

  return { id: groupId, key: groupId, title, sourceNodeId: groupId, items };
}

/** Applies stable business keys and labels declared by an output node or preset. */
export function applyOutputBindings(group: OutputGroup, bindings: readonly OutputBinding[]): OutputGroup {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const binding of bindings) {
    const count = group.items.filter((item) => item.sourceNodeId === binding.source.nodeId && item.type === binding.type).length;
    totals.set(binding.key, count);
  }

  return {
    ...group,
    items: group.items.map((item) => {
      const binding = bindings.find((candidate) => candidate.source.nodeId === item.sourceNodeId && candidate.type === item.type);
      if (!binding) return item;
      const index = (seen.get(binding.key) || 0) + 1;
      seen.set(binding.key, index);
      const multiple = (totals.get(binding.key) || 0) > 1;
      return {
        ...item,
        key: multiple ? `${binding.key}[${index - 1}]` : binding.key,
        label: multiple ? `${binding.label} ${index}` : binding.label
      };
    })
  };
}

/** Supports pipe-separated alternatives, e.g. "直播|短视频". */
export function evaluateCondition(actualValue: unknown, expectedValue: unknown, operator: ConditionOperator): boolean {
  const actual = String(actualValue || '');
  const values = String(expectedValue || '').split('|').map((value) => value.trim()).filter(Boolean);
  const expected = values.length ? values : [''];
  if (operator === 'contains') return expected.some((value) => actual.includes(value));
  if (operator === 'not_contains') return expected.every((value) => !actual.includes(value));
  if (operator === 'equals') return expected.some((value) => actual === value);
  return expected.every((value) => actual !== value);
}

/** Keeps end-node groups separate so a later end node can never overwrite an earlier one. */
export function mergeOutputGroups(
  ...inputs: readonly (OutputGroup | readonly OutputGroup[])[]
): WorkflowOutputBundle {
  const groups = inputs.flatMap((input) => Array.isArray(input) ? input : [input]) as OutputGroup[];
  return { schemaVersion: 1, groups: groups.map((group) => clone(group)) };
}

/** Returns node ids reachable by outgoing edges, in deterministic breadth-first order. */
export function reachable(
  graph: Pick<WorkflowGraph, 'nodes' | 'edges'>,
  start: string | readonly string[]
): string[] {
  const existing = new Set(graph.nodes.map((node) => node.id));
  const queue = (typeof start === 'string' ? [start] : [...start]).filter((id) => existing.has(id));
  const visited = new Set<string>();

  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graph.edges) {
      if (edge.source === id && existing.has(edge.target) && !visited.has(edge.target)) queue.push(edge.target);
    }
  }

  return [...visited];
}

/** Stable Kahn sort. Throws when ids/edges are invalid or when the graph contains a cycle. */
export function topologicalSort(graph: Pick<WorkflowGraph, 'nodes' | 'edges'>): string[] {
  const ids = graph.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error('Workflow graph contains duplicate node ids');

  const order = new Map(ids.map((id, index) => [id, index]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));

  for (const edge of graph.edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) {
      throw new Error(`Workflow edge ${edge.id || `${edge.source}->${edge.target}`} is dangling`);
    }
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }

  const ready = ids.filter((id) => indegree.get(id) === 0);
  const result: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => order.get(a)! - order.get(b)!);
    const id = ready.shift()!;
    result.push(id);
    for (const target of outgoing.get(id)!) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }

  if (result.length !== ids.length) throw new Error('Workflow graph contains a cycle');
  return result;
}

/** Returns deterministic dependency waves. Nodes in the same wave may run concurrently. */
export function topologicalLayers(graph: Pick<WorkflowGraph, 'nodes' | 'edges'>): string[][] {
  const ids = graph.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error('Workflow graph contains duplicate node ids');
  const order = new Map(ids.map((id, index) => [id, index]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) throw new Error(`Workflow edge ${edge.id || `${edge.source}->${edge.target}`} is dangling`);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  let ready = ids.filter((id) => indegree.get(id) === 0);
  const layers: string[][] = [];
  let visited = 0;
  while (ready.length) {
    const layer = [...ready].sort((a, b) => order.get(a)! - order.get(b)!);
    layers.push(layer);
    visited += layer.length;
    const nextReady: string[] = [];
    for (const id of layer) {
      for (const target of outgoing.get(id)!) {
        const next = indegree.get(target)! - 1;
        indegree.set(target, next);
        if (next === 0) nextReady.push(target);
      }
    }
    ready = nextReady;
  }
  if (visited !== ids.length) throw new Error('Workflow graph contains a cycle');
  return layers;
}

export function validateWorkflowGraph(graph: Pick<WorkflowGraph, 'nodes' | 'edges'>): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ code: 'duplicate_node_id', nodeId: node.id, message: `节点 ID 重复：${node.id}` });
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.id) {
      if (edgeIds.has(edge.id)) {
        issues.push({ code: 'duplicate_edge_id', edgeId: edge.id, message: `连线 ID 重复：${edge.id}` });
      }
      edgeIds.add(edge.id);
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: 'dangling_edge',
        edgeId: edge.id,
        message: `连线引用不存在的节点：${edge.source} -> ${edge.target}`
      });
      continue;
    }
    const source = graph.nodes.find((node) => node.id === edge.source)!;
    const kind = nodeKind(source);
    if (kind === 'condition' && edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
      issues.push({
        code: 'invalid_condition_handle',
        nodeId: source.id,
        edgeId: edge.id,
        message: `条件节点连线必须使用 true 或 false 出口：${source.id}`
      });
    } else if (kind !== 'condition' && (edge.sourceHandle === 'true' || edge.sourceHandle === 'false')) {
      issues.push({
        code: 'unexpected_condition_handle',
        nodeId: source.id,
        edgeId: edge.id,
        message: `非条件节点不能使用条件出口：${source.id}`
      });
    }
  }

  const starts = graph.nodes.filter((node) => nodeKind(node) === 'start');
  const outputs = graph.nodes.filter((node) => nodeKind(node) === 'output');
  if (starts.length !== 1) {
    issues.push({ code: 'invalid_start_count', message: `工作流必须且只能有一个开始节点，当前为 ${starts.length} 个` });
  }
  if (outputs.length === 0) issues.push({ code: 'missing_output', message: '工作流至少需要一个结束节点' });

  const reachableNodeIds = starts.length === 1 ? reachable(graph, starts[0].id) : [];
  const reachableSet = new Set(reachableNodeIds);
  for (const output of outputs) {
    if (!reachableSet.has(output.id)) {
      issues.push({
        code: 'unreachable_output',
        nodeId: output.id,
        message: `结束节点无法从开始节点到达：${output.id}`
      });
    }
  }

  if (!issues.some((issue) => issue.code === 'duplicate_node_id' || issue.code === 'dangling_edge')) {
    try {
      topologicalSort(graph);
    } catch (error) {
      if (error instanceof Error && error.message.includes('cycle')) {
        issues.push({ code: 'cycle', message: '工作流存在环路' });
      }
    }
  }

  return { valid: issues.length === 0, issues, reachableNodeIds };
}

export function createWorkflowExport(
  workflow: WorkflowGraph,
  outputs?: WorkflowOutputBundle,
  exportedAt = new Date().toISOString()
): string {
  const document: WorkflowExport = {
    schema: 'aiflow.workflow',
    schemaVersion: 1,
    exportedAt,
    workflow: clone(workflow),
    ...(outputs ? { outputs: clone(outputs) } : {})
  };
  return JSON.stringify(document, null, 2);
}

export function parseWorkflowExport(serialized: string): WorkflowExport {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Workflow export is not valid JSON');
  }

  if (!value || typeof value !== 'object') throw new Error('Workflow export must be an object');
  const document = value as Partial<WorkflowExport>;
  if (document.schema !== 'aiflow.workflow' || document.schemaVersion !== 1) {
    throw new Error('Unsupported workflow export schema');
  }
  if (!document.workflow || !Array.isArray(document.workflow.nodes) || !Array.isArray(document.workflow.edges)) {
    throw new Error('Workflow export is missing a graph');
  }
  if (document.outputs && (document.outputs.schemaVersion !== 1 || !Array.isArray(document.outputs.groups))) {
    throw new Error('Workflow export contains invalid outputs');
  }

  return clone(document as WorkflowExport);
}
