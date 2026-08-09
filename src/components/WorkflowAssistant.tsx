import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, Bug, Check, ChevronDown, CircleStop, GitBranch, ListTree, LoaderCircle, Plus, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { assistantProviderCatalog, createWorkflowAssistantSession, type AssistantStage, type WorkflowAssistantDraft, type WorkflowAssistantResponse, type WorkflowAssistantSession, type WorkflowPlan } from '../assistantSession';
import { assistantSessionLogFilename, buildAssistantSessionLog } from '../assistantSessionLog';
import { AssistantTransportError, readAssistantTurnResponse } from '../assistantTransport';
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
  compression: '压缩上下文', intent: '解析输入与输出', format_repair: '修复模型输出格式', model_binding: '绑定可用模型', deterministic_validation: '校验流程结构', critic: '审查任务覆盖', repair: '自动修复方案', result: '准备本轮结果'
};
type ConfirmationPayload = { answer: 'yes' | 'no' | 'other'; question: string; detail?: string };
type RetryAttempt = { message: string; confirmation?: ConfirmationPayload };
const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const planKindLabel: Record<WorkflowPlan['steps'][number]['kind'], string> = {
  start: '开始', llm: '大模型', image: '图像生成', condition: '条件', http: 'HTTP', code: '代码', aggregate: '聚合', output: '输出'
};

