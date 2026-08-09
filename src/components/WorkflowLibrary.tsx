import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  GitBranch,
  Layers3,
  PencilLine,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react';
import type { WorkflowLibraryItem } from '../workflow/library';

type WorkflowLibraryProps<TNode, TEdge> = {
  workflows: WorkflowLibraryItem<TNode, TEdge>[];
  onCreate: () => void;
  onUse: (workflow: WorkflowLibraryItem<TNode, TEdge>) => void;
  onEdit: (workflow: WorkflowLibraryItem<TNode, TEdge>) => void;
  onDelete: (workflow: WorkflowLibraryItem<TNode, TEdge>) => void;
};

const kindLabels: Record<string, string> = {
  start: '输入',
  llm: '大模型',
  image: '图像',
  condition: '判断',
  http: 'HTTP',
  code: '代码',
  aggregate: '聚合',
  output: '输出'
};

function workflowKinds(workflow: WorkflowLibraryItem<unknown, unknown>) {
  const labels = workflow.nodes.flatMap((node) => {
    if (!node || typeof node !== 'object') return [];
    const data = (node as { data?: { kind?: unknown } }).data;
    return typeof data?.kind === 'string' ? [kindLabels[data.kind] || data.kind] : [];
  });
  return [...new Set(labels)].slice(0, 5);
}

function relativeDate(value: string) {
  const time = new Date(value).getTime();
  const delta = Math.max(0, Date.now() - time);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '刚刚更新';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function WorkflowLibrary<TNode, TEdge>({
  workflows,
  onCreate,
  onUse,
  onEdit,
  onDelete
}: WorkflowLibraryProps<TNode, TEdge>) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return workflows;
    return workflows.filter((workflow) => `${workflow.title}\n${workflow.description}`.toLocaleLowerCase().includes(needle));
  }, [query, workflows]);
  const totalRuns = workflows.reduce((total, workflow) => total + workflow.runCount, 0);
  const totalNodes = workflows.reduce((total, workflow) => total + workflow.nodes.length, 0);

  return (
    <section className="workflow-library-page">
      <div className="workflow-library-ambient" aria-hidden="true" />
      <header className="workflow-library-hero">
        <div>
          <span className="library-eyebrow"><span /> WORKFLOW CONTROL CENTER</span>
          <h1>工作流库</h1>
          <p>这是所有工作流的独立入口。新建或编辑后才会进入编排工作区，运行记录、版本与配置工具也会随当前工作流一同出现。</p>
        </div>
        <button className="library-save-button" onClick={onCreate}><Plus size={16} />新建工作流</button>
      </header>

      <div className="workflow-library-toolbar">
        <label className="workflow-library-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或说明" /></label>
        <div className="workflow-library-stats" aria-label="工作流库统计">
          <span><Boxes size={13} /><b>{workflows.length}</b> 个工作流</span>
          <span><GitBranch size={13} /><b>{totalNodes}</b> 个节点</span>
          <span><Play size={13} /><b>{totalRuns}</b> 次使用</span>
        </div>
      </div>

      {filtered.length ? <div className="workflow-card-grid">
        {filtered.map((workflow, index) => {
          const kinds = workflowKinds(workflow);
          return <article className={`workflow-library-card tone-${index % 4}`} key={workflow.id}>
            <div className="workflow-card-preview" aria-hidden="true">
              <span className="workflow-card-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="workflow-path">
                {kinds.map((kind, kindIndex) => <span key={kind}><i />{kind}{kindIndex < kinds.length - 1 && <ArrowRight size={11} />}</span>)}
              </div>
              <span className="workflow-card-status"><CheckCircle2 size={12} />已调试</span>
            </div>
            <div className="workflow-card-body">
              <header><div><h2>{workflow.title}</h2><span><Clock3 size={11} />{relativeDate(workflow.updatedAt)}</span></div><button className="workflow-delete" aria-label={`删除 ${workflow.title}`} title="删除工作流" onClick={() => onDelete(workflow)}><Trash2 size={14} /></button></header>
              <p>{workflow.description}</p>
              <div className="workflow-card-meta"><span><Layers3 size={12} />{workflow.nodes.length} 节点</span><span>{workflow.edges.length} 条连接</span><span>{workflow.runCount} 次使用</span></div>
            </div>
            <footer>
              <button className="workflow-edit-button" onClick={() => onEdit(workflow)}><PencilLine size={14} />编辑工作流</button>
              <button className="workflow-use-button" onClick={() => onUse(workflow)}><Play size={14} fill="currentColor" />使用工作流</button>
            </footer>
          </article>;
        })}
      </div> : <div className="workflow-library-empty">
        <span><Sparkles size={24} /></span>
        <strong>{query ? '没有匹配的工作流' : '还没有保存工作流'}</strong>
        <p>{query ? '换一个关键词，或清除搜索条件。' : '创建第一条工作流，完成编排后再保存到这里。'}</p>
        {query
          ? <button onClick={() => setQuery('')}>清除搜索</button>
          : <button onClick={onCreate}><Plus size={14} />新建工作流</button>}
      </div>}
    </section>
  );
}
