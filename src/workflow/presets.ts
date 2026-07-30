export type PresetCredential = 'chat' | 'image';

export type PresetOutputType = 'text' | 'json' | 'image' | 'file';

export type PresetNodeData = Record<string, unknown> & {
  kind: 'start' | 'llm' | 'image' | 'condition' | 'http' | 'code' | 'output';
  title: string;
  subtitle: string;
  status?: string;
};

export type PresetNode = {
  id: string;
  type: 'flowNode';
  position: { x: number; y: number };
  data: PresetNodeData;
};

export type PresetEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

export type PresetExpectedOutput = {
  key: string;
  label: string;
  type: PresetOutputType;
  sourceNodeId: string;
  required: boolean;
};

export type WorkflowPreset = {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  tags: string[];
  sampleInput: string;
  expectedOutputs: PresetExpectedOutput[];
  requiredCredentials: PresetCredential[];
  nodes: PresetNode[];
  edges: PresetEdge[];
};

export type WorkflowPresetInstance = Omit<WorkflowPreset, 'nodes' | 'edges'> & {
  instanceId: string;
  nodes: PresetNode[];
  edges: PresetEdge[];
};

type OutputBinding = {
  id: string;
  key: string;
  label: string;
  type: PresetOutputType;
  source: { nodeId: string; path: string };
  required: boolean;
};

const node = (
  id: string,
  kind: PresetNodeData['kind'],
  title: string,
  subtitle: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {}
): PresetNode => ({
  id,
  type: 'flowNode',
  position: { x, y },
  data: { kind, title, subtitle, ...config }
});

const edge = (id: string, source: string, target: string, sourceHandle?: string): PresetEdge => ({
  id,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {})
});

const binding = (
  id: string,
  key: string,
  label: string,
  type: PresetOutputType,
  sourceNodeId: string,
  path: string,
  required = true
): OutputBinding => ({ id, key, label, type, source: { nodeId: sourceNodeId, path }, required });

