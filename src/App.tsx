import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from '@xyflow/react';
import {
  ArrowLeft,
  Bot,
  Braces,
  Check,
  ChevronDown,
  CircleStop,
  Code2,
  Copy,
  Download,
  FileJson,
  FileText,
  GitBranch,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PanelBottomClose,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Plus,
  Rocket,
  Search,
  Settings,
  Sparkles,
  TerminalSquare,
  Trash2,
  Undo2,
  Upload,
  Webhook,
  X,
  ZoomIn,
  Square
} from 'lucide-react';

type NodeKind = 'start' | 'llm' | 'image' | 'condition' | 'http' | 'code' | 'output';
type NodeStatus = 'idle' | 'waiting' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled';
type FlowData = Record<string, unknown> & {
  kind: NodeKind;
  title: string;
  subtitle: string;
  status?: NodeStatus;
  prompt?: string;
  model?: string;
  conditionSource?: 'input' | 'upstream';
  conditionOperator?: 'contains' | 'not_contains' | 'equals' | 'not_equals';
  conditionValue?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  httpUrl?: string;
  httpHeaders?: string;
  httpBody?: string;
  code?: string;
  imageSize?: string;
  imageQuality?: 'high' | 'medium';
};

type ApiStatus = {
  baseUrl: string;
  chatConfigured: boolean;
  imageConfigured: boolean;
  chatKeyHint: string | null;
  imageKeyHint: string | null;
  defaultChatModel: string;
  imageModel: string;
};

type StoredApiKeys = {
  chatApiKey: string;
  imageApiKey: string;
};

type RunLog = {
  id: string;
  title: string;
  detail: string;
  status: 'success' | 'running' | 'muted' | 'error' | 'skipped';
  elapsed?: string;
};

type WorkflowSnapshot = { nodes: Node<FlowData>[]; edges: Edge[] };

type RuntimeOutput = WorkflowResult & {
  value?: unknown;
  branch?: boolean;
  status?: number;
};

type RunRecord = {
  id: string;
  startedAt: string;
  status: 'success' | 'error' | 'cancelled';
  duration: string;
  logs: RunLog[];
  result: WorkflowResult;
};

type VersionRecord = {
  id: string;
  createdAt: string;
  nodes: Node<FlowData>[];
  edges: Edge[];
};

type ReferenceImage = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type OutputFile = {
  name: string;
  url: string;
  mimeType?: string;
};

type WorkflowResult = {
  text?: string;
  image?: string;
  imageAspectRatio?: string;
  files?: OutputFile[];
  error?: string;
  notice?: string;
};

const nodeMeta: Record<NodeKind, { label: string; icon: typeof Bot; color: string; group: string }> = {
  start: { label: '开始', icon: Play, color: '#f6f4ee', group: '输入输出' },
  llm: { label: '大模型', icon: MessageSquareText, color: '#5688ff', group: 'AI 能力' },
  image: { label: '图像生成', icon: ImageIcon, color: '#ff8a3d', group: 'AI 能力' },
  condition: { label: '条件分支', icon: GitBranch, color: '#f0b458', group: '逻辑' },
  http: { label: 'HTTP 请求', icon: Webhook, color: '#38d676', group: '工具' },
  code: { label: '代码', icon: Code2, color: '#a78bfa', group: '工具' },
  output: { label: '结束', icon: CircleStop, color: '#f6f4ee', group: '输入输出' }
};

const imageSizePresets = [
  { ratio: '1:1', size: '1024x1024', width: 1024, height: 1024, hint: '头像 / 商品' },
  { ratio: '16:9', size: '1536x864', width: 1536, height: 864, hint: '横屏 / 封面' },
  { ratio: '3:2', size: '1536x1024', width: 1536, height: 1024, hint: '摄影 / 海报' },
  { ratio: '4:3', size: '1536x1152', width: 1536, height: 1152, hint: '通用横图' },
  { ratio: '3:4', size: '1152x1536', width: 1152, height: 1536, hint: '竖版海报' },
  { ratio: '9:16', size: '864x1536', width: 864, height: 1536, hint: '短视频 / 手机' }
] as const;

const initialNodes: Node<FlowData>[] = [
  {
    id: 'start-1',
    type: 'flowNode',
    position: { x: 70, y: 220 },
    data: { kind: 'start', title: '内容需求', subtitle: '输入主题与内容目标', status: 'idle' }
  },
  {
    id: 'llm-1',
    type: 'flowNode',
    position: { x: 390, y: 120 },
    data: {
      kind: 'llm',
      title: '生成视觉方案',
      subtitle: 'gpt-5.4-mini',
      model: 'gpt-5.4-mini',
      prompt: '请将用户的内容需求扩写为一份清晰、具体、可执行的中文图片提示词。',
      status: 'idle'
    }
  },
  {
    id: 'image-1',
    type: 'flowNode',
    position: { x: 720, y: 120 },
    data: {
      kind: 'image',
      title: '生成主视觉',
      subtitle: 'gpt-image-2 · 1024×1024',
      model: 'gpt-image-2',
      imageSize: '1024x1024',
      imageQuality: 'high',
      status: 'idle'
    }
  },
  {
    id: 'output-1',
    type: 'flowNode',
    position: { x: 1050, y: 220 },
    data: { kind: 'output', title: '输出结果', subtitle: '图片与提示词', status: 'idle' }
  }
];

const initialEdges: Edge[] = [
  { id: 'e-start-llm', source: 'start-1', target: 'llm-1', animated: false },
  { id: 'e-llm-image', source: 'llm-1', target: 'image-1', animated: false },
  { id: 'e-image-output', source: 'image-1', target: 'output-1', animated: false }
];

function loadSavedWorkflow() {
  try {
    const raw = localStorage.getItem('aiflow.demo.workflow');
    if (!raw) return null;
    const saved = JSON.parse(raw) as { nodes?: Node<FlowData>[]; edges?: Edge[]; input?: string };
    if (!Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) return null;
    return saved;
  } catch {
    return null;
  }
}

function loadStoredList<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const apiKeysStorageKey = 'aiflow.demo.apiKeys';

function loadStoredApiKeys(): StoredApiKeys {
  try {
    const value = JSON.parse(localStorage.getItem(apiKeysStorageKey) || '{}');
    return {
      chatApiKey: typeof value.chatApiKey === 'string' ? value.chatApiKey : '',
      imageApiKey: typeof value.imageApiKey === 'string' ? value.imageApiKey : ''
    };
  } catch {
    return { chatApiKey: '', imageApiKey: '' };
  }
}

function statusWithLocalKeys(status: ApiStatus, keys: StoredApiKeys): ApiStatus {
  return {
    ...status,
    chatConfigured: Boolean(keys.chatApiKey),
    imageConfigured: Boolean(keys.imageApiKey),
    chatKeyHint: keys.chatApiKey ? `••••${keys.chatApiKey.slice(-4)}` : null,
    imageKeyHint: keys.imageApiKey ? `••••${keys.imageApiKey.slice(-4)}` : null
  };
}

