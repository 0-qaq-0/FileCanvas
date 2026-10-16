import { X, AlertTriangle, ShieldCheck, ArrowDown, FolderOpen, Check } from 'lucide-react';
import type { NodeMap, Preview, ProjectRecord } from '../domain/types';
import { relativeTarget } from '../domain/workspace';

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
}: {
  preview: Preview;
  showUnchanged: boolean;
  setShowUnchanged(v: boolean): void;
  onClose(): void;
}) {
  const shown = preview.changes.filter(
    (c) => showUnchanged || c.kind !== 'unchanged' || c.issues.length,
  );
  return (
    <Modal
      wide
      title="预览整理结果"
      subtitle="基于当前虚拟结构与磁盘实时检查生成；此处不会执行任何真实文件操作。"
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
          原始文件只读
        </span>
      </div>
      <div className="preview-filter">
        <label>
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
          />
          显示无变化的文件
        </label>
        <span>检查于 {new Date(preview.checkedAt).toLocaleTimeString('zh-CN')}</span>
      </div>
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
      <footer className="modal-footer">
        <span>安全 MVP：真实应用与恢复尚未开放</span>
        <button className="button primary" onClick={onClose}>
          返回继续整理
        </button>
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
