import { useEffect, useMemo, useState } from 'react';
import { Check, HardDrive, Layers3, Plus, Save, Server, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { createLocalSkill, type LocalSkillDefinition, type SkillSummary } from '../skillConfig';

type SkillManagerProps = {
  serverSkills: SkillSummary[];
  localSkills: LocalSkillDefinition[];
  catalogStatus: 'loading' | 'ready' | 'error';
  onSave: (skill: LocalSkillDefinition) => string | null;
  onDelete: (skillId: string) => void;
};

const cloneLocalSkill = (skill: LocalSkillDefinition): LocalSkillDefinition => ({ ...skill, nodeKinds: [...skill.nodeKinds] });

export function SkillManager({ serverSkills, localSkills, catalogStatus, onSave, onDelete }: SkillManagerProps) {
  const [selectedId, setSelectedId] = useState(localSkills[0]?.id || serverSkills[0]?.id || '');
  const [draft, setDraft] = useState<LocalSkillDefinition>(() => localSkills[0] ? cloneLocalSkill(localSkills[0]) : createLocalSkill());
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const selectedServerSkill = serverSkills.find((skill) => skill.id === selectedId);
  const selectedLocalSkill = localSkills.find((skill) => skill.id === selectedId);
  const editingLocal = !selectedServerSkill;
  const totals = useMemo(() => ({ server: serverSkills.length, local: localSkills.length, total: serverSkills.length + localSkills.length }), [serverSkills, localSkills]);

  useEffect(() => {
    if (selectedLocalSkill) setDraft(cloneLocalSkill(selectedLocalSkill));
    if (!selectedServerSkill && !selectedLocalSkill && localSkills[0]) {
      setSelectedId(localSkills[0].id);
      setDraft(cloneLocalSkill(localSkills[0]));
    }
  }, [localSkills, selectedId, selectedLocalSkill, selectedServerSkill]);

  const startNew = () => {
    const next = createLocalSkill();
    setSelectedId(next.id);
    setDraft(next);
    setDeleteArmed(false);
    setMessage(null);
  };

  const selectServer = (skill: SkillSummary) => {
    setSelectedId(skill.id);
    setDeleteArmed(false);
    setMessage(null);
  };

  const selectLocal = (skill: LocalSkillDefinition) => {
    setSelectedId(skill.id);
    setDraft(cloneLocalSkill(skill));
    setDeleteArmed(false);
    setMessage(null);
  };

  const save = () => {
    const normalized = { ...draft, name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions.trim() };
    const error = onSave(normalized);
    if (error) return setMessage({ kind: 'error', text: error });
    setDraft(normalized);
    setSelectedId(normalized.id);
    setMessage({ kind: 'success', text: '本地 Skill 已保存到当前浏览器' });
  };

  const remove = () => {
    if (!localSkills.some((skill) => skill.id === draft.id)) return startNew();
    if (!deleteArmed) return setDeleteArmed(true);
    onDelete(draft.id);
    setDeleteArmed(false);
    setMessage({ kind: 'success', text: '本地 Skill 已删除，并从当前工作流节点解绑' });
  };

  return <div className="skill-manager-page">
    <header className="skill-manager-head">
      <div><span className="modal-icon"><Sparkles size={19} /></span><div><strong>Skill 中心</strong><small>平台内置 Skill 与浏览器本地 Skill 分层管理</small></div></div>
      <button className="publish-button" type="button" onClick={startNew}><Plus size={14} />新建本地 Skill</button>
    </header>

    <div className="skill-manager-overview">
      <article><span><Server size={16} /></span><div><strong>{totals.server}</strong><small>服务器指定</small></div></article>
      <article><span><HardDrive size={16} /></span><div><strong>{totals.local}</strong><small>浏览器本地</small></div></article>
      <article><span><Layers3 size={16} /></span><div><strong>{totals.total}</strong><small>节点可选</small></div></article>
    </div>

    <div className="skill-manager-workbench">
      <aside className="skill-manager-list">
        <div className="skill-manager-list-head"><strong>Skill 注册表</strong><small>服务端白名单 + 本地自定义</small></div>
        <section><h3><Server size={12} />服务器指定</h3>
          {catalogStatus === 'loading' && <div className="skill-manager-empty">正在读取服务器 Skill</div>}
          {catalogStatus === 'error' && <div className="skill-manager-empty error">服务器 Skill 加载失败</div>}
          {catalogStatus === 'ready' && !serverSkills.length && <div className="skill-manager-empty">服务器未配置 Skill</div>}
          {serverSkills.map((skill) => <button type="button" key={skill.id} className={selectedId === skill.id ? 'active' : ''} onClick={() => selectServer(skill)}><span><Sparkles size={14} /></span><span><strong>{skill.name}</strong><small>{skill.mode} · v{skill.version}</small></span><b>托管</b></button>)}
        </section>
        <section><h3><HardDrive size={12} />我的本地 Skill</h3>
          {localSkills.length ? localSkills.map((skill) => <button type="button" key={skill.id} className={selectedId === skill.id ? 'active' : ''} onClick={() => selectLocal(skill)}><span><Sparkles size={14} /></span><span><strong>{skill.name}</strong><small>{skill.description}</small></span><b>本地</b></button>) : <div className="skill-manager-empty">尚未创建本地 Skill</div>}
        </section>
      </aside>

      <section className="skill-manager-editor">
        {selectedServerSkill ? <>
          <header><div><strong>{selectedServerSkill.name}</strong><small>{selectedServerSkill.id} · v{selectedServerSkill.version}</small></div><span className="managed"><ShieldCheck size={13} />服务器托管</span></header>
          <div className="managed-skill-detail">
            <span className="managed-skill-icon"><Sparkles size={22} /></span>
            <div><strong>{selectedServerSkill.description}</strong><p>该 Skill 由平台白名单提供，完整指令仅保存在服务器，不下发到浏览器。节点只能启用或停用，用户无法修改其内容。</p></div>
          </div>
          <dl className="skill-metadata"><div><dt>运行模式</dt><dd>{selectedServerSkill.mode}</dd></div><div><dt>适用节点</dt><dd>大模型</dd></div><div><dt>分类</dt><dd>{selectedServerSkill.category}</dd></div><div><dt>存储位置</dt><dd>服务器</dd></div></dl>
        </> : <>
          <header><div><strong>{selectedLocalSkill ? '编辑本地 Skill' : '新建本地 Skill'}</strong><small>ID: {draft.id}</small></div><span><HardDrive size={13} />仅当前浏览器</span></header>
          <div className="local-skill-form">
            <label><span>名称</span><input aria-label="本地 Skill 名称" value={draft.name} maxLength={80} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="例如：品牌主视觉规范" /></label>
            <label><span>简要说明</span><input aria-label="本地 Skill 说明" value={draft.description} maxLength={240} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} placeholder="说明该 Skill 解决什么问题" /></label>
            <label className="local-skill-instructions"><span>Skill 指令</span><textarea aria-label="本地 Skill 指令" value={draft.instructions} maxLength={20_000} onChange={(event) => setDraft((value) => ({ ...value, instructions: event.target.value }))} placeholder="填写要追加到大模型系统指令中的专业规则、步骤和输出格式。" /><small>{draft.instructions.length} / 20000</small></label>
          </div>
          {message && <div className={`config-message ${message.kind}`}>{message.kind === 'success' && <Check size={14} />}{message.text}</div>}
          <footer><button type="button" className={deleteArmed ? 'danger-button armed' : 'danger-button'} onClick={remove}><Trash2 size={14} />{deleteArmed ? '再次点击确认删除' : '删除本地 Skill'}</button><button type="button" className="publish-button" onClick={save}><Save size={14} />保存到本地</button></footer>
        </>}
      </section>
    </div>

    <div className="security-note skill-storage-note"><HardDrive size={17} /><p><strong>用户自建 Skill 仅保存在当前浏览器 localStorage</strong><span>运行时只发送当前节点选中的本地 Skill，服务端完成校验与临时组合后立即转发，不写入磁盘或公共注册表。清理浏览器数据前请导出工作流和 Skill 备份。</span></p></div>
  </div>;
}