export const ecommerceWorkflowPresets: readonly WorkflowPreset[] = [
  {
    id: 'ecommerce-product-hero',
    version: 1,
    name: '商品主图与卖点',
    description: '根据商品信息生成核心卖点、视觉提示词与 1:1 电商主图。',
    category: '电商营销',
    tags: ['商品主图', '卖点', '文生图'],
    sampleInput: '产品：便携式冷萃咖啡杯；材质：Tritan；容量：450ml；目标人群：通勤白领；风格：清爽、专业。',
    expectedOutputs: [
      { key: 'sellingPoints', label: '商品卖点与视觉方案', type: 'text', sourceNodeId: 'hero-copy', required: true },
      { key: 'mainImage', label: '商品主图', type: 'image', sourceNodeId: 'hero-image', required: true }
    ],
    requiredCredentials: ['chat', 'image'],
    nodes: [
      node('hero-start', 'start', '商品信息', '名称、规格、人群与视觉风格', 60, 210),
      node('hero-copy', 'llm', '提炼卖点与视觉方案', 'gpt-5.4-mini', 350, 150, {
        model: 'gpt-5.4-mini',
        prompt: '你是电商创意总监。提炼 3 条可验证的商品卖点，并输出一段突出主体、光线、布景和品牌气质的中文生图提示词。'
      }),
      node('hero-image', 'image', '生成商品主图', 'gpt-image-2 · 1:1 · 1024×1024', 670, 100, {
        model: 'gpt-image-2', imageSize: '1024x1024', imageQuality: 'high'
      }),
      node('hero-output', 'output', '交付商品素材', '卖点文案与商品主图', 1010, 210, {
        outputKey: 'product_assets',
        bindings: [
          binding('hero-copy-binding', 'sellingPoints', '商品卖点与视觉方案', 'text', 'hero-copy', 'text'),
          binding('hero-image-binding', 'mainImage', '商品主图', 'image', 'hero-image', 'image')
        ]
      })
    ],
    edges: [
      edge('hero-e1', 'hero-start', 'hero-copy'),
      edge('hero-e2', 'hero-copy', 'hero-image'),
      edge('hero-e3', 'hero-copy', 'hero-output'),
      edge('hero-e4', 'hero-image', 'hero-output')
    ]
  },
  {
    id: 'ecommerce-multichannel-campaign',
    version: 1,
    name: '多渠道营销套图',
    description: '一次生成方形、详情页竖图和移动端全屏图，并保留统一的营销文案。',
    category: '电商营销',
    tags: ['多渠道', '营销套图', '多输出'],
    sampleInput: '夏季新品防晒衣，主打 UPF100+、冰感透气、轻量收纳，促销主题为“城市轻户外”。',
    expectedOutputs: [
      { key: 'campaignCopy', label: '统一营销文案', type: 'text', sourceNodeId: 'campaign-copy', required: true },
      { key: 'squareImage', label: '方形渠道图', type: 'image', sourceNodeId: 'campaign-square', required: true },
      { key: 'detailImage', label: '详情页竖图', type: 'image', sourceNodeId: 'campaign-detail', required: true },
      { key: 'mobileImage', label: '移动端全屏图', type: 'image', sourceNodeId: 'campaign-mobile', required: true }
    ],
    requiredCredentials: ['chat', 'image'],
    nodes: [
      node('campaign-start', 'start', '营销需求', '商品、活动主题与渠道', 50, 260),
      node('campaign-copy', 'llm', '统一创意与文案', 'gpt-5.4-mini', 320, 260, {
        model: 'gpt-5.4-mini',
        prompt: '生成统一的活动主张、短标题、利益点和视觉系统提示词。提示词需能安全适配不同画幅，并保持商品主体与品牌色一致。'
      }),
      node('campaign-square', 'image', '方形渠道图', 'gpt-image-2 · 1:1 · 1024×1024', 630, 40, {
        model: 'gpt-image-2', imageSize: '1024x1024', imageQuality: 'high'
      }),
      node('campaign-detail', 'image', '详情页竖图', 'gpt-image-2 · 3:4 · 1152×1536', 630, 240, {
        model: 'gpt-image-2', imageSize: '1152x1536', imageQuality: 'high'
      }),
      node('campaign-mobile', 'image', '移动端全屏图', 'gpt-image-2 · 9:16 · 864×1536', 630, 440, {
        model: 'gpt-image-2', imageSize: '864x1536', imageQuality: 'high'
      }),
      node('campaign-output', 'output', '营销套图交付', '1 份文案与 3 张渠道图', 1010, 260, {
        outputKey: 'campaign_assets',
        bindings: [
          binding('campaign-copy-binding', 'campaignCopy', '统一营销文案', 'text', 'campaign-copy', 'text'),
          binding('campaign-square-binding', 'squareImage', '方形渠道图', 'image', 'campaign-square', 'image'),
          binding('campaign-detail-binding', 'detailImage', '详情页竖图', 'image', 'campaign-detail', 'image'),
          binding('campaign-mobile-binding', 'mobileImage', '移动端全屏图', 'image', 'campaign-mobile', 'image')
        ]
      })
    ],
    edges: [
      edge('campaign-e1', 'campaign-start', 'campaign-copy'),
      edge('campaign-e2', 'campaign-copy', 'campaign-square'),
      edge('campaign-e3', 'campaign-copy', 'campaign-detail'),
      edge('campaign-e4', 'campaign-copy', 'campaign-mobile'),
      edge('campaign-e5', 'campaign-copy', 'campaign-output'),
      edge('campaign-e6', 'campaign-square', 'campaign-output'),
      edge('campaign-e7', 'campaign-detail', 'campaign-output'),
      edge('campaign-e8', 'campaign-mobile', 'campaign-output')
    ]
  },
  {
    id: 'ecommerce-product-detail-copy',
    version: 1,
    name: '商品详情页文案包',
    description: '并行生成标题、五点卖点和详情页长文，减少多轮重复编辑。',
    category: '电商内容',
    tags: ['详情页', '多文案', '多输出'],
    sampleInput: '产品：人体工学升降桌；尺寸：120×60cm；双电机；承重 80kg；目标用户：居家办公人群。',
    expectedOutputs: [
      { key: 'titles', label: '商品标题候选', type: 'text', sourceNodeId: 'detail-title', required: true },
      { key: 'bulletPoints', label: '五点卖点', type: 'text', sourceNodeId: 'detail-bullets', required: true },
      { key: 'detailCopy', label: '详情页长文', type: 'text', sourceNodeId: 'detail-longform', required: true }
    ],
    requiredCredentials: ['chat'],
    nodes: [
      node('detail-start', 'start', '商品资料', '参数、受众与语气', 60, 260),
      node('detail-title', 'llm', '生成标题候选', 'gpt-5.4-mini', 390, 60, {
        model: 'gpt-5.4-mini', prompt: '生成 5 个准确、清晰、不过度承诺的电商商品标题，并说明每个标题的关键词策略。'
      }),
      node('detail-bullets', 'llm', '生成五点卖点', 'gpt-5.4-mini', 390, 250, {
        model: 'gpt-5.4-mini', prompt: '按“功能—证据—用户收益”的结构生成五点卖点。不得虚构输入中未提供的认证或参数。'
      }),
      node('detail-longform', 'llm', '生成详情页长文', 'gpt-5.4-mini', 390, 440, {
        model: 'gpt-5.4-mini', prompt: '生成适合商品详情页的分段长文，包含使用场景、核心功能、规格说明与购买提示。'
      }),
      node('detail-output', 'output', '交付详情页文案', '标题、卖点与长文', 820, 260, {
        outputKey: 'detail_copy_package',
        bindings: [
          binding('detail-title-binding', 'titles', '商品标题候选', 'text', 'detail-title', 'text'),
          binding('detail-bullets-binding', 'bulletPoints', '五点卖点', 'text', 'detail-bullets', 'text'),
          binding('detail-longform-binding', 'detailCopy', '详情页长文', 'text', 'detail-longform', 'text')
        ]
      })
    ],
    edges: [
      edge('detail-e1', 'detail-start', 'detail-title'),
      edge('detail-e2', 'detail-start', 'detail-bullets'),
      edge('detail-e3', 'detail-start', 'detail-longform'),
      edge('detail-e4', 'detail-title', 'detail-output'),
      edge('detail-e5', 'detail-bullets', 'detail-output'),
      edge('detail-e6', 'detail-longform', 'detail-output')
    ]
  },
  {
    id: 'ecommerce-event-channel-router',
    version: 1,
    name: '活动素材条件分流',
    description: '识别直播或短视频需求，自动选择移动端竖图，否则生成横版活动主视觉。',
    category: '电商营销',
    tags: ['条件分支', '活动素材', '渠道适配'],
    sampleInput: '为周末直播间生成一张夏日清仓活动视觉，主色为珊瑚橙，突出“限时直降”。',
    expectedOutputs: [
      { key: 'mobileEventImage', label: '直播/短视频竖图', type: 'image', sourceNodeId: 'event-mobile', required: false },
      { key: 'landscapeEventImage', label: '通用横版活动图', type: 'image', sourceNodeId: 'event-landscape', required: false }
    ],
    requiredCredentials: ['image'],
    nodes: [
      node('event-start', 'start', '活动需求', '活动主题、渠道与视觉风格', 60, 230),
      node('event-condition', 'condition', '判断移动端渠道', '包含“直播”或“短视频”时走 true', 360, 230, {
        conditionSource: 'input', conditionOperator: 'contains', conditionValue: '直播|短视频'
      }),
      node('event-mobile', 'image', '直播/短视频竖图', 'gpt-image-2 · 9:16 · 864×1536', 690, 90, {
        model: 'gpt-image-2', imageSize: '864x1536', imageQuality: 'high'
      }),
      node('event-landscape', 'image', '通用横版活动图', 'gpt-image-2 · 16:9 · 1536×864', 690, 370, {
        model: 'gpt-image-2', imageSize: '1536x864', imageQuality: 'high'
      }),
      node('event-output', 'output', '交付活动素材', '输出命中渠道的活动图', 1030, 230, {
        outputKey: 'event_assets',
        bindings: [
          binding('event-mobile-binding', 'mobileEventImage', '直播/短视频竖图', 'image', 'event-mobile', 'image', false),
          binding('event-landscape-binding', 'landscapeEventImage', '通用横版活动图', 'image', 'event-landscape', 'image', false)
        ]
      })
    ],
    edges: [
      edge('event-e1', 'event-start', 'event-condition'),
      edge('event-e2', 'event-condition', 'event-mobile', 'true'),
      edge('event-e3', 'event-condition', 'event-landscape', 'false'),
      edge('event-e4', 'event-mobile', 'event-output'),
      edge('event-e5', 'event-landscape', 'event-output')
    ]
  }
] as const;