function cleanSnapshot(nodes: Node<FlowData>[], edges: Edge[]): WorkflowSnapshot {
  return {
    nodes: nodes.map((node) => ({ ...node, data: { ...node.data, status: 'idle' } })),
    edges: edges.map((edge) => ({ ...edge }))
  };
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function runCodeInWorker(code: string, input: unknown, context: Record<string, unknown>, signal: AbortSignal) {
  return new Promise<unknown>((resolve, reject) => {
    const workerSource = `self.onmessage = async (event) => {
      try {
        const fn = new Function('input', 'context', '\"use strict\"; return (async () => {' + event.data.code + '\\n})()');
        const value = await fn(event.data.input, event.data.context);
        self.postMessage({ ok: true, value });
      } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };`;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const cleanup = () => { worker.terminate(); URL.revokeObjectURL(workerUrl); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('代码节点执行超过 5 秒')); }, 5000);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
    worker.onmessage = (event) => {
      window.clearTimeout(timer);
      cleanup();
      if (event.data.ok) resolve(event.data.value);
      else reject(new Error(event.data.error || '代码节点执行失败'));
    };
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error(event.message || '代码 Worker 加载失败'));
    };
    worker.postMessage({ code, input, context });
  });
}

function outputImageStyle(aspectRatio = '1 / 1'): CSSProperties {
  const [width, height] = aspectRatio.split('/').map((value) => Number(value.trim()));
  const ratio = width > 0 && height > 0 ? width / height : 1;
  if (ratio < 1) return { width: `${Math.round(190 * ratio)}px`, height: '190px', aspectRatio };
  const displayWidth = Math.min(260, Math.round(190 * ratio));
  return { width: `${displayWidth}px`, height: `${Math.round(displayWidth / ratio)}px`, aspectRatio };
}

function aspectRatioLabel(aspectRatio?: string) {
  if (!aspectRatio) return '自动比例';
  const [rawWidth, rawHeight] = aspectRatio.split('/').map((value) => Math.round(Number(value.trim())));
  if (!rawWidth || !rawHeight) return aspectRatio.replace(' / ', ':');
  const greatestCommonDivisor = (left: number, right: number): number => right ? greatestCommonDivisor(right, left % right) : left;
  const divisor = greatestCommonDivisor(rawWidth, rawHeight);
  return `${rawWidth / divisor}:${rawHeight / divisor}`;
}

function FlowNode({ id, data, selected }: NodeProps<Node<FlowData>>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = nodeMeta[data.kind];
  const Icon = meta.icon;
  const status = data.status ?? 'idle';
  return (
    <article className={`flow-node ${selected ? 'selected' : ''} status-${status}`}>
      {data.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="node-head">
        <span className="node-icon" style={{ color: meta.color }}><Icon size={16} strokeWidth={2.2} /></span>
        <span className="node-kicker">{meta.label}</span>
        <button className="icon-button tiny" aria-label="节点菜单" onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value); }}><MoreHorizontal size={15} /></button>
        {menuOpen && <div className="node-menu" onClick={(event) => event.stopPropagation()}><button onClick={() => window.dispatchEvent(new CustomEvent('aiflow:delete-node', { detail: id }))}><Trash2 size={13} />删除节点</button></div>}
      </div>
      <strong>{data.title}</strong>
      <span className="node-subtitle">{data.subtitle}</span>
      <div className="node-state">
        {status === 'running' ? <LoaderCircle className="spin" size={13} /> : status === 'success' ? <Check size={13} /> : status === 'cancelled' ? <Square size={11} /> : <span className="status-dot" />}
        {status === 'running' ? '运行中' : status === 'success' ? '已完成' : status === 'error' ? '运行失败' : status === 'skipped' ? '已跳过' : status === 'cancelled' ? '已停止' : '等待运行'}
      </div>
      {data.kind === 'condition' ? <><Handle id="true" className="condition-handle true" type="source" position={Position.Right} /><Handle id="false" className="condition-handle false" type="source" position={Position.Right} /><span className="branch-label true">true</span><span className="branch-label false">false</span></> : data.kind !== 'output' && <Handle type="source" position={Position.Right} />}
    </article>
  );
}

const nodeTypes = { flowNode: FlowNode };

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="AIFlow Studio">
      <img src="/assets/aiwanai-logo.svg" alt="爱玩 AI" />
      <span><strong>工作流</strong><small>AI FLOW STUDIO</small></span>
    </div>
  );
}

