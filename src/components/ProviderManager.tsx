import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Plus,
  Save,
  ServerCog,
  Trash2,
  Webhook,
  X
} from 'lucide-react';
import {
  keyHint,
  type ChatApiProtocol,
  type ModelCapability,
  type ModelProvider,
  type ProviderModel
} from '../providerConfig';

type ProviderManagerProps = {
  providers: ModelProvider[];
  onSave: (provider: ModelProvider) => string | null;
  onDelete: (providerId: string) => void;
};

const blankProvider = (): ModelProvider => ({
  id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  baseUrl: 'https://ai.aiwanai.com.cn/v1',
  apiKey: '',
  models: []
});

const cloneProvider = (provider: ModelProvider): ModelProvider => ({ ...provider, models: provider.models.map((model) => ({ ...model })) });

export function ProviderManager({ providers, onSave, onDelete }: ProviderManagerProps) {
  const [selectedId, setSelectedId] = useState(providers[0]?.id || '');
  const [draft, setDraft] = useState<ModelProvider>(() => providers[0] ? cloneProvider(providers[0]) : blankProvider());
  const [modelId, setModelId] = useState('');
  const [modelCapability, setModelCapability] = useState<ModelCapability>('chat');
  const [modelProtocol, setModelProtocol] = useState<ChatApiProtocol>('chat-completions');
  const [showKey, setShowKey] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const totals = useMemo(() => ({
    configured: providers.filter((provider) => provider.apiKey).length,
    chat: providers.flatMap((provider) => provider.models).filter((model) => model.capability === 'chat').length,
    image: providers.flatMap((provider) => provider.models).filter((model) => model.capability === 'image').length
  }), [providers]);

  useEffect(() => {
    const selected = providers.find((provider) => provider.id === selectedId);
    if (selected) setDraft(cloneProvider(selected));
    else if (providers[0]) {
      setSelectedId(providers[0].id);
      setDraft(cloneProvider(providers[0]));
    }
  }, [providers]);

  const selectProvider = (provider: ModelProvider) => {
    setSelectedId(provider.id);
    setDraft(cloneProvider(provider));
    setMessage(null);
    setDeleteArmed(false);
  };

  const startNew = () => {
    const next = blankProvider();
    setSelectedId(next.id);
    setDraft(next);
    setMessage(null);
    setDeleteArmed(false);
  };

  const addModel = () => {
    const id = modelId.trim();
    if (!id) return setMessage({ kind: 'error', text: '请填写模型 ID' });
    if (draft.models.some((model) => model.id === id && model.capability === modelCapability)) return setMessage({ kind: 'error', text: '该类型下已存在同名模型' });
    const model: ProviderModel = modelCapability === 'chat'
      ? { id, capability: modelCapability, protocol: modelProtocol }
      : { id, capability: modelCapability };
    setDraft((value) => ({ ...value, models: [...value.models, model] }));
    setModelId('');
    setMessage(null);
  };

  const removeModel = (target: ProviderModel) => {
    setDraft((value) => ({ ...value, models: value.models.filter((model) => !(model.id === target.id && model.capability === target.capability)) }));
  };

  const save = () => {
    const error = onSave({
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/$/, ''),
      apiKey: draft.apiKey.trim(),
      models: draft.models.map((model) => ({ ...model, id: model.id.trim() }))
    });
    if (error) return setMessage({ kind: 'error', text: error });
    setSelectedId(draft.id);
    setMessage({ kind: 'success', text: '供应商连接已保存，节点选择立即生效' });
  };

  const remove = () => {
    if (!providers.some((provider) => provider.id === draft.id)) return startNew();
    if (!deleteArmed) return setDeleteArmed(true);
    onDelete(draft.id);
    setDeleteArmed(false);
    setMessage({ kind: 'success', text: '供应商连接已删除，相关节点将自动选择可用连接' });
  };

  return <div className="provider-page">
    <header className="provider-page-head">
      <div><span className="modal-icon"><ServerCog size={19} /></span><div><strong>模型服务</strong><small>管理供应商网关、API Key 与节点可选模型</small></div></div>
      <button className="publish-button" type="button" onClick={startNew}><Plus size={14} />添加供应商</button>
    </header>

    <div className="provider-overview">
      <article><span><ServerCog size={16} /></span><div><strong>{providers.length}</strong><small>供应商连接</small></div></article>
      <article><span><KeyRound size={16} /></span><div><strong>{totals.configured}</strong><small>已配置凭证</small></div></article>
      <article><span><Bot size={16} /></span><div><strong>{totals.chat}</strong><small>文本模型</small></div></article>
      <article className="warm"><span><ImageIcon size={16} /></span><div><strong>{totals.image}</strong><small>图像模型</small></div></article>
    </div>

    <div className="provider-workbench">
      <aside className="provider-list">
        <div className="provider-list-head"><strong>供应商连接</strong><small>Key 与网关成组保存</small></div>
        {providers.length ? providers.map((provider) => <button type="button" className={selectedId === provider.id ? 'active' : ''} key={provider.id} onClick={() => selectProvider(provider)}>
          <span className="provider-logo"><ServerCog size={15} /></span>
          <span><strong>{provider.name}</strong><small>{provider.baseUrl}</small></span>
          <b className={provider.apiKey ? 'ready' : ''}>{keyHint(provider.apiKey)}</b>
        </button>) : <div className="provider-empty"><ServerCog size={23} /><strong>暂无供应商</strong><span>添加连接后才能运行模型节点</span></div>}
      </aside>

      <section className="provider-editor">
        <header><div><strong>{providers.some((provider) => provider.id === draft.id) ? '编辑供应商连接' : '新建供应商连接'}</strong><small>ID: {draft.id}</small></div><span className={draft.apiKey ? 'ready' : ''}>{draft.apiKey ? '凭证已填写' : '等待填写凭证'}</span></header>
        <div className="provider-form-grid">
          <label><span>供应商名称</span><div className="service-input"><ServerCog size={15} /><input aria-label="供应商名称" value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="例如：营销团队 OpenAI 网关" /></div></label>
          <label><span>Base URL</span><div className="service-input"><Webhook size={15} /><input aria-label="供应商 Base URL" value={draft.baseUrl} onChange={(event) => setDraft((value) => ({ ...value, baseUrl: event.target.value }))} placeholder="https://provider.example.com/v1" /></div></label>
          <label className="provider-key-field"><span>API Key</span><div className="service-input"><KeyRound size={15} /><input aria-label="供应商 API Key" type={showKey ? 'text' : 'password'} autoComplete="new-password" value={draft.apiKey} onChange={(event) => setDraft((value) => ({ ...value, apiKey: event.target.value }))} placeholder="填写该网关对应的 API Key" /><button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
        </div>

        <div className="provider-model-section">
          <div className="provider-model-head"><div><strong>此 Key 支持的模型</strong><small>模型由用户维护，节点只显示这里声明的模型</small></div><b>{draft.models.length} 个</b></div>
          <div className={`provider-model-add ${modelCapability === 'chat' ? 'has-protocol' : ''}`}>
            <select aria-label="模型能力" value={modelCapability} onChange={(event) => setModelCapability(event.target.value as ModelCapability)}><option value="chat">文本模型</option><option value="image">图像模型</option></select>
            {modelCapability === 'chat' && <select aria-label="文本接口协议" value={modelProtocol} onChange={(event) => setModelProtocol(event.target.value as ChatApiProtocol)}><option value="chat-completions">Chat Completions · /chat/completions</option><option value="responses">Responses · /responses</option></select>}
            <input aria-label="新增模型 ID" value={modelId} onChange={(event) => setModelId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }} placeholder="模型 ID，例如 gpt-5.4-mini" />
            <button type="button" onClick={addModel}><Plus size={14} />添加模型</button>
          </div>
          <div className="provider-model-list">
            {draft.models.length ? draft.models.map((model) => <div key={`${model.capability}:${model.id}`} className={model.capability === 'image' ? 'warm' : ''}>
              <span>{model.capability === 'image' ? <ImageIcon size={14} /> : <Bot size={14} />}</span><div><strong>{model.id}</strong><small>{model.capability === 'image' ? '图像生成' : model.protocol === 'responses' ? '文本 / 推理 · /responses' : '文本 / 推理 · /chat/completions'}</small></div><button type="button" aria-label={`删除模型 ${model.id}`} onClick={() => removeModel(model)}><X size={14} /></button>
            </div>) : <div className="provider-model-empty">尚未添加模型；至少添加一个模型后才能保存</div>}
          </div>
        </div>

        {message && <div className={`config-message ${message.kind}`}>{message.kind === 'success' && <Check size={14} />}{message.text}</div>}
        <footer><button type="button" className={deleteArmed ? 'danger-button armed' : 'danger-button'} onClick={remove}><Trash2 size={14} />{deleteArmed ? '再次点击确认删除' : '删除连接'}</button><button type="button" className="publish-button" onClick={save}><Save size={14} />保存连接</button></footer>
      </section>
    </div>

    <div className="security-note provider-security"><KeyRound size={17} /><p><strong>连接配置保存在当前浏览器 localStorage</strong><span>每个 API Key 与其 Base URL、模型清单绑定保存；服务端不落盘。正式生产环境建议迁移到服务端加密凭证存储。</span></p></div>
  </div>;
}
