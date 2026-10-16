import { useMemo, useState } from 'react';
import { Layers3, Folder, ShieldCheck, AlertTriangle } from 'lucide-react';
import { buildClassificationDraft } from '../domain/drafts';
import type { DraftMode } from '../domain/drafts';
import type { Workspace } from '../domain/types';
import { Modal } from './Dialogs';

export function DraftDialog({
  state,
  parentId,
  onAdopt,
  onClose,
}: {
  state: Workspace;
  parentId: string | null;
  onAdopt(mode: DraftMode): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState<DraftMode>('content-project');
  const draft = useMemo(
    () => buildClassificationDraft(state, parentId, mode),
    [state, parentId, mode],
  );
  return (
    <Modal
      title="先生成一份分类草案"
      subtitle="只规划当前层的文件，现有子文件夹保持原样。规则依据文件名和扩展名，不读取内容，也不是 AI 判断。"
      wide
      onClose={onClose}
    >
      <div className="draft-presets">
        <button
          className={mode === 'content-project' ? 'preset active' : 'preset'}
          onClick={() => setMode('content-project')}
        >
          <Layers3 size={20} />
          <span>
            <strong>内容项目</strong>
            <small>策划资料 → 创作素材 → 交付成品 · 不确定的留待确认</small>
          </span>
        </button>
        <button
          className={mode === 'type' ? 'preset active' : 'preset'}
          onClick={() => setMode('type')}
        >
          <Folder size={20} />
          <span>
            <strong>按文件类型</strong>
            <small>图片、文档、音频、视频、压缩包、代码与配置、其他</small>
          </span>
        </button>
      </div>
      <div className="draft-summary">
        <span>{draft.rows.length} 个文件</span>
        <span>{draft.folders.length} 个目标文件夹（同名目录会复用）</span>
        <span>
          <ShieldCheck size={13} />
          采用后仍然只在画布内变化
        </span>
      </div>
      <div className="draft-rows">
        {!draft.rows.length && (
          <p className="quiet-empty">
            当前层没有可分类的文件。请先加入文件或进入有文件的虚拟文件夹。
          </p>
        )}
        {draft.rows.map((row) => (
          <div className="draft-row" key={row.id}>
            <strong>{row.name}</strong>
            <span>{row.folder}</span>
            <small>{row.reason}</small>
          </div>
        ))}
        {draft.issues.map((issue) => (
          <p className="inline-error" role="alert" key={issue}>
            <AlertTriangle size={14} /> {issue}
          </p>
        ))}
      </div>
      <footer className="modal-footer">
        <span>可一次撤销整份草案。采用后请用“预览变更”检查硬盘冲突。</span>
        <button
          className="button primary"
          disabled={!draft.rows.length || !draft.next}
          onClick={() => onAdopt(mode)}
        >
          采用草案到画布
        </button>
      </footer>
    </Modal>
  );
}
