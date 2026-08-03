import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  FileText,
  Image as ImageIcon,
  Layers3,
  X,
  ZoomIn
} from 'lucide-react';
import type { OutputAsset, OutputItem, WorkflowOutputBundle } from '../workflow/core';

type OutputFilter = 'all' | OutputItem['type'];

type OutputPanelProps = {
  bundle: WorkflowOutputBundle;
  onError?: (message: string) => void;
};

async function writeClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('execCommand copy failed');
  } finally {
    textarea.remove();
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadAsset(asset: OutputAsset, fallbackName: string) {
  try {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error('download failed');
    downloadBlob(await response.blob(), asset.name || fallbackName);
  } catch {
    const anchor = document.createElement('a');
    anchor.href = asset.url;
    anchor.download = asset.name || fallbackName;
    anchor.target = '_blank';
    anchor.click();
  }
}

function printableValue(item: OutputItem) {
  if (item.type === 'text') return item.text;
  if (item.type === 'json') return JSON.stringify(item.value, null, 2);
  return '';
}

export function OutputPanel({ bundle, onError }: OutputPanelProps) {
  const [filter, setFilter] = useState<OutputFilter>('all');
  const [copiedId, setCopiedId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const items = useMemo(() => bundle.groups.flatMap((group) => group.items), [bundle]);
  const images = useMemo(() => items.filter((item): item is Extract<OutputItem, { type: 'image' }> => item.type === 'image'), [items]);
  const previewIndex = images.findIndex((item) => item.id === previewId);
  const previewItem = previewIndex >= 0 ? images[previewIndex] : undefined;
  const counts = useMemo(() => ({
    all: items.length,
    text: items.filter((item) => item.type === 'text').length,
    image: images.length,
    json: items.filter((item) => item.type === 'json').length,
    file: items.filter((item) => item.type === 'file').length
  }), [images.length, items]);

  const copy = async (id: string, value: string) => {
    try {
      await writeClipboard(value);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(''), 1600);
    } catch {
      onError?.('复制失败，请检查浏览器剪贴板权限');
    }
  };

  const copyAll = () => {
    const sections = bundle.groups.flatMap((group) => group.items
      .filter((item) => item.type === 'text' || item.type === 'json')
      .map((item) => `## ${group.title} / ${item.label}\n${printableValue(item)}`));
    if (sections.length) void copy('all', sections.join('\n\n'));
  };

  const movePreview = (step: number) => {
    if (!images.length) return;
    const next = (previewIndex + step + images.length) % images.length;
    setPreviewId(images[next].id);
  };

  useEffect(() => {
    if (!previewItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewId('');
      if (event.key === 'ArrowLeft') movePreview(-1);
      if (event.key === 'ArrowRight') movePreview(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewId, images]);

  if (!items.length) {
    return <div className="output-empty"><FileJson size={24} /><strong>尚无输出结果</strong><span>运行完成后，多张图片、对应文案和文件会按结束节点分组显示</span></div>;
  }

  return <div className="output-collection">
    {bundle.error && <div className="output-partial-warning" role="alert"><strong>部分输出生成失败</strong><span>{bundle.error.split('\n')[0]}</span></div>}
    <div className="output-collection-head">
      <div><strong>工作流输出集合</strong><small>{bundle.groups.length} 个输出组 · {items.length} 个结果项</small></div>
      <div>
        <button type="button" onClick={copyAll} disabled={!counts.text && !counts.json}>{copiedId === 'all' ? <Check size={13} /> : <Copy size={13} />}{copiedId === 'all' ? '已复制' : '复制全部文案'}</button>
        <button type="button" onClick={() => downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), 'workflow-output.json')}><Download size={13} />导出结果</button>
      </div>
    </div>
    <div className="output-filters" aria-label="输出类型筛选">
      {(['all', 'image', 'text', 'json', 'file'] as OutputFilter[]).map((type) => <button type="button" key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type)} disabled={!counts[type]}>{type === 'all' ? '全部' : type === 'image' ? '图片' : type === 'text' ? '文案' : type === 'json' ? 'JSON' : '文件'}<span>{counts[type]}</span></button>)}
    </div>
    <div className="output-groups">
      {bundle.groups.map((group) => {
        const visible = group.items.filter((item) => filter === 'all' || item.type === filter);
        if (!visible.length) return null;
        const textItems = visible.filter((item) => item.type === 'text' || item.type === 'json');
        const imageItems = visible.filter((item): item is Extract<OutputItem, { type: 'image' }> => item.type === 'image');
        const fileItems = visible.filter((item): item is Extract<OutputItem, { type: 'file' }> => item.type === 'file');
        return <section className="output-group" key={group.id}>
          <header><span><Layers3 size={15} /></span><div><strong>{group.title}</strong><small>{group.key} · {visible.length} 项</small></div></header>
          {!!textItems.length && <div className="output-copy-list">{textItems.map((item) => {
            const value = printableValue(item);
            return <article className="output-copy-card" key={item.id}>
              <div><span>{item.type === 'text' ? <FileText size={14} /> : <FileJson size={14} />}</span><p><strong>{item.label}</strong><small>来自 {item.sourceTitle}</small></p><button type="button" onClick={() => void copy(item.id, value)}>{copiedId === item.id ? <Check size={13} /> : <Copy size={13} />}{copiedId === item.id ? '已复制' : '复制'}</button></div>
              <pre>{value}</pre>
            </article>;
          })}</div>}
          {!!imageItems.length && <div className="output-image-grid">{imageItems.map((item, index) => <article className="output-image-card" key={item.id}>
            <button type="button" className="output-image-trigger" onClick={() => setPreviewId(item.id)} aria-label={`预览 ${item.label}`} style={{ aspectRatio: item.asset.aspectRatio?.replace('/', ' / ') || '1 / 1' }}><img src={item.asset.url} alt={item.label} /><span><ZoomIn size={15} />预览</span></button>
            <footer><div><strong>{item.label}</strong><small>{item.asset.aspectRatio ? item.asset.aspectRatio.replace(' / ', ':') : `图片 ${index + 1}`} · {item.sourceTitle}</small></div><button type="button" aria-label={`下载 ${item.label}`} onClick={() => void downloadAsset(item.asset, `workflow-image-${index + 1}.png`)}><Download size={13} /></button></footer>
          </article>)}</div>}
          {!!fileItems.length && <div className="output-file-list">{fileItems.map((item) => <article key={item.id}><FileJson size={16} /><div><strong>{item.label}</strong><small>{item.asset.mimeType || 'application/octet-stream'}{item.asset.size ? ` · ${Math.ceil(item.asset.size / 1024)} KB` : ''}</small></div><button type="button" onClick={() => void downloadAsset(item.asset, item.label)}><Download size={13} />下载</button></article>)}</div>}
        </section>;
      })}
    </div>

    {previewItem && createPortal(<div className="image-preview-backdrop" role="presentation" onMouseDown={() => setPreviewId('')}>
      <section className="image-preview-dialog output-gallery" role="dialog" aria-modal="true" aria-label="多图片结果预览" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><ImageIcon size={16} /><span><strong>{previewItem.label}</strong><small>{previewIndex + 1} / {images.length} · ← → 切换 · Esc 关闭</small></span></div><div><button onClick={() => void downloadAsset(previewItem.asset, `workflow-image-${previewIndex + 1}.png`)}><Download size={15} />下载当前</button><button className="icon-button" aria-label="关闭图片预览" onClick={() => setPreviewId('')}><X size={18} /></button></div></header>
        <div className="image-preview-stage"><img src={previewItem.asset.url} alt={previewItem.label} /></div>
        {images.length > 1 && <><button className="gallery-nav previous" aria-label="上一张" onClick={() => movePreview(-1)}><ChevronLeft size={22} /></button><button className="gallery-nav next" aria-label="下一张" onClick={() => movePreview(1)}><ChevronRight size={22} /></button></>}
      </section>
    </div>, document.body)}
  </div>;
}
