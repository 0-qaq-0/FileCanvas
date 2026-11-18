import { useMemo, useState, useEffect, useRef } from 'react';
import {
  X,
  AlertTriangle,
  ShieldCheck,
  ArrowDown,
  FolderOpen,
  Check,
  Download,
  GitCompareArrows,
  Trash2,
} from 'lucide-react';
import type { NodeMap, Preview, ProjectRecord } from '../domain/types';
import { relativeTarget } from '../domain/workspace';
import { planTrees } from '../domain/plan-report';

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  side = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose(): void;
  wide?: boolean;
  /** A panel docked on the right that leaves the page behind it visible and usable. */
  side?: boolean;
}) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target =
      section.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled])',
      ) ?? section.current?.querySelector<HTMLElement>('button:not([disabled])');
    target?.focus();
    return () => previous?.focus();
  }, []);
  // A focused control can disappear while the dialog is open (an option that only applies to one
  // mode, say). Focus then falls out of the dialog, and Esc must still close it.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (side) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !section.current?.contains(event.target as Node))
        close.current();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [side]);
  return (
    <div
      className={`modal-backdrop ${side ? 'side' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <section
        ref={section}
        onKeyDown={(event) => {
          // A docked panel does not hold keyboard focus captive.
          if (event.key !== 'Tab' || side) return;
          const targets = Array.from(
            section.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
            ) ?? [],
          ).filter((el) => el.offsetParent !== null);
          if (!targets.length) return;
          const first = targets[0],
            last = targets.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        role="dialog"
        aria-modal={!side}
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''} ${side ? 'side' : ''}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
const labels = {
  create: '新建目录',
  move: '移动',
  rename: '重命名',
  'move-rename': '移动并重命名',
  unchanged: '无变化',
};
export function PreviewDialog({
  preview,
  showUnchanged,
  setShowUnchanged,
  onClose,
  rootPath,
  exportPath,
  onExport,
  onReveal,
  onApply,
  errorMessage,
}: {
  preview: Preview;
  showUnchanged: boolean;
  setShowUnchanged(v: boolean): void;
  onClose(): void;
  rootPath: string;
  exportPath: string | null;
  onExport(): void;
  onReveal(): void;
  onApply?(): void;
  errorMessage?: string;
}) {
  const [view, setView] = useState<'changes' | 'structure'>('changes');
  const trees = useMemo(() => planTrees(preview, rootPath), [preview, rootPath]);
  // What needs attention comes first: in a long list a single problem would be easy to miss.
  const shown = useMemo(
    () =>
      preview.changes
        .filter((c) => showUnchanged || c.kind !== 'unchanged' || c.issues.length)
        .sort((a, b) => Number(!!b.issues.length) - Number(!!a.issues.length)),
    [preview, showUnchanged],
  );
  // Say what will happen in the user's words ("移动 8 项"), not as one total of plan entries.
  const count = (...kinds: string[]) =>
    preview.changes.filter((c) => kinds.includes(c.kind)).length;
  const summary = [
    { label: '移动', value: count('move', 'move-rename') },
    { label: '改名', value: count('rename') },
    { label: '新建文件夹', value: count('create') },
  ].filter((item) => item.value);
  return (
    <Modal
      wide
      title="预览整理结果"
      subtitle="核对这份计划后应用到本地。执行前再次检查，完成后重新扫描并验证结果。"
      onClose={onClose}
    >
      <div className="preview-summary" data-testid="preview-summary">
        {summary.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
        {!summary.length && (
          <div>
            <strong>0</strong>
            <span>没有路径变化</span>
          </div>
        )}
        {!!preview.issues && (
          <div className="warning-text">
            <strong>{preview.issues}</strong>
            <span>需要处理</span>
          </div>
        )}
        <span className="tag">
          <ShieldCheck size={13} />
          确认后才执行
        </span>
      </div>
      <div className="preview-root">
        <span>本次整理目录</span>
        <code>{rootPath}</code>
        <small
          title={`整理涉及的文件夹里，另有 ${preview.preserved ?? '其他'} 个未加入画布的条目，会原样保留；没有涉及的位置不会被读取或改动。原有未改动的空目录保留。`}
        >
          {preview.preserved ? `画布外的 ${preview.preserved} 个条目原样保留 · ` : ''}
          只改动上面列出的路径
        </small>
      </div>
      {errorMessage && (
        <p className="operation-error" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="preview-filter">
        <div className="view-tabs">
          <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}>
            逐项变更
          </button>
          <button
            className={view === 'structure' ? 'active' : ''}
            onClick={() => setView('structure')}
          >
            <GitCompareArrows size={13} />
            结构对照
          </button>
        </div>
        {view === 'changes' && (
          <label>
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />
            显示无变化的文件
          </label>
        )}
        <span>检查于 {new Date(preview.checkedAt).toLocaleTimeString('zh-CN')}</span>
      </div>
      {view === 'structure' ? (
        <div className="structure-comparison">
          <section>
            <h3>
              整理前 <span>已加入的源条目</span>
            </h3>
            <pre data-testid="before-tree">{trees.before}</pre>
          </section>
          <section>
            <h3>
              拟整理后 <span>尚未执行</span>
            </h3>
            <pre data-testid="after-tree">{trees.after}</pre>
          </section>
        </div>
      ) : (
        <div className="preview-list">
          {!shown.length && (
            <div className="quiet-empty">
              <Check size={24} />
              <p>当前没有路径变更。画布位置不影响真实路径。</p>
            </div>
          )}
          {shown.map((change) => (
            <article
              className={`change-row ${change.issues.length ? 'has-issue' : ''}`}
              key={change.id}
            >
              <div className="change-heading">
                <strong>{change.name}</strong>
                <span className={`tag ${change.kind === 'unchanged' ? 'neutral' : ''}`}>
                  {labels[change.kind]}
                </span>
              </div>
              {change.source && (
                <div className="path-line">
                  <span>原路径</span>
                  <code>{change.source}</code>
                </div>
              )}
              <div className="path-line">
                <span>{change.source ? <ArrowDown size={13} /> : '将创建'}</span>
                <code>{change.target}</code>
              </div>
              {change.issues.map((issue) => (
                <p className="issue" key={issue}>
                  <AlertTriangle size={13} />
                  {issue}
                </p>
              ))}
            </article>
          ))}
        </div>
      )}
      {exportPath && (
        <div className="export-result">
          <span>方案已导出（未执行真实整理）</span>
          <code title={exportPath}>{exportPath}</code>
          <button className="text-button" onClick={onReveal}>
            在文件夹中查看
          </button>
        </div>
      )}
      <footer className="modal-footer">
        <span>本地同卷文件与文件夹 · 不覆盖 · 可恢复最近一次</span>
        <button className="button" onClick={onExport}>
          <Download size={15} />
          导出整理方案
        </button>
        <button className="button" onClick={onClose}>
          返回继续整理
        </button>
        {onApply && (
          <button
            className="button primary"
            disabled={!preview.changed || !!preview.issues || !preview.planId}
            onClick={onApply}
          >
            应用到本地文件
          </button>
        )}
      </footer>
    </Modal>
  );
}
export function ProjectsDialog({
  records,
  activeId,
  onLoad,
  onDelete,
  onClose,
}: {
  records: ProjectRecord[];
  activeId: string | null;
  onLoad(id: string): void;
  onDelete(id: string): void;
  onClose(): void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Modal
      title="我的整理项目"
      subtitle="项目仅存放在 FileCanvas 自身的数据目录中。删除项目记录不会改动文件夹和文件。"
      onClose={onClose}
    >
      <div className="project-list">
        {!records.length && <div className="quiet-empty">还没有保存的项目</div>}
        {records.map((p) => (
          <div className="project-row" key={p.id}>
            <button className="project-item" onClick={() => onLoad(p.id)}>
              <FolderOpen size={24} />
              <div>
                <strong>
                  {p.name}
                  {p.demo ? '（示例）' : ''}
                </strong>
                <span>{p.rootPath}</span>
                <small>{new Date(p.updatedAt).toLocaleString('zh-CN')}</small>
              </div>
            </button>
            {p.id === activeId ? (
              <span className="tag neutral">正在打开</span>
            ) : confirming === p.id ? (
              <span className="project-confirm">
                <button
                  className="button small danger-text"
                  onClick={() => {
                    setConfirming(null);
                    onDelete(p.id);
                  }}
                >
                  确定删除记录
                </button>
                <button className="button small" onClick={() => setConfirming(null)}>
                  取消
                </button>
              </span>
            ) : (
              <button
                className="icon-button"
                title="删除这条项目记录，不改动文件夹和文件"
                aria-label={`删除项目记录 ${p.name}`}
                onClick={() => setConfirming(p.id)}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
export function MoveDialog({
  nodes,
  onMove,
  onClose,
}: {
  nodes: NodeMap;
  onMove(id: string | null): void;
  onClose(): void;
}) {
  return (
    <Modal
      title="移动到文件夹"
      subtitle="只改整理计划，应用前不会移动硬盘文件。有同名文件或放进自己时无法移入。"
      onClose={onClose}
    >
      <div className="move-list">
        <button className="project-item" onClick={() => onMove(null)}>
          <FolderOpen size={20} />
          <div>
            <strong>画布根目录</strong>
          </div>
        </button>
        {Object.values(nodes)
          .filter((n) => n.kind === 'folder')
          .map((n) => (
            <button className="project-item" key={n.id} onClick={() => onMove(n.id)}>
              <FolderOpen size={20} />
              <div>
                <strong>{relativeTarget(nodes, n.id).join(' / ')}</strong>
              </div>
            </button>
          ))}
      </div>
    </Modal>
  );
}