function App() {
  const savedWorkflow = useMemo(loadSavedWorkflow, []);
  const [nodes, setNodes] = useState<Node<FlowData>[]>(savedWorkflow?.nodes ?? initialNodes);
  const [edges, setEdges] = useState<Edge[]>(savedWorkflow?.edges ?? initialEdges);
  const [selectedId, setSelectedId] = useState<string>('llm-1');
  const [debugOpen, setDebugOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [configPanelOpen, setConfigPanelOpen] = useState(true);
  const [workspaceView, setWorkspaceView] = useState<'editor' | 'runs' | 'versions'>('editor');
  const [undoStack, setUndoStack] = useState<WorkflowSnapshot[]>([]);
  const [runRecords, setRunRecords] = useState<RunRecord[]>(() => loadStoredList<RunRecord>('aiflow.demo.runs'));
  const [versions, setVersions] = useState<VersionRecord[]>(() => loadStoredList<VersionRecord>('aiflow.demo.versions'));
  const [toast, setToast] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');
  const [input, setInput] = useState(savedWorkflow?.input ?? '为一家专注 AI 效率工具的中文品牌设计一张社交媒体主视觉，克制、专业、有技术感。');
  const [running, setRunning] = useState(false);
  const [runLogs, setRunLogs] = useState<RunLog[]>([
    { id: 'hint', title: '等待运行', detail: '填写测试输入，然后点击右上角“试运行”', status: 'muted' }
  ]);
  const [result, setResult] = useState<WorkflowResult>({});
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [imageInputError, setImageInputError] = useState('');
  const [draggingImage, setDraggingImage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [apiKeys, setApiKeys] = useState<StoredApiKeys>(loadStoredApiKeys);
  const [config, setConfig] = useState<ApiStatus | null>(null);
  const [chatApiKey, setChatApiKey] = useState('');
  const [imageApiKey, setImageApiKey] = useState('');
  const [clearChatKey, setClearChatKey] = useState(false);
  const [clearImageKey, setClearImageKey] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [activeDebug, setActiveDebug] = useState<'process' | 'output' | 'logs'>('process');
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const selectedNode = nodes.find((node) => node.id === selectedId);

  useEffect(() => {
    fetch('/api/config/status')
      .then((response) => response.json())
      .then((status: ApiStatus) => {
        const localStatus = statusWithLocalKeys(status, apiKeys);
        setConfig(localStatus);
        if (!localStatus.chatConfigured || !localStatus.imageConfigured) {
          setConfigMessage({ kind: 'error', text: '请先配置基础模型和图像模型 API Key，再运行工作流' });
          setSettingsOpen(true);
        }
      })
      .catch(() => {
        setConfig(null);
        setConfigMessage({ kind: 'error', text: '无法读取模型配置，请确认本地服务已启动' });
        setSettingsOpen(true);
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cleanNodes = nodes.map((node) => ({ ...node, data: { ...node.data, status: 'idle' } }));
      localStorage.setItem('aiflow.demo.workflow', JSON.stringify({ nodes: cleanNodes, edges, input, savedAt: new Date().toISOString() }));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, input]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!imagePreviewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImagePreviewOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [imagePreviewOpen]);

  const rememberSnapshot = useCallback(() => {
    const snapshot = cleanSnapshot(nodes, edges);
    setUndoStack((items) => [...items.slice(-29), snapshot]);
  }, [nodes, edges]);

  const deleteNode = useCallback((id: string) => {
    rememberSnapshot();
    setNodes((items) => items.filter((node) => node.id !== id));
    setEdges((items) => items.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId((current) => current === id ? '' : current);
    setToast('节点已删除，可使用撤销恢复');
  }, [rememberSnapshot]);

  useEffect(() => {
    const onDeleteRequest = (event: Event) => deleteNode((event as CustomEvent<string>).detail);
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedId || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteNode(selectedId);
      }
    };
    window.addEventListener('aiflow:delete-node', onDeleteRequest);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('aiflow:delete-node', onDeleteRequest);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deleteNode, selectedId]);

  const onNodesChange = useCallback((changes: NodeChange<Node<FlowData>>[]) => setNodes((items) => applyNodeChanges(changes, items)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((change) => change.type === 'remove')) rememberSnapshot();
    setEdges((items) => applyEdgeChanges(changes, items));
  }, [rememberSnapshot]);
  const onConnect = useCallback((connection: Connection) => {
    rememberSnapshot();
    setEdges((items) => addEdge({ ...connection, animated: false }, items));
  }, [rememberSnapshot]);

  const filteredKinds = useMemo(() => {
    return (Object.keys(nodeMeta) as NodeKind[]).filter((kind) => nodeMeta[kind].label.toLowerCase().includes(nodeSearch.toLowerCase()));
  }, [nodeSearch]);

  const updateSelected = (patch: Partial<FlowData>) => {
    rememberSnapshot();
    setNodes((items) => items.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setUndoStack((items) => items.slice(0, -1));
    setToast('已撤销上一步操作');
  };

  const openSettings = () => {
    setChatApiKey('');
    setImageApiKey('');
    setClearChatKey(false);
    setClearImageKey(false);
    setConfigMessage(null);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    if (!config?.chatConfigured || !config?.imageConfigured) {
      setConfigMessage({ kind: 'error', text: '必须完成两类 API Key 配置后才能关闭' });
      return;
    }
    setSettingsOpen(false);
  };

  const saveApiKeys = async () => {
    setConfigSaving(true);
    setConfigMessage(null);
    try {
      const nextKeys = {
        chatApiKey: clearChatKey ? '' : chatApiKey.trim() || apiKeys.chatApiKey,
        imageApiKey: clearImageKey ? '' : imageApiKey.trim() || apiKeys.imageApiKey
      };
      localStorage.setItem(apiKeysStorageKey, JSON.stringify(nextKeys));
      setApiKeys(nextKeys);
      setConfig((current) => statusWithLocalKeys(current || {
        baseUrl: 'https://ai.aiwanai.com.cn/v1',
        chatConfigured: false,
        imageConfigured: false,
        chatKeyHint: null,
        imageKeyHint: null,
        defaultChatModel: 'gpt-5.4-mini',
        imageModel: 'gpt-image-2-count'
      }, nextKeys));
      setChatApiKey('');
      setImageApiKey('');
      setClearChatKey(false);
      setClearImageKey(false);
      setConfigMessage({ kind: 'success', text: 'API Key 已保存到当前浏览器并立即生效' });
    } catch (error) {
      setConfigMessage({ kind: 'error', text: error instanceof Error ? error.message : '配置保存失败' });
    } finally {
      setConfigSaving(false);
    }
  };

  const setReferenceFile = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setImageInputError('仅支持 PNG、JPG、JPEG 或 WebP 图片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageInputError('参考图片不能超过 10 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      setReferenceImage({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
      setImageInputError('');
    };
    reader.onerror = () => setImageInputError('图片读取失败，请重新选择');
    reader.readAsDataURL(file);
  };

  const copyOutputText = async () => {
    if (!result.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setResult((previous) => ({ ...previous, error: '复制失败，请手动选择文字复制' }));
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadOutputText = () => {
    if (result.text) downloadBlob(new Blob([result.text], { type: 'text/plain;charset=utf-8' }), 'workflow-output.txt');
  };

  const downloadOutputAsset = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('download failed');
      downloadBlob(await response.blob(), filename);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.target = '_blank';
      anchor.click();
    }
  };

  const addNode = (kind: NodeKind) => {
    rememberSnapshot();
    const count = nodes.filter((node) => node.data.kind === kind).length + 1;
    const id = `${kind}-${Date.now()}`;
    const node: Node<FlowData> = {
      id,
      type: 'flowNode',
      position: { x: 470 + count * 26, y: 330 + count * 18 },
      data: {
        kind,
        title: `${nodeMeta[kind].label} ${count}`,
        subtitle: kind === 'condition' ? '判断上游文本' : kind === 'http' ? 'GET · 未配置 URL' : kind === 'code' ? 'JavaScript · Worker' : '点击配置节点',
        status: 'idle',
        ...(kind === 'condition' ? { conditionSource: 'upstream', conditionOperator: 'contains', conditionValue: '' } : {}),
        ...(kind === 'http' ? { httpMethod: 'GET', httpUrl: '', httpHeaders: '{}', httpBody: '' } : {}),
        ...(kind === 'code' ? { code: 'return { text: String(input ?? "") };' } : {}),
        ...(kind === 'image' ? { model: 'gpt-image-2', imageSize: '1024x1024', imageQuality: 'high' } : {})
      }
    };
    setNodes((items) => [...items, node]);
    setSelectedId(id);
    setConfigPanelOpen(true);
  };

  const completeSuggestedWorkflow = () => {
    const missing = (['start', 'llm', 'image', 'output'] as NodeKind[]).filter((kind) => !nodes.some((node) => node.data.kind === kind));
    if (!missing.length) {
      setToast('当前工作流已具备完整的生成链路');
      return;
    }
    missing.forEach(addNode);
    setToast(`已补全 ${missing.length} 个基础节点，请拖拽连接`);
  };

  const publishWorkflow = () => {
    const starts = nodes.filter((node) => node.data.kind === 'start');
    const outputs = nodes.filter((node) => node.data.kind === 'output');
    if (starts.length !== 1 || outputs.length < 1) {
      setToast('发布失败：需要且只能有一个开始节点，并至少包含一个结束节点');
      return;
    }
    const snapshot = cleanSnapshot(nodes, edges);
    const version: VersionRecord = { id: `v${versions.length + 1}`, createdAt: new Date().toISOString(), ...snapshot };
    const next = [version, ...versions].slice(0, 20);
    setVersions(next);
    localStorage.setItem('aiflow.demo.versions', JSON.stringify(next));
    setToast(`${version.id} 已发布`);
    setWorkspaceView('versions');
  };

  const restoreVersion = (version: VersionRecord) => {
    rememberSnapshot();
    setNodes(version.nodes);
    setEdges(version.edges);
    setWorkspaceView('editor');
    setToast(`${version.id} 已恢复到画布`);
  };

  const setNodeStatus = (id: string, status: NodeStatus) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, status } } : node));
  };

  const stopWorkflow = () => {
    if (!running) return;
    stopRequestedRef.current = true;
    abortControllerRef.current?.abort();
  };

  const runWorkflow = async () => {
    if (running || !input.trim()) return;
    if (!config?.chatConfigured || !config?.imageConfigured) {
      setConfigMessage({ kind: 'error', text: '请先填写基础模型和图像模型 API Key' });
      setSettingsOpen(true);
      return;
    }
    const startNodes = nodes.filter((node) => node.data.kind === 'start');
    if (startNodes.length !== 1) {
      setToast('运行失败：工作流需要且只能有一个开始节点');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    stopRequestedRef.current = false;
    setRunning(true);
    setResult({});
    setDebugOpen(true);
    setWorkspaceView('editor');
    setActiveDebug('process');
    setNodes((items) => items.map((node) => ({ ...node, data: { ...node.data, status: 'waiting' } })));
    const started = performance.now();
    const logs: RunLog[] = [];
    const outputs = new Map<string, RuntimeOutput>();
    const skipped = new Set<string>();
    let finalResult: WorkflowResult = {};
    let recordStatus: RunRecord['status'] = 'success';

    const saveRecord = () => {
      const record: RunRecord = {
        id: `run_${Date.now()}`,
        startedAt: new Date().toISOString(),
        status: recordStatus,
        duration: `${((performance.now() - started) / 1000).toFixed(1)}s`,
        logs: [...logs],
        result: finalResult
      };
      setRunRecords((items) => {
        const next = [record, ...items].slice(0, 30);
        localStorage.setItem('aiflow.demo.runs', JSON.stringify(next));
        return next;
      });
    };

    try {
      const reachable = new Set<string>();
      const queue = [startNodes[0].id];
      while (queue.length) {
        const id = queue.shift()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        edges.filter((edge) => edge.source === id).forEach((edge) => queue.push(edge.target));
      }
      const workflowNodes = nodes.filter((node) => reachable.has(node.id));
      const workflowEdges = edges.filter((edge) => reachable.has(edge.source) && reachable.has(edge.target));
      const indegree = new Map(workflowNodes.map((node) => [node.id, 0]));
      workflowEdges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1));
      const ready = workflowNodes.filter((node) => indegree.get(node.id) === 0);
      const ordered: Node<FlowData>[] = [];
      while (ready.length) {
        const node = ready.shift()!;
        ordered.push(node);
        workflowEdges.filter((edge) => edge.source === node.id).forEach((edge) => {
          const next = (indegree.get(edge.target) || 0) - 1;
          indegree.set(edge.target, next);
          if (next === 0) ready.push(workflowNodes.find((item) => item.id === edge.target)!);
        });
      }
      if (ordered.length !== workflowNodes.length) throw new Error('工作流存在环路，无法执行');

      const edgeIsActive = (edge: Edge) => {
        if (skipped.has(edge.source) || !outputs.has(edge.source)) return false;
        const sourceNode = nodes.find((node) => node.id === edge.source);
        if (sourceNode?.data.kind !== 'condition') return true;
        const branch = outputs.get(edge.source)?.branch;
        const expected = edge.sourceHandle === 'false' ? false : true;
        return branch === expected;
      };

      for (const node of ordered) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const incoming = workflowEdges.filter((edge) => edge.target === node.id);
        const activeIncoming = incoming.filter(edgeIsActive);
        if (node.data.kind !== 'start' && incoming.length > 0 && activeIncoming.length === 0) {
          skipped.add(node.id);
          setNodeStatus(node.id, 'skipped');
          logs.push({ id: node.id, title: node.data.title, detail: '条件分支未命中，已跳过', status: 'skipped' });
          setRunLogs([...logs]);
          continue;
        }

        const nodeStarted = performance.now();
        const logIndex = logs.length;
        logs.push({ id: node.id, title: node.data.title, detail: `${nodeMeta[node.data.kind].label}正在执行`, status: 'running' });
        setRunLogs([...logs]);
        setNodeStatus(node.id, 'running');
        const upstream = activeIncoming.map((edge) => outputs.get(edge.source)!).filter(Boolean);
        const upstreamText = [...upstream].reverse().find((item) => item.text)?.text || input;
        let output: RuntimeOutput = {};
        let detail = '执行完成';

        if (node.data.kind === 'start') {
          await abortableDelay(180, controller.signal);
          output = { text: input, value: { text: input, referenceImage } };
          detail = referenceImage ? '文字与参考图片输入校验通过' : '文字输入校验通过';
        } else if (node.data.kind === 'llm') {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-AIFlow-API-Key': apiKeys.chatApiKey },
            signal: controller.signal,
            body: JSON.stringify({ prompt: upstreamText, system: node.data.prompt, model: node.data.model })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message || '基础模型调用失败');
          output = { text: data.text, value: data };
          detail = `生成完成 · ${data.usage?.total_tokens ?? '—'} tokens`;
        } else if (node.data.kind === 'image') {
          const response = await fetch('/api/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-AIFlow-API-Key': apiKeys.imageApiKey },
            signal: controller.signal,
            body: JSON.stringify({ prompt: upstreamText, size: node.data.imageSize || '1024x1024', quality: node.data.imageQuality || 'high', referenceImage })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message || '图像模型调用失败');
          const image = data.url || (data.base64 ? `data:image/png;base64,${data.base64}` : undefined);
          const [imageWidth, imageHeight] = String(node.data.imageSize || '1024x1024').split('x');
          output = { text: upstreamText, image, imageAspectRatio: `${imageWidth} / ${imageHeight}`, value: data };
          detail = data.simulated ? '渠道不可用，已使用品牌演示素材' : referenceImage ? '参考图扩展生成完成' : '图像生成完成';
        } else if (node.data.kind === 'condition') {
          const source = node.data.conditionSource === 'input' ? input : upstreamText;
          const expected = String(node.data.conditionValue || '');
          const actual = String(source || '');
          const operator = node.data.conditionOperator || 'contains';
          const branch = operator === 'contains' ? actual.includes(expected) : operator === 'not_contains' ? !actual.includes(expected) : operator === 'equals' ? actual === expected : actual !== expected;
          output = { text: actual, value: actual, branch };
          detail = `条件结果：${branch ? 'true' : 'false'}`;
        } else if (node.data.kind === 'http') {
          let headers = {};
          try { headers = JSON.parse(node.data.httpHeaders || '{}'); } catch { throw new Error('HTTP 请求头必须是合法 JSON'); }
          const response = await fetch('/api/http', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ method: node.data.httpMethod || 'GET', url: node.data.httpUrl, headers, body: node.data.httpBody?.replaceAll('{{input}}', upstreamText) })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message || 'HTTP 节点请求失败');
          const text = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2);
          output = { text, value: data.body, status: data.status };
          detail = `HTTP ${data.status}`;
        } else if (node.data.kind === 'code') {
          const context = Object.fromEntries(outputs.entries());
          const value = await runCodeInWorker(node.data.code || 'return input;', upstream[0]?.value ?? upstreamText, context, controller.signal);
          const normalized = typeof value === 'object' && value !== null ? value as Record<string, unknown> : { text: String(value ?? '') };
          output = { value, text: typeof normalized.text === 'string' ? normalized.text : JSON.stringify(value, null, 2) };
          detail = 'Worker 执行完成';
        } else if (node.data.kind === 'output') {
          const imageOutput = [...upstream].reverse().find((item) => item.image);
          finalResult = {
            text: [...upstream].reverse().find((item) => item.text)?.text,
            image: imageOutput?.image,
            imageAspectRatio: imageOutput?.imageAspectRatio,
            files: upstream.flatMap((item) => item.files || [])
          };
          output = { ...finalResult, value: finalResult };
          setResult(finalResult);
          detail = '最终结果已组装';
        }

        outputs.set(node.id, output);
        setNodeStatus(node.id, 'success');
        logs[logIndex] = { ...logs[logIndex], status: 'success', detail, elapsed: `${((performance.now() - nodeStarted) / 1000).toFixed(1)}s` };
        setRunLogs([...logs]);
      }

      if (!Object.keys(finalResult).length) {
        const last = outputs.get(ordered.at(-1)?.id || '') || {};
        finalResult = { text: last.text, image: last.image, imageAspectRatio: last.imageAspectRatio, files: last.files };
        setResult(finalResult);
      }
      setActiveDebug('output');
    } catch (error) {
      const cancelled = stopRequestedRef.current || (error instanceof DOMException && error.name === 'AbortError');
      recordStatus = cancelled ? 'cancelled' : 'error';
      const message = cancelled ? '运行已由用户停止' : error instanceof Error ? error.message : '运行失败';
      setNodes((items) => items.map((node) => node.data.status === 'running' || node.data.status === 'waiting' ? { ...node, data: { ...node.data, status: cancelled ? 'cancelled' : 'error' } } : node));
      logs.forEach((log, index) => { if (log.status === 'running') logs[index] = { ...log, status: cancelled ? 'muted' : 'error', detail: message }; });
      setRunLogs([...logs]);
      finalResult = cancelled ? { notice: message } : { error: message };
      setResult(finalResult);
      setActiveDebug('logs');
    } finally {
      saveRecord();
      abortControllerRef.current = null;
      setRunning(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="editor-header">
        <div className="header-left">
          <button className="icon-button" aria-label="返回编排" onClick={() => { setWorkspaceView('editor'); setToast('已返回工作流编排'); }}><ArrowLeft size={18} /></button>
          <BrandMark />
          <span className="header-divider" />
          <div className="workflow-title">
            <strong>社媒主视觉生成器</strong>
            <span><Check size={12} /> 已保存</span>
          </div>
        </div>
        <nav className="header-center" aria-label="工作流导航">
          <button className={workspaceView === 'editor' ? 'active' : ''} onClick={() => setWorkspaceView('editor')}>编排</button>
          <button className={workspaceView === 'runs' ? 'active' : ''} onClick={() => setWorkspaceView('runs')}>运行记录</button>
          <button className={workspaceView === 'versions' ? 'active' : ''} onClick={() => setWorkspaceView('versions')}>版本</button>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="撤销" onClick={undo} disabled={!undoStack.length || running}><Undo2 size={17} /></button>
          <button className="ghost-button" onClick={openSettings}><Settings size={16} /> 模型配置</button>
          {running ? <button className="stop-button" onClick={stopWorkflow}><Square size={14} fill="currentColor" /> 停止运行</button> : <button className="run-button" onClick={runWorkflow}><Play size={16} fill="currentColor" />试运行</button>}
          <button className="publish-button" onClick={publishWorkflow} disabled={running}><Rocket size={16} /> 发布</button>
        </div>
      </header>

      <main className={`editor-layout ${debugOpen && workspaceView === 'editor' ? 'debug-open' : ''} ${!libraryOpen ? 'library-closed' : ''} ${!configPanelOpen ? 'config-closed' : ''}`}>
        {libraryOpen && <aside className="node-library">
          <div className="panel-heading">
            <div><span>节点库</span><small>{nodes.length} 个节点</small></div>
            <button className="icon-button tiny" aria-label="折叠节点库" onClick={() => setLibraryOpen(false)}><Menu size={16} /></button>
          </div>
          <label className="search-box"><Search size={15} /><input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="搜索节点" /></label>
          <div className="node-groups">
            {['输入输出', 'AI 能力', '逻辑', '工具'].map((group) => {
              const kinds = filteredKinds.filter((kind) => nodeMeta[kind].group === group);
              if (!kinds.length) return null;
              return <section key={group}>
                <h3>{group}<ChevronDown size={13} /></h3>
                {kinds.map((kind) => {
                  const meta = nodeMeta[kind];
                  const Icon = meta.icon;
                  return <button className="library-item" key={kind} onClick={() => addNode(kind)}>
                    <span className="library-icon" style={{ color: meta.color }}><Icon size={17} /></span>
                    <span><strong>{meta.label}</strong><small>{kind === 'llm' ? '对话、推理与结构化输出' : kind === 'image' ? '生成图片资产' : kind === 'http' ? '调用外部 API' : '工作流基础节点'}</small></span>
                    <Plus size={14} />
                  </button>;
                })}
              </section>;
            })}
          </div>
          <button className="library-help" onClick={completeSuggestedWorkflow}><Sparkles size={15} /> 从自然语言生成工作流</button>
        </aside>}

        <section className="canvas-wrap">
          {workspaceView === 'editor' ? <>
          <div className="canvas-breadcrumb"><span>工作流</span><b>/</b><strong>社媒主视觉生成器</strong></div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => { setSelectedId(node.id); setConfigPanelOpen(true); }}
            onNodeDragStart={rememberSnapshot}
            fitView
            minZoom={0.45}
            maxZoom={1.5}
            defaultEdgeOptions={{ style: { stroke: '#737b88', strokeWidth: 1.5 } }}
          >
            <Background color="rgba(255,255,255,.13)" gap={22} size={1} />
            <MiniMap nodeColor={(node) => nodeMeta[(node.data as FlowData).kind].color} maskColor="rgba(8,9,11,.82)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="canvas-status"><span className="live-dot" /> 自动保存已开启 <b>·</b> 画布可拖拽缩放</div>
          </> : workspaceView === 'runs' ? <div className="workspace-data-view">
            <header><div><strong>运行记录</strong><small>最近 {runRecords.length} 次工作流执行</small></div></header>
            {runRecords.length ? <div className="record-list">{runRecords.map((record) => <article key={record.id}><span className={`record-state ${record.status}`} /> <div><strong>{record.status === 'success' ? '运行成功' : record.status === 'cancelled' ? '用户停止' : '运行失败'}</strong><small>{new Date(record.startedAt).toLocaleString()} · {record.logs.length} 个节点</small></div><code>{record.duration}</code><button onClick={() => { setRunLogs(record.logs); setResult(record.result); setWorkspaceView('editor'); setDebugOpen(true); setActiveDebug(record.status === 'success' ? 'output' : 'logs'); }}>查看详情</button></article>)}</div> : <div className="data-empty"><TerminalSquare size={24} /><strong>暂无运行记录</strong><span>试运行工作流后会自动保存在这里</span></div>}
          </div> : <div className="workspace-data-view">
            <header><div><strong>发布版本</strong><small>可恢复最近 20 个本地版本</small></div><button className="publish-button" onClick={publishWorkflow}><Rocket size={14} />发布当前版本</button></header>
            {versions.length ? <div className="record-list version-list">{versions.map((version) => <article key={`${version.id}-${version.createdAt}`}><span className="version-badge">{version.id}</span><div><strong>{version.nodes.length} 个节点 · {version.edges.length} 条连接</strong><small>{new Date(version.createdAt).toLocaleString()}</small></div><button onClick={() => restoreVersion(version)}>恢复到画布</button></article>)}</div> : <div className="data-empty"><Rocket size={24} /><strong>尚未发布版本</strong><span>点击右上角“发布”保存首个版本</span></div>}
          </div>}
          {!libraryOpen && <button className="open-side-panel left" onClick={() => setLibraryOpen(true)}><PanelLeftOpen size={15} />展开节点库</button>}
          {!configPanelOpen && <button className="open-side-panel right" onClick={() => setConfigPanelOpen(true)}><PanelRightOpen size={15} />展开配置</button>}
        </section>

        {configPanelOpen && <aside className="config-panel">
          <div className="panel-heading">
            <div><span>节点配置</span><small>{selectedNode?.data.kind ? nodeMeta[selectedNode.data.kind].label : '未选择'}</small></div>
            <button className="icon-button tiny" aria-label="关闭节点配置" onClick={() => setConfigPanelOpen(false)}><X size={16} /></button>
          </div>
          {selectedNode ? <div className="config-content">
            <div className="selected-summary">
              <span className="node-icon" style={{ color: nodeMeta[selectedNode.data.kind].color }}>{(() => { const Icon = nodeMeta[selectedNode.data.kind].icon; return <Icon size={17} />; })()}</span>
              <div><strong>{selectedNode.data.title}</strong><small>ID · {selectedNode.id}</small></div>
              <MoreHorizontal size={16} />
            </div>
            <div className="form-section">
              <h3>基础信息</h3>
              <label>节点名称<input value={selectedNode.data.title} onChange={(event) => updateSelected({ title: event.target.value })} /></label>
            </div>
            {(selectedNode.data.kind === 'llm' || selectedNode.data.kind === 'image') && <div className="form-section">
              <h3>模型</h3>
              <label>模型 ID
                <select value={selectedNode.data.model || ''} onChange={(event) => updateSelected({ model: event.target.value, subtitle: event.target.value })}>
                  {selectedNode.data.kind === 'image' ? <option value="gpt-image-2">gpt-image-2</option> : <>
                    <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                    <option value="gpt-5.6-terra">gpt-5.6-terra</option>
                    <option value="gpt-5.6-sol">gpt-5.6-sol</option>
                  </>}
                </select>
              </label>
              <div className="credential-row"><KeyRound size={14} /><span>{selectedNode.data.kind === 'image' ? '图像模型凭证' : '基础模型凭证'}</span><b className={selectedNode.data.kind === 'image' ? config?.imageConfigured ? 'ok' : '' : config?.chatConfigured ? 'ok' : ''}>{selectedNode.data.kind === 'image' ? config?.imageConfigured ? '已配置' : '未配置' : config?.chatConfigured ? '已配置' : '未配置'}</b></div>
            </div>}
            {selectedNode.data.kind === 'llm' && <div className="form-section">
              <h3>提示词</h3>
              <label>系统指令<textarea rows={7} value={selectedNode.data.prompt || ''} onChange={(event) => updateSelected({ prompt: event.target.value })} /></label>
              <button className="variable-button" onClick={() => updateSelected({ prompt: `${selectedNode.data.prompt || ''}${selectedNode.data.prompt ? '\n' : ''}{{workflow.input}}` })}><Braces size={14} /> 插入变量</button>
            </div>}
            {selectedNode.data.kind === 'image' && <div className="form-section">
              <h3>生成参数</h3>
              <label>画面比例</label>
              <div className="ratio-preset-grid">
                {imageSizePresets.map((preset) => <button
                  type="button"
                  key={preset.size}
                  className={(selectedNode.data.imageSize || '1024x1024') === preset.size ? 'active' : ''}
                  aria-label={`${preset.ratio} ${preset.width} × ${preset.height}`}
                  onClick={() => updateSelected({ imageSize: preset.size, subtitle: `${selectedNode.data.model || 'gpt-image-2'} · ${preset.ratio} · ${preset.width}×${preset.height}` })}
                >
                  <span className="ratio-preview"><i style={{ aspectRatio: `${preset.width} / ${preset.height}` }} /></span>
                  <strong>{preset.ratio}</strong>
                  <code>{preset.width}×{preset.height}</code>
                  <small>{preset.hint}</small>
                </button>)}
              </div>
              <label>质量<select value={selectedNode.data.imageQuality || 'high'} onChange={(event) => updateSelected({ imageQuality: event.target.value as FlowData['imageQuality'] })}><option value="high">High</option><option value="medium">Medium</option></select></label>
              <div className="ratio-note"><ImageIcon size={14} /><span><strong>尺寸兼容提醒</strong>实际输出以模型渠道支持为准；不支持任意尺寸时，网关可能返回参数错误或进行适配裁切。</span></div>
            </div>}
            {selectedNode.data.kind === 'condition' && <div className="form-section">
              <h3>判断规则</h3>
              <label>判断来源<select value={selectedNode.data.conditionSource || 'upstream'} onChange={(event) => updateSelected({ conditionSource: event.target.value as FlowData['conditionSource'] })}><option value="upstream">上游节点输出</option><option value="input">工作流原始输入</option></select></label>
              <label>运算符<select value={selectedNode.data.conditionOperator || 'contains'} onChange={(event) => updateSelected({ conditionOperator: event.target.value as FlowData['conditionOperator'] })}><option value="contains">包含</option><option value="not_contains">不包含</option><option value="equals">等于</option><option value="not_equals">不等于</option></select></label>
              <label>比较值<input value={selectedNode.data.conditionValue || ''} onChange={(event) => updateSelected({ conditionValue: event.target.value })} placeholder="输入判断内容" /></label>
              <div className="branch-help"><span><i className="true" />true 出口</span><span><i className="false" />false 出口</span></div>
            </div>}
            {selectedNode.data.kind === 'http' && <div className="form-section">
              <h3>HTTP 请求</h3>
              <label>请求方法<select value={selectedNode.data.httpMethod || 'GET'} onChange={(event) => updateSelected({ httpMethod: event.target.value as FlowData['httpMethod'], subtitle: `${event.target.value} · ${selectedNode.data.httpUrl || '未配置 URL'}` })}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
              <label>URL<input value={selectedNode.data.httpUrl || ''} onChange={(event) => updateSelected({ httpUrl: event.target.value, subtitle: `${selectedNode.data.httpMethod || 'GET'} · ${event.target.value || '未配置 URL'}` })} placeholder="https://api.example.com/data" /></label>
              <label>Headers（JSON）<textarea rows={4} value={selectedNode.data.httpHeaders || '{}'} onChange={(event) => updateSelected({ httpHeaders: event.target.value })} /></label>
              {selectedNode.data.httpMethod !== 'GET' && <label>Body<textarea rows={5} value={selectedNode.data.httpBody || ''} onChange={(event) => updateSelected({ httpBody: event.target.value })} placeholder={'可使用 {{input}} 引用上游文本'} /></label>}
            </div>}
            {selectedNode.data.kind === 'code' && <div className="form-section">
              <h3>JavaScript</h3>
              <label>执行代码<textarea className="code-editor" rows={9} value={selectedNode.data.code || ''} onChange={(event) => updateSelected({ code: event.target.value })} /></label>
              <div className="code-note">在独立 Web Worker 中运行，使用 <code>input</code> 和 <code>context</code>，最长 5 秒。</div>
            </div>}
            <div className="form-section output-schema">
              <h3>输出</h3>
              <div><FileJson size={15} /><span>output</span><code>{selectedNode.data.kind === 'image' ? 'asset' : selectedNode.data.kind === 'condition' ? 'boolean' : selectedNode.data.kind === 'http' ? 'object' : selectedNode.data.kind === 'code' ? 'any' : 'string'}</code></div>
            </div>
            <div className="form-section danger-zone"><button onClick={() => deleteNode(selectedNode.id)}><Trash2 size={14} />删除此节点</button><small>删除后连接会一并移除，可使用撤销恢复。</small></div>
          </div> : <div className="empty-panel">选择一个节点查看配置</div>}
        </aside>}

        {workspaceView === 'editor' && <section className="debug-panel">
          <div className="debug-head">
            <div className="debug-tabs">
              <button className={activeDebug === 'process' ? 'active' : ''} onClick={() => setActiveDebug('process')}>运行过程</button>
              <button className={activeDebug === 'output' ? 'active' : ''} onClick={() => setActiveDebug('output')}>最终输出</button>
              <button className={activeDebug === 'logs' ? 'active' : ''} onClick={() => setActiveDebug('logs')}>日志</button>
            </div>
            <div><span className={`config-pill ${config?.chatConfigured && config?.imageConfigured ? 'ready' : ''}`}><span /> {config?.chatConfigured && config?.imageConfigured ? '模型已连接' : '等待模型配置'}</span><button className="icon-button tiny" onClick={() => setDebugOpen(false)}><PanelBottomClose size={16} /></button></div>
          </div>
          <div className="debug-body">
            <div className="test-input">
              <label className="input-caption">测试输入 <span>workflow.input.topic</span></label>
              <textarea value={input} onChange={(event) => setInput(event.target.value)} />
              <div
                className={`image-dropzone ${draggingImage ? 'dragging' : ''} ${referenceImage ? 'has-image' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setDraggingImage(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingImage(false); }}
                onDrop={(event) => { event.preventDefault(); setDraggingImage(false); setReferenceFile(event.dataTransfer.files[0]); }}
              >
                {referenceImage ? <>
                  <img src={referenceImage.dataUrl} alt="参考图片预览" />
                  <div><strong>{referenceImage.name}</strong><small>{(referenceImage.size / 1024 / 1024).toFixed(2)} MB · 将用于扩展生图</small></div>
                  <button type="button" className="remove-reference" aria-label="移除参考图片" onClick={() => setReferenceImage(null)}><Trash2 size={14} /></button>
                </> : <label htmlFor="reference-image-input"><Upload size={17} /><span><strong>添加参考图片</strong><small>点击或拖入 PNG / JPG / WebP，最大 10 MB</small></span></label>}
                <input id="reference-image-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setReferenceFile(event.target.files?.[0]); event.target.value = ''; }} />
              </div>
              {imageInputError && <span className="input-error">{imageInputError}</span>}
              {running ? <button className="inline-stop" onClick={stopWorkflow}><Square size={13} fill="currentColor" />停止运行</button> : <button onClick={runWorkflow} disabled={!input.trim()}><Play size={15} fill="currentColor" />运行工作流</button>}
            </div>
            <div className="run-output">
              {activeDebug === 'process' && <div className="run-timeline">{runLogs.map((log) => <div className={`timeline-item ${log.status}`} key={log.id}><span className="timeline-status">{log.status === 'success' ? <Check size={13} /> : log.status === 'running' ? <LoaderCircle className="spin" size={13} /> : log.status === 'error' ? <X size={13} /> : <span />}</span><div><strong>{log.title}</strong><small>{log.detail}</small></div><time>{log.elapsed}</time></div>)}</div>}
              {activeDebug === 'output' && <div className="output-box">
                <div className="output-box-head"><div><strong>工作流输出</strong><small>文字、图像与文件统一接取</small></div><span className={result.text || result.image || result.files?.length ? 'has-output' : ''}>{result.text || result.image || result.files?.length ? '已生成' : '等待输出'}</span></div>
                {!result.text && !result.image && !result.files?.length && <div className="output-empty"><FileJson size={24} /><strong>尚无输出结果</strong><span>运行完成后，可在这里复制文字或下载生成资产</span></div>}
                {result.text && <section className="output-item text-output">
                  <header><div><FileText size={15} /><span><strong>文字输出</strong><small>text / plain</small></span></div><div><button type="button" onClick={copyOutputText}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制'}</button><button type="button" onClick={downloadOutputText}><Download size={13} />下载 TXT</button></div></header>
                  <p>{result.text}</p>
                </section>}
                {result.image && <section className="output-item image-output">
                  <button type="button" className="image-result-trigger" aria-label="预览生成图片" style={outputImageStyle(result.imageAspectRatio)} onClick={() => setImagePreviewOpen(true)}>
                    <img src={result.image} alt="工作流生成结果" onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setResult((previous) => ({ ...previous, imageAspectRatio: `${image.naturalWidth} / ${image.naturalHeight}` })); }} />
                    <span><ZoomIn size={16} />单击预览</span>
                  </button>
                  <div><span><ImageIcon size={15} /><strong>图像输出</strong></span><small>PNG · {aspectRatioLabel(result.imageAspectRatio)}</small><button type="button" onClick={() => downloadOutputAsset(result.image!, 'workflow-image.png')}><Download size={13} />下载图片</button></div>
                </section>}
                {result.files?.map((file) => <section className="output-item file-output" key={file.url}><FileJson size={17} /><div><strong>{file.name}</strong><small>{file.mimeType || 'application/octet-stream'}</small></div><button type="button" onClick={() => downloadOutputAsset(file.url, file.name)}><Download size={13} />下载</button></section>)}
              </div>}
              {activeDebug === 'logs' && <div className={`log-view ${result.error ? 'error' : ''}`}><TerminalSquare size={17} /><pre>{result.error ? `[ERROR] ${result.error}` : result.notice ? `[INFO] ${result.notice}` : '[INFO] 暂无错误日志\n[INFO] 本地 API 网关已就绪'}</pre></div>}
            </div>
          </div>
        </section>}
        {workspaceView === 'editor' && !debugOpen && <button className="open-debug" onClick={() => setDebugOpen(true)}><TerminalSquare size={15} /> 打开调试台</button>}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}

      {imagePreviewOpen && result.image && <div className="image-preview-backdrop" role="presentation" onMouseDown={() => setImagePreviewOpen(false)}>
        <section className="image-preview-dialog" role="dialog" aria-modal="true" aria-label="图片预览" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><ImageIcon size={16} /><span><strong>生成结果预览</strong><small>{aspectRatioLabel(result.imageAspectRatio)} · 单击空白处或按 Esc 关闭</small></span></div><div><button onClick={() => downloadOutputAsset(result.image!, 'workflow-image.png')}><Download size={15} />下载</button><button className="icon-button" aria-label="关闭图片预览" onClick={() => setImagePreviewOpen(false)}><X size={18} /></button></div></header>
          <div className="image-preview-stage"><img src={result.image} alt="生成结果大图预览" /></div>
        </section>
      </div>}

      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={closeSettings}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-label="模型配置" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="modal-icon"><Settings size={18} /></span><div><strong>模型服务配置</strong><small>{config?.chatConfigured && config?.imageConfigured ? 'OpenAI 兼容网关' : '首次使用需要完成 API Key 配置'}</small></div></div><button className="icon-button" onClick={closeSettings} aria-label="关闭模型配置"><X size={18} /></button></header>
          <div className="settings-body">
            <div className="gateway-card"><span>API Base URL</span><code>{config?.baseUrl || 'https://ai.aiwanai.com.cn/v1'}</code></div>
            <div className="connection-list">
              <article><span className="connection-icon"><Bot size={18} /></span><div><strong>基础模型</strong><small>{config?.defaultChatModel || 'gpt-5.4-mini'}</small></div><b className={config?.chatConfigured ? 'connected' : ''}>{config?.chatConfigured ? '已连接' : '未配置'}</b></article>
              <article><span className="connection-icon warm"><ImageIcon size={18} /></span><div><strong>GPT Image 2</strong><small>{config?.imageModel || 'gpt-image-2'}</small></div><b className={config?.imageConfigured ? 'connected' : ''}>{config?.imageConfigured ? '已连接' : '未配置'}</b></article>
            </div>
            <div className="key-fields">
              <label className={clearChatKey ? 'is-clearing' : ''}>
                <span><b>基础模型 API Key</b><small>{config?.chatConfigured ? `已保存 ${config.chatKeyHint || ''}` : '尚未配置'}</small></span>
                <div className="secret-input"><KeyRound size={15} /><input type="password" autoComplete="new-password" value={chatApiKey} onChange={(event) => { setChatApiKey(event.target.value); setClearChatKey(false); }} disabled={clearChatKey} placeholder={config?.chatConfigured ? '留空则保持当前 Key' : '手动填写 API Key'} /></div>
                {config?.chatConfigured && <button type="button" className="clear-key-button" onClick={() => { setClearChatKey((value) => !value); setChatApiKey(''); }}>{clearChatKey ? '取消清除' : '清除已保存 Key'}</button>}
              </label>
              <label className={clearImageKey ? 'is-clearing' : ''}>
                <span><b>GPT Image 2 API Key</b><small>{config?.imageConfigured ? `已保存 ${config.imageKeyHint || ''}` : '尚未配置'}</small></span>
                <div className="secret-input"><KeyRound size={15} /><input type="password" autoComplete="new-password" value={imageApiKey} onChange={(event) => { setImageApiKey(event.target.value); setClearImageKey(false); }} disabled={clearImageKey} placeholder={config?.imageConfigured ? '留空则保持当前 Key' : '手动填写 API Key'} /></div>
                {config?.imageConfigured && <button type="button" className="clear-key-button" onClick={() => { setClearImageKey((value) => !value); setImageApiKey(''); }}>{clearImageKey ? '取消清除' : '清除已保存 Key'}</button>}
              </label>
            </div>
            {configMessage && <div className={`config-message ${configMessage.kind}`}>{configMessage.kind === 'success' && <Check size={14} />}{configMessage.text}</div>}
            <div className="security-note"><KeyRound size={17} /><p><strong>Key 仅保存在当前浏览器 localStorage</strong><span>服务端不持久化完整 Key；模型调用时 Key 仅随本次请求发送。清理浏览器站点数据会同时删除配置。</span></p></div>
          </div>
          <footer><button className="ghost-button" onClick={closeSettings} disabled={configSaving}>关闭</button><button className="publish-button" onClick={saveApiKeys} disabled={configSaving}>{configSaving ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}{configSaving ? '保存中' : '保存配置'}</button></footer>
        </section>
      </div>}
    </div>
  );
}

export default App;
