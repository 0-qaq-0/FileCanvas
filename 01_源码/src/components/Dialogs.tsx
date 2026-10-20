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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose(): void;
  wide?: boolean;
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
  return (
    <div
      className="modal-backdrop"
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
          if (event.key !== 'Tab') return;
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
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
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
  const shown = preview.changes.filter(
    (c) => showUnchanged || c.kind !== 'unchanged' || c.issues.length,
  );
  return (
    <Modal
      wide
      title="预览整理结果"
      subtitle="核对这份计划后应用到本地。执行前再次检查，完成后重新扫描并验证结果。"
      onClose={onClose}
    >
      <div className="preview-summary">
        <div>
          <strong>{preview.changed}</strong>
          <span>待变更条目</span>
        </div>
        <div>
          <strong>{preview.unchanged}</strong>
          <span>路径未改变</span>
        </div>
        <div className={preview.issues ? 'warning-text' : ''}>
          <strong>{preview.issues}</strong>
          <span>需要检查</span>
        </div>
        <span className="tag">
          <ShieldCheck size={13} />
          确认后才执行
        </span>
      </div>
      <div className="preview-root">
        <span>本次整理目录</span>
        <code>{rootPath}</code>
        <small>
          整理涉及的文件夹里，另有 {preview.preserved ?? '其他'}{' '}
          个未加入画布的条目，会原样保留；没有涉及的位置不会被读取或改动。原有未改动的空目录保留。每次最多
          100 个文件。
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
  onLoad,
  onClose,
}: {
  records: ProjectRecord[];
  onLoad(id: string): void;
  onClose(): void;
}) {
  return (
    <Modal
      title="我的整理项目"
      subtitle="项目仅存放在 FileCanvas 自身的数据目录中。"
      onClose={onClose}
    >
      <div className="project-list">
        {!records.length && <div className="quiet-empty">还没有保存的项目</div>}
        {records.map((p) => (
          <button className="project-item" key={p.id} onClick={() => onLoad(p.id)}>
            <FolderOpen size={24} />
            <div>
              <strong>{p.name}</strong>
              <span>{p.rootPath}</span>
              <small>{new Date(p.updatedAt).toLocaleString('zh-CN')}</small>
            </div>
          </button>
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
      title="移动到虚拟文件夹"
      subtitle="只改变整理结构，不移动硬盘文件。循环层级或同名操作会被拒绝。"
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
