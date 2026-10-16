import { useEffect, useState } from 'react';
import { ArrowUpRight, X, Sparkles, LoaderCircle } from 'lucide-react';
import type { CanvasNode, FileContent, NodeMap } from '../domain/types';
import { FileIcon, formatSize } from './FileIcon';
import { PathInspector } from './PathInspector';

export function ContentPanel({
  node,
  nodes,
  root,
  onClose,
  onSelect,
  onEnter,
  onAsk,
}: {
  node: CanvasNode;
  nodes: NodeMap;
  root: string;
  onClose(): void;
  onSelect(id: string): void;
  onEnter(id: string): void;
  onAsk(): void;
}) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setContent(null);
    setError('');
    if (node.kind === 'file' && node.source)
      window.fileCanvas
        .readContent(node.source.path)
        .then((r) => {
          if (!active) return;
          if (r.ok && r.data) setContent(r.data);
          else setError(r.error ?? '读取失败');
        })
        .catch(() => {
          if (active) setError('文件内容读取失败');
        });
    return () => {
      active = false;
    };
  }, [node.id, node.source?.path]);
  const children = Object.values(nodes).filter((n) => n.parentId === node.id);
  return (
    <aside className="content-panel" aria-label="文件内容预览">
      <div className="drawer-title">
        <span>内容预览</span>
        <button className="icon-button" title="收起内容预览" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="content-heading">
        <FileIcon name={node.name} folder={node.kind === 'folder'} size={32} />
        <div>
          <h2>{node.name}</h2>
          <small>
            {node.kind === 'folder'
              ? `${children.length} 个子项`
              : formatSize(node.source?.size ?? 0)}
          </small>
        </div>
      </div>
      <PathInspector nodes={nodes} selected={[node.id]} root={root} />
      <div className="content-body">
        {node.kind === 'folder' ? (
          <>
            <button className="button" onClick={() => onEnter(node.id)}>
              <ArrowUpRight size={15} />
              进入此文件夹整理
            </button>
            <div className="preview-children">
              {children.map((child) => (
                <button key={child.id} onClick={() => onSelect(child.id)}>
                  <FileIcon name={child.name} folder={child.kind === 'folder'} size={20} />
                  <span>{child.name}</span>
                  <ArrowUpRight size={12} />
                </button>
              ))}
              {!children.length && <p>这个文件夹目前没有画布条目。</p>}
            </div>
          </>
        ) : (
          <>
            {error && <p className="inline-error">{error}</p>}
            {!content && !error && (
              <p>
                <LoaderCircle size={16} className="spin" /> 正在读取原文件…
              </p>
            )}
            {content?.kind === 'image' && (
              <img className="content-image" src={content.dataUrl} alt={node.name} />
            )}
            {content?.kind === 'text' && (
              <>
                <pre className="text-preview">{content.text || '（空文件）'}</pre>
                {content.truncated && (
                  <p className="content-note">仅展示前 24000 字符，后续内容未读取。</p>
                )}
              </>
            )}
            {content?.kind === 'unsupported' && (
              <div className="unsupported-preview">
                <FileIcon name={node.name} size={56} />
                <p>{content.message}</p>
              </div>
            )}
          </>
        )}
      </div>
      <button className="button primary content-ask" onClick={onAsk}>
        <Sparkles size={15} />问 AI：这是什么，怎么整理？
      </button>
    </aside>
  );
}
