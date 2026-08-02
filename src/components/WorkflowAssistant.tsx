import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, ChevronDown, CircleStop, FileCheck2, LoaderCircle, Plus, RotateCcw, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { assistantProviderCatalog, createWorkflowAssistantSession, type AssistantStage, type WorkflowAssistantDraft, type WorkflowAssistantResponse, type WorkflowAssistantSession } from '../assistantSession';
import { providersForCapability, type ModelProvider } from '../providerConfig';

type WorkflowAssistantProps = {
  open: boolean;
  providers: ModelProvider[];
  session: WorkflowAssistantSession;
  currentWorkflow: Record<string, unknown>;
  currentWorkflowRevision: string;
  onSessionChange: (session: WorkflowAssistantSession) => void;
  onApply: (draft: WorkflowAssistantDraft) => string | null;
  onClose: () => void;
  onOpenModels: () => void;
};

const phaseLabel: Record<WorkflowAssistantSession['phase'], string> = {
  discovery: '确认需求', drafting: '生成草案', validating: '严格校验', repairing: '自动修复', awaiting_confirmation: '等待确认', applied: '已应用', blocked: '已阻断'
};

const stageLabel: Record<string, string> = {
  compression: '压缩上下文', intent: '确认目标与边界', deterministic_validation: '确定性校验', critic: '独立 Critic', repair: '受限修复'
};

