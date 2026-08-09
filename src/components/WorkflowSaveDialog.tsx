import { useState, type FormEvent } from 'react';
import { Boxes, CheckCircle2, X } from 'lucide-react';

type WorkflowSaveDialogProps = {
  title: string;
  description: string;
  isUpdate: boolean;
  onClose: () => void;
  onSave: (title: string, description: string) => boolean;
};

export function WorkflowSaveDialog({
  title,
  description,
  isUpdate,
  onClose,
  onSave
}: WorkflowSaveDialogProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState(description);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draftTitle.trim() || !draftDescription.trim()) return;
    if (onSave(draftTitle, draftDescription)) onClose();
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <form className="workflow-save-dialog" role="dialog" aria-modal="true" aria-label={isUpdate ? '保存工作流更改' : '保存新工作流'} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
      <header>
        <div><span><Boxes size={18} /></span><div><strong>{isUpdate ? '保存工作流更改' : '保存到工作流库'}</strong><small>保存后才能从工作流库稳定复用这条流程</small></div></div>
        <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="workflow-save-fields">
        <label><span>工作流名称</span><input value={draftTitle} maxLength={60} onChange={(event) => setDraftTitle(event.target.value)} autoFocus /></label>
        <label><span>使用说明</span><textarea value={draftDescription} maxLength={180} rows={4} onChange={(event) => setDraftDescription(event.target.value)} placeholder="说明这个工作流解决什么问题、适合什么场景" /></label>
        <small>{draftDescription.length}/180</small>
      </div>
      <footer>
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button type="submit" className="publish-button" disabled={!draftTitle.trim() || !draftDescription.trim()}><CheckCircle2 size={14} />{isUpdate ? '保存更改' : '保存工作流'}</button>
      </footer>
    </form>
  </div>;
}