let fallbackIdSequence = 0;

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackIdSequence += 1;
  return `${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneDataOnly<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function instantiatePreset(
  preset: WorkflowPreset,
  idFactory: () => string = defaultIdFactory
): WorkflowPresetInstance {
  const cloned = cloneDataOnly(preset);
  const nodeIds = new Map<string, string>();

  const nodes = cloned.nodes.map((presetNode) => {
    const nextId = `${preset.id}-node-${idFactory()}`;
    nodeIds.set(presetNode.id, nextId);
    const data = { ...presetNode.data };
    delete data.status;
    return { ...presetNode, id: nextId, data };
  });

  const remapNodeId = (nodeId: string) => {
    const mapped = nodeIds.get(nodeId);
    if (!mapped) throw new Error(`Preset ${preset.id} references unknown node: ${nodeId}`);
    return mapped;
  };

  const edges = cloned.edges.map((presetEdge) => ({
    ...presetEdge,
    id: `${preset.id}-edge-${idFactory()}`,
    source: remapNodeId(presetEdge.source),
    target: remapNodeId(presetEdge.target)
  }));

  const expectedOutputs = cloned.expectedOutputs.map((output) => ({
    ...output,
    sourceNodeId: remapNodeId(output.sourceNodeId)
  }));

  const remappedNodes = nodes.map((presetNode) => {
    const bindings = presetNode.data.bindings;
    if (!Array.isArray(bindings)) return presetNode;
    return {
      ...presetNode,
      data: {
        ...presetNode.data,
        bindings: bindings.map((item) => {
          const current = item as OutputBinding;
          return {
            ...current,
            id: `${preset.id}-binding-${idFactory()}`,
            source: { ...current.source, nodeId: remapNodeId(current.source.nodeId) }
          };
        })
      }
    };
  });

  return {
    ...cloned,
    instanceId: `${preset.id}-instance-${idFactory()}`,
    expectedOutputs,
    nodes: remappedNodes,
    edges
  };
}

export function getEcommercePreset(presetId: string) {
  return ecommerceWorkflowPresets.find((preset) => preset.id === presetId);
}
