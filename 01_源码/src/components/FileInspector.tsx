import { useEffect, useState, useRef } from 'react';
import {
  ArrowUpRight,
  X,
  Sparkles,
  LoaderCircle,
  ExternalLink,
  GripVertical,
  MapPin,
  RefreshCw,
  Send,
} from 'lucide-react';
import type { CanvasNode, FileContent, FileAdvice, FileAiAccess, Project } from '../domain/types';
import { relativeTarget } from '../domain/workspace';
import { FileIcon, formatSize } from './FileIcon';
import { PathInspector } from './PathInspector';
function unwrap<T>(r: { ok: boolean; data?: T; error?: string }): T {
  if (!r.ok) throw new Error(r.error ?? '操作失败');
  return r.data as T;
}
export function FileInspector({
  node,
  project,
  onClose,
  onSelect,
  onEnter,
  onSettings,
  onOpen,
  onAdopt,
  onHighlight,
  onLocate,
}: {
  node: CanvasNode;
  project: Project;
  onClose(): void;
  onSelect(id: string): void;
  onEnter(id: string): void;
  onSettings(): void;
  onOpen(id: string): void;
  onAdopt(id: string, advice: FileAdvice): void;
  onHighlight(id: string | null): void;
  onLocate(id: string | null): void;
}) {
  const nodes = project.nodes;
  const refreshRequested = useRef(false);
  const [content, setContent] = useState<{ id: string; value: FileContent } | null>(null),
    [error, setError] = useState('');
  const [access, setAccess] = useState<FileAiAccess | null>(null),
    [advice, setAdvice] = useState<{ id: string; value: FileAdvice } | null>(null);
  const [thinking, setThinking] = useState(false),
    [revision, setRevision] = useState(0),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [asking, setAsking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const focus = () => setRefresh((v) => v + 1);
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  useEffect(() => {
    let active = true;
    setError('');
    setAnswer('');
    setQuestion('');
    setAdvice(null);
    onHighlight(null);
    window.fileCanvas
      .fileAiAccess()
      .then((r) => {
        if (active) setAccess(unwrap(r));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    if (node.kind === 'file' && node.source)
      window.fileCanvas
        .readContent(node.source.path)
        .then((r) => {
          if (active) setContent({ id: node.id, value: unwrap(r) });
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [node.id, node.source?.path, refresh]);
  useEffect(() => {
    let active = true;
    if (!access?.enabled || !access.model || node.kind !== 'file') {
      setThinking(false);
      return;
    }
    setThinking(true);
    setError('');
    const timer = setTimeout(() => {
      const force = refreshRequested.current;
      refreshRequested.current = false;
      window.fileCanvas
        .explainFile(project, node.id, force)
        .then((r) => {
          if (!active) return;
          const value = unwrap(r);
          setAdvice({ id: node.id, value });
          onHighlight(value.destinationId);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setThinking(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [node.id, node.source?.path, access?.enabled, access?.model, revision, refresh]);
  const value = advice?.id === node.id ? advice.value : null,
    preview = content?.id === node.id ? content.value : null;
  const children = Object.values(nodes).filter((n) => n.parentId === node.id);
  const destination = value?.newFolder
    ? `项目根目录 / ${value.newFolder}（新建）`
    : value?.destinationId && nodes[value.destinationId]
      ? relativeTarget(nodes, value.destinationId).join(' / ')
      : '项目根目录';
  const recommendedId = value?.newFolder
    ? Object.values(nodes).find(
        (n) =>
          n.parentId === null &&
          n.kind === 'folder' &&
          n.name.toLowerCase() === value.newFolder!.toLowerCase(),
      )?.id
    : value?.destinationId;
  const alreadyPlaced =
    !!value &&
    ['move', 'archive'].includes(value.action) &&
    recommendedId !== undefined &&
    node.parentId === recommendedId;
  const drag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('application/x-filecanvas-nodes', JSON.stringify([id]));
    e.dataTransfer.setData(`application/x-filecanvas-id-${id}`, '');
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <aside className="content-panel file-inspector" aria-label="文件解释与预览">
      <div className="drawer-title">
        <span>看懂文件，再整理</span>
        <button className="icon-button" title="收起内容预览" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div
        className="content-heading"
        draggable
        onDragStart={(e) => drag(e, node.id)}
        title="拖动文件标题，放入画布中的文件夹"
      >
        <GripVertical size={14} />
        <FileIcon name={node.name} folder={node.kind === 'folder'} size={28} />
        <div>
          <h2>{node.name}</h2>
          <small>
            {node.kind === 'folder'
              ? `${children.length} 个子项`
              : formatSize(node.source?.size ?? 0)}{' '}
            · 可从这里拖到画布
          </small>
        </div>
      </div>
      {node.kind === 'file' && (
        <button className="button inspector-open" onClick={() => onOpen(node.id)}>
          <ExternalLink size={14} />
          用系统应用打开
        </button>
      )}
      <div className="inspector-scroll">
        {node.kind === 'file' && (
          <section className="file-advice-section">
            <div className="file-advice-heading">
              <span>
                <Sparkles size={16} />
                文件解释与推荐
              </span>
              <button className="text-button" onClick={onSettings}>
                模型设置
              </button>
            </div>
            {access && !access.model ? (
              <p className="inspector-note">
                先配置模型，即可自动解释选中文件并推荐位置。
                <button className="text-button" onClick={onSettings}>
                  去配置
                </button>
              </p>
            ) : (
              <label className="check-line file-ai-consent">
                <input
                  type="checkbox"
                  checked={access?.enabled ?? false}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setAccess((old) => (old ? { ...old, enabled } : old));
                    void window.fileCanvas
                      .fileAiAccess(enabled)
                      .then((r) => setAccess(unwrap(r)))
                      .catch((err) => {
                        setAccess((old) => (old ? { ...old, enabled: false } : old));
                        setError(err.message);
                      });
                  }}
                />
                允许本项目使用 {access?.model || '当前模型'}{' '}
                自动分析所选文件与相关文本片段（本次运行有效）
              </label>
            )}
            {access?.model && (
              <small className="inspector-service">模型服务：{access.baseUrl}</small>
            )}
            {thinking && (
              <p className="inspector-thinking">
                <LoaderCircle size={16} className="spin" />
                正在结合项目内容理解这个文件…
              </p>
            )}
            {value && (
              <div data-testid="file-advice">
                <div className="advice-purpose">
                  <small>这是什么？{!value.readBody && ' · 仅按文件信息推测'}</small>
                  <h3>{value.purpose}</h3>
                </div>
                <div className="advice-contents">
                  <strong>主要包括</strong>
                  <ul>
                    {value.contents.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <p className="advice-project-role">
                  <strong>在项目中的作用</strong>
                  {value.projectRole}
                </p>
                <div
                  className={`file-recommendation ${value.action === 'review-delete' ? 'needs-review' : ''}`}
                >
                  <small>最推荐的处理</small>
                  <h3>
                    {value.action === 'keep'
                      ? '保留在当前位置'
                      : value.action === 'review-delete'
                        ? '标记为待删除候选'
                        : `${value.action === 'archive' ? '归档到' : '放到'}：${destination}`}
                  </h3>
                  <p>{value.reason}</p>
                  {value.action !== 'keep' && (
                    <button
                      className="button primary"
                      disabled={
                        alreadyPlaced || (value.action === 'review-delete' && node.reviewDelete)
                      }
                      onClick={() => onAdopt(node.id, value)}
                    >
                      {value.action === 'review-delete'
                        ? node.reviewDelete
                          ? '已标记，原文件保留'
                          : '标记待删除（不删除文件）'
                        : alreadyPlaced
                          ? '已在推荐位置'
                          : `采用推荐位置`}
                    </button>
                  )}
                  {['move', 'archive'].includes(value.action) && !value.newFolder && (
                    <button className="text-button" onClick={() => onLocate(value.destinationId)}>
                      <MapPin size={13} />
                      在画布上找到这里
                    </button>
                  )}
                </div>
                <details className="advice-evidence">
                  <summary>为什么这样判断？查看 {value.sources.length} 段依据</summary>
                  {value.sources.map((s, i) => (
                    <div key={i}>
                      <strong>{s.path}</strong>
                      <pre>{s.text}</pre>
                    </div>
                  ))}
                </details>
                <button
                  className="text-button"
                  disabled={thinking}
                  onClick={() => {
                    setAdvice(null);
                    refreshRequested.current = true;
                    setRevision((v) => v + 1);
                  }}
                >
                  <RefreshCw size={13} />
                  重新分析
                </button>
                <form
                  className="file-followup"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (asking) return;
                    setAsking(true);
                    setError('');
                    window.fileCanvas
                      .followupFile(project, node.id, question)
                      .then((r) => setAnswer(unwrap(r)))
                      .catch((err) => setError(err.message))
                      .finally(() => setAsking(false));
                  }}
                >
                  <label>
                    继续问这个文件
                    <input
                      aria-label="继续问这个文件"
                      value={question}
                      maxLength={2000}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="例如：为什么放这里？和另一份有何区别？"
                    />
                  </label>
                  <button className="button" disabled={asking || !question.trim()}>
                    <Send size={14} />
                    {asking ? '回答中…' : '发送'}
                  </button>
                </form>
                {answer && <p className="file-followup-answer">{answer}</p>}
              </div>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
                <button className="text-button" onClick={() => setRevision((v) => v + 1)}>
                  重试
                </button>
              </p>
            )}
          </section>
        )}
        <section className="inline-file-preview">
          <h3>{node.kind === 'folder' ? '文件夹内部 · 每一项都可拖动' : '内容预览'}</h3>
          {node.kind === 'folder' ? (
            <>
              <button className="button" onClick={() => onEnter(node.id)}>
                <ArrowUpRight size={15} />
                单独查看此文件夹
              </button>
              <div className="preview-children">
                {children.map((child) => (
                  <button
                    key={child.id}
                    draggable
                    onDragStart={(e) => drag(e, child.id)}
                    onClick={() => onSelect(child.id)}
                  >
                    <GripVertical size={12} />
                    <FileIcon name={child.name} folder={child.kind === 'folder'} size={18} />
                    <span>{child.name}</span>
                  </button>
                ))}
                {!children.length && <p>这个文件夹还没有文件。</p>}
              </div>
            </>
          ) : (
            <>
              {!preview && !error && <p>正在读取…</p>}
              {preview?.kind === 'image' && (
                <img className="content-image" src={preview.dataUrl} alt={node.name} />
              )}
              {preview?.kind === 'text' && (
                <>
                  <pre className="text-preview">{preview.text || '（空文件）'}</pre>
                  {preview.truncated && (
                    <p className="inspector-note">这里只展示正文前 24000 字符。</p>
                  )}
                </>
              )}
              {preview?.kind === 'unsupported' && (
                <div className="unsupported-preview">
                  <p>{preview.message}</p>
                </div>
              )}
            </>
          )}
        </section>
        <PathInspector nodes={nodes} selected={[node.id]} root={project.rootPath} />
        {node.reviewDelete && (
          <div className="delete-candidate">
            <span>已标记待删除，原文件仍保留。</span>
            <button
              className="text-button"
              onClick={() => onAdopt(node.id, { ...value!, action: 'keep' } as FileAdvice)}
            >
              取消标记
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
