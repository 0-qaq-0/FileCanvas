import { AlertTriangle, CheckCircle2, RefreshCw, Undo2 } from 'lucide-react';
import type { OperationStatus, RefreshReview } from '../domain/types';
import { Modal } from './Dialogs';

export function RecoveryDialog({
  task,
  error,
  rootPath,
  onClose,
  onRecover,
}: {
  task: OperationStatus | null;
  error: string;
  rootPath: string;
  onClose(): void;
  onRecover(): void;
}) {
  return (
    <Modal
      title={task?.needsRecovery ? '处理未完成的文件整理' : '最近一次文件整理'}
      onClose={onClose}
    >
      <div className="operation-details">
        {task?.needsRecovery ? <AlertTriangle size={30} /> : <CheckCircle2 size={30} />}
        <p>{task?.message ?? '当前没有文件恢复任务。'}</p>
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        <p>整理目录</p>
        <code>{rootPath}</code>
        {task && (
          <>
            <p>操作时间：{new Date(task.createdAt).toLocaleString('zh-CN')}</p>
            <small>任务编号：{task.id}</small>
          </>
        )}
        <p>
          恢复会把本次整理涉及的文件放回原位置。文件被外部编辑、原位置被新文件占用或目录有新内容时，会保留数据并提示处理。请先关闭正在编辑这些文件的应用。
        </p>
        <p>当前支持恢复最近一次整理。更早的任务记录保留用于排查，不提供任意历史回滚。</p>
      </div>
      <footer className="modal-footer">
        <button className="button" onClick={onClose}>
          返回查看
        </button>
        {task?.canUndo && (
          <button className="button primary" onClick={onRecover}>
            <Undo2 size={15} />
            恢复文件原位置
          </button>
        )}
      </footer>
    </Modal>
  );
}

export function RefreshDialog({
  review,
  onClose,
  onAdopt,
}: {
  review: RefreshReview;
  onClose(): void;
  onAdopt(): void;
}) {
  const labels = { new: '新发现', modified: '已修改', missing: '已缺失 · 移出计划' };
  return (
    <Modal
      wide
      title="刷新并核对本地变化"
      subtitle="核对后更新文件基准。已有的整理位置尽量保留；这里不会移动本地文件。"
      onClose={onClose}
    >
      <div className="refresh-summary">
        {(['new', 'modified', 'missing'] as const).map((kind) => (
          <span key={kind}>
            {labels[kind]}：<strong>{review.changes.filter((c) => c.kind === kind).length}</strong>
          </span>
        ))}
      </div>
      <div className="preview-list">
        {!review.changes.length && <p className="quiet-empty">已核对，未发现文件变化。</p>}
        {review.changes.map((c, i) => (
          <article className="change-row" key={`${c.path}-${i}`}>
            <div className="change-heading">
              <strong>{c.name}</strong>
              <span className="tag neutral">{labels[c.kind]}</span>
            </div>
            <code>{c.path}</code>
          </article>
        ))}
        {review.skipped.map((c) => (
          <article className="change-row has-issue" key={c.path}>
            <strong>{c.name} · 未加入</strong>
            <p>{c.reason}</p>
          </article>
        ))}
      </div>
      <footer className="modal-footer">
        <span>缺失条目及其子项会移出计划，请先核对列表。</span>
        <button className="button" onClick={onClose}>
          取消，保留原计划
        </button>
        <button className="button primary" onClick={onAdopt}>
          <RefreshCw size={15} />
          采用刷新结果
        </button>
      </footer>
    </Modal>
  );
}