function planPreviewLayout(plan: WorkflowPlan) {
  const nodeWidth = 126;
  const nodeHeight = 48;
  const horizontalGap = 54;
  const verticalGap = 24;
  const padding = 24;
  const stepIds = new Set(plan.steps.map((step) => step.id));
  const outgoing = new Map(plan.steps.map((step) => [step.id, [] as string[]]));
  const indegree = new Map(plan.steps.map((step) => [step.id, 0]));
  for (const connection of plan.connections) {
    if (!stepIds.has(connection.source) || !stepIds.has(connection.target)) continue;
    outgoing.get(connection.source)?.push(connection.target);
    indegree.set(connection.target, (indegree.get(connection.target) || 0) + 1);
  }
  const depths = new Map(plan.steps.map((step) => [step.id, 0]));
  const queue = [...indegree].filter(([, count]) => count === 0).map(([stepId]) => stepId);
  while (queue.length) {
    const source = queue.shift()!;
    for (const target of outgoing.get(source) || []) {
      depths.set(target, Math.max(depths.get(target) || 0, (depths.get(source) || 0) + 1));
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  const layers = new Map<number, string[]>();
  for (const step of plan.steps) {
    const layer = depths.get(step.id) || 0;
    layers.set(layer, [...(layers.get(layer) || []), step.id]);
  }
  const layerCount = Math.max(0, ...layers.keys()) + 1;
  const maxRows = Math.max(1, ...[...layers.values()].map((items) => items.length));
  const width = padding * 2 + layerCount * nodeWidth + Math.max(0, layerCount - 1) * horizontalGap;
  const height = padding * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * verticalGap;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [layer, stepIdsInLayer] of layers) {
    const layerHeight = stepIdsInLayer.length * nodeHeight + Math.max(0, stepIdsInLayer.length - 1) * verticalGap;
    const startY = (height - layerHeight) / 2;
    stepIdsInLayer.forEach((stepId, index) => positions.set(stepId, { x: padding + layer * (nodeWidth + horizontalGap), y: startY + index * (nodeHeight + verticalGap) }));
  }
  return { nodeWidth, nodeHeight, width, height, positions };
}

function WorkflowPlanPreview({ draft, applied, disabled, onApply, onRevise }: { draft: WorkflowAssistantDraft; applied: boolean; disabled: boolean; onApply: () => void; onRevise: () => void }) {
  const plan = draft.plan;
  const layout = useMemo(() => planPreviewLayout(plan), [plan]);
  const stepById = useMemo(() => new Map(plan.steps.map((step) => [step.id, step])), [plan]);
  return <section className="assistant-plan" aria-label="AI 流程方案预览">
    <header className="assistant-plan-head">
      <div><span><GitBranch size={15} /></span><div><strong>{draft.title}</strong><small>流程图是节点与连线的唯一来源</small></div></div>
      <span>{plan.steps.length} 节点 · {plan.connections.length} 连线</span>
    </header>
    <p className="assistant-plan-summary">{plan.summary}</p>
    <div className="assistant-flowchart-scroll" aria-label="工作流流程图">
      <div className="assistant-flowchart" style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">
          {plan.connections.map((connection) => {
            const source = layout.positions.get(connection.source);
            const target = layout.positions.get(connection.target);
            if (!source || !target) return null;
            const startX = source.x + layout.nodeWidth;
            const startY = source.y + layout.nodeHeight / 2;
            const endX = target.x;
            const endY = target.y + layout.nodeHeight / 2;
            const middleX = startX + Math.max(18, (endX - startX) / 2);
            return <g key={connection.id}><path d={`M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`} /><circle cx={endX - 3} cy={endY} r="2.5" />{connection.sourceHandle && <text x={startX + 7} y={startY - 5}>{connection.sourceHandle === 'true' ? '是' : '否'}</text>}</g>;
          })}
        </svg>
        {plan.steps.map((step, index) => {
          const position = layout.positions.get(step.id) || { x: 0, y: 0 };
          return <div className={`assistant-flow-step kind-${step.kind}`} style={{ left: position.x, top: position.y, width: layout.nodeWidth, height: layout.nodeHeight }} key={step.id} title={step.purpose}>
            <span>{String(index + 1).padStart(2, '0')}</span><div><small>{planKindLabel[step.kind]}</small><strong>{step.title}</strong></div>
          </div>;
        })}
      </div>
    </div>
    <details className="assistant-plan-explanation">
      <summary><span><ListTree size={13} />流程说明</span><small>全部内容均从同一流程定义生成</small></summary>
      <div className="assistant-plan-steps">
        {plan.steps.map((step, index) => <article key={step.id}>
          <span>{index + 1}</span><div><header><strong>{step.title}</strong><code>{step.id}</code></header><p>{step.purpose}</p><small>输入：{step.inputs.length ? step.inputs.join('、') : '无'} · 输出：{step.outputs.length ? step.outputs.join('、') : '无'}</small></div>
        </article>)}
      </div>
      <div className="assistant-plan-connections">
        <strong>数据流向</strong>
        {plan.connections.map((connection) => <div key={connection.id}><span>{stepById.get(connection.source)?.title || connection.source}</span><ArrowRight size={11} /><span>{stepById.get(connection.target)?.title || connection.target}</span><small>{connection.reason} · {connection.dataType}</small></div>)}
      </div>
    </details>
    <footer className="assistant-plan-actions"><button onClick={onRevise} disabled={applied}>需要调整</button><button className="primary" disabled={disabled || applied} onClick={onApply}>{applied ? '已应用' : disabled ? '等待本轮校验' : '确认并应用'}</button></footer>
  </section>;
}

export function WorkflowAssistant({ open, providers, session, currentWorkflow, currentWorkflowRevision, onSessionChange, onApply, onClose, onOpenModels }: WorkflowAssistantProps) {
  const chatProviders = useMemo(() => providersForCapability(providers, 'chat').filter((provider) => provider.apiKey), [providers]);
  const connections = useMemo(() => chatProviders.flatMap((provider) => provider.models.filter((model) => model.capability === 'chat').map((model) => ({ provider, model, key: `${provider.id}::${model.id}` }))), [chatProviders]);
  const initialConnection = connections.find((entry) => entry.provider.id === session.providerId && entry.model.id === session.modelId) || connections[0];
  const [builderKey, setBuilderKey] = useState(initialConnection?.key || '');
  const [criticKey, setCriticKey] = useState('same');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [errorRequestId, setErrorRequestId] = useState('');
  const [retryAttempt, setRetryAttempt] = useState<RetryAttempt | null>(null);
  const [stages, setStages] = useState<AssistantStage[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [compressionNotice, setCompressionNotice] = useState('');
  const [logExported, setLogExported] = useState(false);
  const [customAnswerOpen, setCustomAnswerOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const builderSelectRef = useRef<HTMLSelectElement | null>(null);
  const builder = connections.find((entry) => entry.key === builderKey) || initialConnection;
  const critic = criticKey === 'same' ? null : connections.find((entry) => entry.key === criticKey) || null;
  const draftStale = Boolean(session.candidateDraft && session.phase !== 'applied' && session.currentWorkflowRevision && session.currentWorkflowRevision !== currentWorkflowRevision);
  const pendingQuestion = session.phase === 'discovery' ? session.contract.unresolvedQuestions[0] || '' : '';
  const activeStage = [...stages].reverse().find((stage) => stage.status === 'running');
  const completedStageCount = stages.filter((stage) => stage.status === 'success').length;
  const visibleTurns = session.recentTurns.slice(-6);
  const earlierTurns = session.recentTurns.slice(0, -6);

  useEffect(() => {
    if (!builderKey && initialConnection) setBuilderKey(initialConnection.key);
  }, [builderKey, initialConnection]);

  useEffect(() => {
    if (!open || !messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [open, session.recentTurns, sending, stages]);

  useEffect(() => {
    if (!sending) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [sending]);

  if (!open) return null;

  const send = async (overrideMessage?: string, confirmation?: ConfirmationPayload, retry = false) => {
    const userMessage = (overrideMessage ?? message).trim();
    if (!userMessage || !builder || sending) return;
    setRetryAttempt({ message: userMessage, confirmation });
    setSending(true);
    setError('');
    setErrorCode('');
    setErrorRequestId('');
    setStages([{ stage: 'intent', status: 'running', detail: '正在连接 Builder 并调用系统级意图守卫' }]);
    setCompressionNotice('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/workflow-assistant/turn', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
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
          currentWorkflowRevision,
          confirmation,
          retry
        })
      });
      const parsed = await readAssistantTurnResponse<WorkflowAssistantResponse & { code?: string; message?: string; requestId?: string }>(response, ({ index, stage }) => {
        setStages((items) => {
          const next = [...items];
          next[index] = stage;
          return next.filter(Boolean);
        });
      });
      const data = parsed.data;
      if (data.session) onSessionChange(data.session);
      if (data.compression?.compressed) setCompressionNotice(`已自动压缩 ${data.compression.sourceTurns || 0} 条较早消息，保留最近 ${data.compression.retainedTurns || 0} 条原文`);
      const completedStages = Array.isArray(data.stages) ? data.stages : [];
      if (parsed.status < 200 || parsed.status >= 300) {
        setStages([...completedStages, { stage: 'result', status: 'error', detail: '本轮构建未产生可应用结果，当前画布保持不变' }]);
        setErrorCode(data.code || `HTTP_${parsed.status}`);
        setErrorRequestId(data.requestId || '');
        throw new Error(data.message || data.code || `AI 工作流助手返回 ${parsed.status}`);
      }
      const resultDetail = data.session?.phase === 'discovery'
        ? '输入与输出已识别，等待你的确认'
        : data.session?.phase === 'awaiting_confirmation'
          ? '方案已通过全部校验，可以预览并应用'
          : data.session?.phase === 'blocked'
            ? '严格校验未通过，当前画布保持不变'
            : '本轮处理已完成';
      setStages([...completedStages, { stage: 'result', status: data.session?.phase === 'blocked' ? 'error' : 'success', detail: resultDetail }]);
      setMessage('');
      setCustomAnswer('');
      setCustomAnswerOpen(false);
      setRetryAttempt(null);
    } catch (reason) {
      if (reason instanceof AssistantTransportError) {
        setErrorCode(reason.code);
        setErrorRequestId(reason.requestId);
      }
      const failureMessage = reason instanceof DOMException && reason.name === 'AbortError'
        ? '本次生成已停止，Session 上下文仍已保留'
        : reason instanceof Error ? reason.message : 'AI 工作流助手调用失败';
      if (reason instanceof DOMException && reason.name === 'AbortError') setErrorCode('ASSISTANT_REQUEST_ABORTED');
      else setErrorCode((current) => current || 'ASSISTANT_REQUEST_FAILED');
      setError(failureMessage);
      setStages((items) => items.map((stage) => stage.status === 'running' ? { ...stage, status: 'error', detail: failureMessage } : stage));
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
    setCustomAnswer('');
    setCustomAnswerOpen(false);
    setError('');
    setErrorCode('');
    setErrorRequestId('');
    setRetryAttempt(null);
  };

  const applyDraft = () => {
    if (sending || session.phase !== 'awaiting_confirmation' || !session.candidateDraft || !session.validation?.valid) return;
    if (draftStale) return setError('当前画布在草案生成后已经变化。为避免覆盖新修改，请让 AI 基于最新画布重新生成草案。');
    const applyError = onApply(session.candidateDraft);
    if (applyError) return setError(applyError);
    onSessionChange({ ...session, phase: 'applied', updatedAt: new Date().toISOString() });
    setError('');
  };

  const constraint = session.contract.constraints;
  const updateConstraint = (patch: Partial<typeof constraint>) => onSessionChange({ ...session, contract: { ...session.contract, constraints: { ...constraint, ...patch } }, updatedAt: new Date().toISOString() });

  const exportSessionLog = () => {
    const log = buildAssistantSessionLog({
      session,
      stages,
      currentWorkflow,
      currentWorkflowRevision,
      runtime: {
        sending,
        elapsedSeconds,
        error,
        errorCode,
        errorRequestId,
        composerDraft: message,
        pendingAttempt: retryAttempt,
        builder: builder ? { providerId: builder.provider.id, providerName: builder.provider.name, modelId: builder.model.id } : null,
        critic: critic ? { providerId: critic.provider.id, providerName: critic.provider.name, modelId: critic.model.id } : null
      }
    });
    const url = URL.createObjectURL(new Blob([log], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = assistantSessionLogFilename(session.id);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setLogExported(true);
    window.setTimeout(() => setLogExported(false), 2_000);
  };

  return <aside className="workflow-assistant" role="dialog" aria-modal="true" aria-label="AI 工作流构建 Session">
    <header className="assistant-head">
      <div><span className="assistant-head-icon"><Bot size={18} /></span><div><strong>AI 构建 Session</strong><small><span className={`assistant-phase phase-${session.phase}`} />{phaseLabel[session.phase]} · {session.id.slice(-8)}</small></div></div>
      <div><button className="assistant-report-button" aria-label="报错并导出 Session 日志" title="导出脱敏的完整 Session 日志" onClick={exportSessionLog}><Bug size={13} />{logExported ? '已导出' : '报错'}</button><button className="icon-button tiny" aria-label="新建 AI Session" onClick={resetSession}><Plus size={15} /></button><button className="icon-button tiny" aria-label="关闭 AI 工作流助手" onClick={onClose}><X size={16} /></button></div>
    </header>

    <details className="assistant-settings">
      <summary><span><Settings2 size={13} />构建配置</span><small>{builder ? `${builder.provider.name} · ${builder.model.id}` : '未配置模型'}</small><ChevronDown size={13} /></summary>
      <section className="assistant-model-bar">
        {connections.length ? <>
          <label><span>Builder</span><div><select ref={builderSelectRef} aria-label="AI Builder 模型" value={builder?.key || ''} onChange={(event) => setBuilderKey(event.target.value)}>{connections.map((entry) => <option key={entry.key} value={entry.key}>{entry.provider.name} · {entry.model.id}</option>)}</select><ChevronDown size={13} /></div></label>
          <label><span>Critic</span><div><select aria-label="AI Critic 模型" value={criticKey} onChange={(event) => setCriticKey(event.target.value)}><option value="same">同模型 · 隔离上下文</option>{connections.map((entry) => <option key={entry.key} value={entry.key}>{entry.provider.name} · {entry.model.id}</option>)}</select><ChevronDown size={13} /></div></label>
        </> : <button className="assistant-empty-model" onClick={onOpenModels}>请先配置可用的文本模型</button>}
      </section>
      <div className="assistant-skill-lock"><ShieldCheck size={14} /><span><strong>guard-workflow-intent</strong>系统级自动调用 · 用户不可关闭</span></div>
    </details>

    <div className="assistant-scroll" ref={messagesRef}>
      {!session.recentTurns.length && <div className="assistant-welcome"><Sparkles size={22} /><strong>描述你希望创建或调整的工作流</strong><p>我会识别任务并只请你确认输入与输出，其他实现边界按安全默认值自动处理。</p><div><button onClick={() => setMessage('根据当前工作流，为三个渠道分别生成商品图片和对应文案。')}>创建多渠道内容流</button><button onClick={() => setMessage('检查当前工作流并减少不必要的模型调用，同时保留全部输出。')}>优化当前工作流</button></div></div>}
      {earlierTurns.length > 0 && <details className="assistant-history"><summary>查看较早的 {earlierTurns.length} 条消息</summary><div>{earlierTurns.map((turn) => <article className={`assistant-message ${turn.role}`} key={turn.id}><span>{turn.role === 'user' ? '你' : <Bot size={13} />}</span><div><p>{turn.content}</p><time>{new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></article>)}</div></details>}
      {visibleTurns.map((turn) => <article className={`assistant-message ${turn.role}`} key={turn.id}><span>{turn.role === 'user' ? '你' : <Bot size={13} />}</span><div><p>{turn.content}</p><time>{new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></article>)}

      {stages.length > 0 && <section className={`assistant-activity ${sending ? 'running' : stages.some((stage) => stage.status === 'error') ? 'error' : 'complete'}`} aria-live="polite">
        <div className="assistant-activity-main"><span>{sending ? <LoaderCircle className="spin" size={14} /> : stages.some((stage) => stage.status === 'error') ? <X size={14} /> : <Check size={14} />}</span><div><strong>{sending ? stageLabel[activeStage?.stage || ''] || activeStage?.stage || '正在建立 AI 构建连接' : stages.some((stage) => stage.status === 'error') ? '本轮构建需要处理' : '本轮构建已完成'}</strong><small>{sending ? activeStage?.detail || '正在等待第一个阶段结果…' : `${completedStageCount}/${stages.length} 个阶段完成`}</small></div><time>{formatElapsed(elapsedSeconds)}</time></div>
        <details className="assistant-activity-details"><summary>运行详情 <span>{completedStageCount}/{stages.length}</span></summary><div>{stages.map((stage, index) => <div key={`${stage.stage}-${index}`} className={stage.status}><span>{stage.status === 'running' ? <LoaderCircle className="spin" size={11} /> : stage.status === 'success' ? <Check size={11} /> : <X size={11} />}</span><div><strong>{stageLabel[stage.stage] || stage.stage}</strong><small>{stage.detail}</small></div></div>)}</div></details>
      </section>}

      {(session.contract.objective || session.contract.unresolvedQuestions.length > 0) && <details className="assistant-contract">
        <summary><span><strong>任务摘要</strong><small>{session.contract.objective || '等待识别任务目标'}</small></span><span>{session.contract.inputs.length} 输入 → {session.contract.outputs.length} 输出</span></summary>
        <div className="assistant-contract-body"><header><strong>任务边界</strong><span>{session.contract.unresolvedQuestions.length ? '待确认输入输出' : '输入输出已确认'}</span></header>
          <dl><div><dt>输入</dt><dd>{session.contract.inputs.length}</dd></div><div><dt>输出</dt><dd>{session.contract.outputs.length}</dd></div><div><dt>验收标准</dt><dd>{session.contract.acceptanceCriteria.length}</dd></div></dl>
          <div className="assistant-permissions">
            <label><input type="checkbox" checked={constraint.allowHttp} onChange={(event) => updateConstraint({ allowHttp: event.target.checked })} />允许 HTTP</label>
            <label><input type="checkbox" checked={constraint.allowCode} onChange={(event) => updateConstraint({ allowCode: event.target.checked })} />允许代码</label>
            <label>文本调用<input aria-label="最大文本模型调用" type="number" min="0" max="40" value={constraint.maxModelCalls} onChange={(event) => updateConstraint({ maxModelCalls: Math.max(0, Math.min(40, Number(event.target.value) || 0)) })} /></label>
            <label>图片数<input aria-label="最大图片生成数" type="number" min="0" max="20" value={constraint.maxImageCalls} onChange={(event) => updateConstraint({ maxImageCalls: Math.max(0, Math.min(20, Number(event.target.value) || 0)) })} /></label>
          </div>
        </div>
      </details>}

      {pendingQuestion && <section className="assistant-confirmation">
        <header><strong>确认输入与输出</strong><small>请选择一个回答</small></header>
        <p>{pendingQuestion}</p>
        <div className="assistant-confirmation-actions">
          <button disabled={sending} onClick={() => void send(`对“${pendingQuestion}”的回答：是`, { answer: 'yes', question: pendingQuestion })}>是</button>
          <button disabled={sending} onClick={() => void send(`对“${pendingQuestion}”的回答：否`, { answer: 'no', question: pendingQuestion })}>否</button>
          <button className={customAnswerOpen ? 'active' : ''} disabled={sending} onClick={() => setCustomAnswerOpen((value) => !value)}>其他</button>
        </div>
        {customAnswerOpen && <div className="assistant-custom-answer"><textarea autoFocus aria-label="其他确认内容" value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="输入需要修改或补充的内容…" /><button disabled={sending || !customAnswer.trim()} onClick={() => void send(`对“${pendingQuestion}”的补充：${customAnswer.trim()}`, { answer: 'other', question: pendingQuestion, detail: customAnswer.trim() })}>提交补充</button></div>}
      </section>}

      {compressionNotice && <div className="assistant-compression"><RotateCcw size={13} />{compressionNotice}</div>}

      {!sending && session.validation && (!session.validation.valid || session.phase === 'awaiting_confirmation' || session.phase === 'applied') && <details className={`assistant-validation ${session.validation.valid ? 'valid' : 'invalid'}`}>
        <summary>{session.validation.valid ? <Check size={14} /> : <AlertTriangle size={14} />}<strong>{session.validation.valid ? '草案已通过严格校验' : '草案已阻断'}</strong><span>{session.validation.issues.length} 项 · {session.validation.repairAttempt} 次修复</span></summary>
        <div>{session.validation.issues.slice(0, 6).map((issue, index) => <div className={`assistant-issue ${issue.severity}`} key={`${issue.code}-${index}`}><code>{issue.code}</code><p>{issue.message}</p>{issue.evidence && <small>{issue.evidence}</small>}</div>)}</div>
      </details>}

      {!sending && session.candidateDraft?.plan && <WorkflowPlanPreview draft={session.candidateDraft} applied={session.phase === 'applied'} disabled={session.phase !== 'awaiting_confirmation' || !session.validation?.valid || draftStale} onApply={applyDraft} onRevise={() => { setMessage('请调整当前流程方案：'); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.assistant-composer textarea')?.focus()); }} />}
      {draftStale && <div className="assistant-error"><AlertTriangle size={14} />画布已更新，此草案不能覆盖最新修改。请继续对话以重新生成。</div>}
      {error && <div className="assistant-error" role="alert"><div className="assistant-error-copy"><AlertTriangle size={14} /><span>{errorCode && <code>{errorCode}</code>}{error}{errorRequestId && <small>请求 ID：{errorRequestId}</small>}</span></div><div className="assistant-error-actions"><button onClick={exportSessionLog}><Bug size={12} />{logExported ? '日志已导出' : '导出日志'}</button>{retryAttempt && <button onClick={() => void send(retryAttempt.message, retryAttempt.confirmation, true)}>重新尝试</button>}<button onClick={() => { document.querySelector<HTMLDetailsElement>('.assistant-settings')?.setAttribute('open', ''); requestAnimationFrame(() => builderSelectRef.current?.focus()); }}>切换模型</button></div></div>}
    </div>

    <footer className="assistant-composer">
      <textarea aria-label="AI 工作流需求" value={message} disabled={!builder || sending} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="描述目标、调整内容或回答澄清问题…" />
      <div><small>Enter 发送 · Shift+Enter 换行</small>{sending ? <button className="assistant-stop" onClick={() => abortRef.current?.abort()}><CircleStop size={14} />停止</button> : <button className="assistant-send" disabled={!message.trim() || !builder} onClick={() => void send()}><Send size={14} />发送</button>}</div>
    </footer>
  </aside>;
}