export function WorkflowAssistant({ open, providers, session, currentWorkflow, currentWorkflowRevision, onSessionChange, onApply, onClose, onOpenModels }: WorkflowAssistantProps) {
  const chatProviders = useMemo(() => providersForCapability(providers, 'chat').filter((provider) => provider.apiKey), [providers]);
  const connections = useMemo(() => chatProviders.flatMap((provider) => provider.models.filter((model) => model.capability === 'chat').map((model) => ({ provider, model, key: `${provider.id}::${model.id}` }))), [chatProviders]);
  const initialConnection = connections.find((entry) => entry.provider.id === session.providerId && entry.model.id === session.modelId) || connections[0];
  const [builderKey, setBuilderKey] = useState(initialConnection?.key || '');
  const [criticKey, setCriticKey] = useState('same');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [stages, setStages] = useState<AssistantStage[]>([]);
  const [compressionNotice, setCompressionNotice] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const builder = connections.find((entry) => entry.key === builderKey) || initialConnection;
  const critic = criticKey === 'same' ? null : connections.find((entry) => entry.key === criticKey) || null;
  const draftStale = Boolean(session.candidateDraft && session.phase !== 'applied' && session.currentWorkflowRevision && session.currentWorkflowRevision !== currentWorkflowRevision);

  useEffect(() => {
    if (!builderKey && initialConnection) setBuilderKey(initialConnection.key);
  }, [builderKey, initialConnection]);

  useEffect(() => {
    if (!open || !messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [open, session.recentTurns, sending]);

  if (!open) return null;

  const send = async () => {
    const userMessage = message.trim();
    if (!userMessage || !builder || sending) return;
    setSending(true);
    setError('');
    setStages([{ stage: 'intent', status: 'running', detail: '正在调用系统级意图守卫' }]);
    setCompressionNotice('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/workflow-assistant/turn', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-AIFlow-API-Key': builder.provider.apiKey,
          ...(critic ? { 'X-AIFlow-Critic-Key': critic.provider.apiKey } : {})
        },
        body: JSON.stringify({
          message: userMessage,
          session,
          provider: { id: builder.provider.id, baseUrl: builder.provider.baseUrl, model: builder.model.id, protocol: builder.model.protocol || 'chat-completions', reasoningEffort: 'high', contextWindow: 128_000 },
          criticProvider: critic ? { id: critic.provider.id, baseUrl: critic.provider.baseUrl, model: critic.model.id, protocol: critic.model.protocol || 'chat-completions', reasoningEffort: 'high' } : null,
          providers: assistantProviderCatalog(providers),
          permissions: session.contract.constraints,
          currentWorkflow,
          currentWorkflowRevision
        })
      });
      const data = await response.json() as WorkflowAssistantResponse & { code?: string; message?: string };
      if (data.session) onSessionChange(data.session);
      if (Array.isArray(data.stages)) setStages(data.stages);
      if (data.compression?.compressed) setCompressionNotice(`已自动压缩 ${data.compression.sourceTurns || 0} 条较早消息，保留最近 ${data.compression.retainedTurns || 0} 条原文`);
      if (!response.ok) throw new Error(data.message || data.code || `AI 工作流助手返回 ${response.status}`);
      setMessage('');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setError('本次生成已停止，Session 上下文仍已保留');
      else setError(reason instanceof Error ? reason.message : 'AI 工作流助手调用失败');
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const resetSession = () => {
    if (session.recentTurns.length && !window.confirm('新建 Session 会清空当前对话、草案和校验记录，是否继续？')) return;
    onSessionChange(createWorkflowAssistantSession(builder?.provider.id, builder?.model.id));
    setStages([]);
    setCompressionNotice('');
    setError('');
  };

  const applyDraft = () => {
    if (!session.candidateDraft || !session.validation?.valid) return;
    if (draftStale) return setError('当前画布在草案生成后已经变化。为避免覆盖新修改，请让 AI 基于最新画布重新生成草案。');
    const applyError = onApply(session.candidateDraft);
    if (applyError) return setError(applyError);
    onSessionChange({ ...session, phase: 'applied', updatedAt: new Date().toISOString() });
    setError('');
  };

  const constraint = session.contract.constraints;
  const updateConstraint = (patch: Partial<typeof constraint>) => onSessionChange({ ...session, contract: { ...session.contract, constraints: { ...constraint, ...patch } }, updatedAt: new Date().toISOString() });

  return <aside className="workflow-assistant" role="dialog" aria-modal="true" aria-label="AI 工作流构建 Session">
    <header className="assistant-head">
      <div><span className="assistant-head-icon"><Bot size={18} /></span><div><strong>AI 构建 Session</strong><small><span className={`assistant-phase phase-${session.phase}`} />{phaseLabel[session.phase]} · {session.id.slice(-8)}</small></div></div>
      <div><button className="icon-button tiny" aria-label="新建 AI Session" onClick={resetSession}><Plus size={15} /></button><button className="icon-button tiny" aria-label="关闭 AI 工作流助手" onClick={onClose}><X size={16} /></button></div>
    </header>

    <section className="assistant-model-bar">
      {connections.length ? <>
        <label><span>Builder</span><div><select aria-label="AI Builder 模型" value={builder?.key || ''} onChange={(event) => setBuilderKey(event.target.value)}>{connections.map((entry) => <option key={entry.key} value={entry.key}>{entry.provider.name} · {entry.model.id}</option>)}</select><ChevronDown size={13} /></div></label>
        <label><span>Critic</span><div><select aria-label="AI Critic 模型" value={criticKey} onChange={(event) => setCriticKey(event.target.value)}><option value="same">同模型 · 隔离上下文</option>{connections.map((entry) => <option key={entry.key} value={entry.key}>{entry.provider.name} · {entry.model.id}</option>)}</select><ChevronDown size={13} /></div></label>
      </> : <button className="assistant-empty-model" onClick={onOpenModels}>请先配置可用的文本模型</button>}
    </section>

    <div className="assistant-skill-lock"><ShieldCheck size={14} /><span><strong>guard-workflow-intent</strong>系统级自动调用 · 用户不可关闭</span></div>

    <div className="assistant-scroll" ref={messagesRef}>
      {!session.recentTurns.length && <div className="assistant-welcome"><Sparkles size={22} /><strong>描述你希望创建或调整的工作流</strong><p>我会先确认目标、范围、输入输出与验收标准。信息不足时不会直接修改画布。</p><div><button onClick={() => setMessage('根据当前工作流，为三个渠道分别生成商品图片和对应文案。')}>创建多渠道内容流</button><button onClick={() => setMessage('检查当前工作流并减少不必要的模型调用，同时保留全部输出。')}>优化当前工作流</button></div></div>}
      {session.recentTurns.map((turn) => <article className={`assistant-message ${turn.role}`} key={turn.id}><span>{turn.role === 'user' ? '你' : <Bot size={13} />}</span><div><p>{turn.content}</p><time>{new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></article>)}
      {sending && <article className="assistant-message assistant loading"><span><LoaderCircle className="spin" size={13} /></span><div><p>正在执行系统 Skill 与校验链…</p></div></article>}

      {(session.contract.objective || session.contract.unresolvedQuestions.length > 0) && <section className="assistant-contract">
        <header><strong>任务契约</strong><span>{session.contract.unresolvedQuestions.length ? `${session.contract.unresolvedQuestions.length} 项待确认` : '边界已明确'}</span></header>
        {session.contract.objective && <p>{session.contract.objective}</p>}
        <dl><div><dt>输入</dt><dd>{session.contract.inputs.length}</dd></div><div><dt>输出</dt><dd>{session.contract.outputs.length}</dd></div><div><dt>验收标准</dt><dd>{session.contract.acceptanceCriteria.length}</dd></div></dl>
        <div className="assistant-permissions">
          <label><input type="checkbox" checked={constraint.allowHttp} onChange={(event) => updateConstraint({ allowHttp: event.target.checked })} />允许 HTTP</label>
          <label><input type="checkbox" checked={constraint.allowCode} onChange={(event) => updateConstraint({ allowCode: event.target.checked })} />允许代码</label>
          <label>文本调用<input aria-label="最大文本模型调用" type="number" min="0" max="40" value={constraint.maxModelCalls} onChange={(event) => updateConstraint({ maxModelCalls: Math.max(0, Math.min(40, Number(event.target.value) || 0)) })} /></label>
          <label>图片数<input aria-label="最大图片生成数" type="number" min="0" max="20" value={constraint.maxImageCalls} onChange={(event) => updateConstraint({ maxImageCalls: Math.max(0, Math.min(20, Number(event.target.value) || 0)) })} /></label>
        </div>
      </section>}

      {compressionNotice && <div className="assistant-compression"><RotateCcw size={13} />{compressionNotice}</div>}
      {stages.length > 0 && <section className="assistant-stages"><header><strong>校验链</strong><small>服务端不可绕过</small></header>{stages.map((stage, index) => <div key={`${stage.stage}-${index}`} className={stage.status}><span>{stage.status === 'running' ? <LoaderCircle className="spin" size={12} /> : stage.status === 'success' ? <Check size={12} /> : <X size={12} />}</span><div><strong>{stageLabel[stage.stage] || stage.stage}</strong><small>{stage.detail}</small></div></div>)}</section>}

      {session.validation && <section className={`assistant-validation ${session.validation.valid ? 'valid' : 'invalid'}`}>
        <header>{session.validation.valid ? <Check size={14} /> : <AlertTriangle size={14} />}<strong>{session.validation.valid ? '草案已通过严格校验' : '草案已阻断'}</strong><span>{session.validation.repairAttempt} 次修复</span></header>
        {session.validation.issues.slice(0, 6).map((issue, index) => <div className={`assistant-issue ${issue.severity}`} key={`${issue.code}-${index}`}><code>{issue.code}</code><p>{issue.message}</p>{issue.evidence && <small>{issue.evidence}</small>}</div>)}
      </section>}

      {session.candidateDraft && <section className="assistant-draft">
        <span><FileCheck2 size={17} /></span><div><strong>{session.candidateDraft.title}</strong><small>{session.candidateDraft.nodes.length} 个节点 · {session.candidateDraft.edges.length} 条连接</small></div>
        <button disabled={!session.validation?.valid || session.phase === 'applied' || draftStale} onClick={applyDraft}>{session.phase === 'applied' ? '已应用' : '确认应用'}</button>
      </section>}
      {draftStale && <div className="assistant-error"><AlertTriangle size={14} />画布已更新，此草案不能覆盖最新修改。请继续对话以重新生成。</div>}
      {error && <div className="assistant-error"><AlertTriangle size={14} />{error}</div>}
    </div>

    <footer className="assistant-composer">
      <textarea aria-label="AI 工作流需求" value={message} disabled={!builder || sending} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="描述目标、调整内容或回答澄清问题…" />
      <div><small>Enter 发送 · Shift+Enter 换行</small>{sending ? <button className="assistant-stop" onClick={() => abortRef.current?.abort()}><CircleStop size={14} />停止</button> : <button className="assistant-send" disabled={!message.trim() || !builder} onClick={() => void send()}><Send size={14} />发送</button>}</div>
    </footer>
  </aside>;
}
