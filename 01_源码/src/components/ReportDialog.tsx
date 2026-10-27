import { useRef, useState } from 'react';
import { ArrowRight, Download, FolderOpen, ShieldCheck, Undo2, Files } from 'lucide-react';
import type { PlanComparison, LevelSummary } from '../domain/comparison';
import { Modal } from './Dialogs';
import { FileIcon } from './FileIcon';

export interface ApplyReport {
  comparison: PlanComparison;
  moved: number;
  renamed: number;
  created: number;
  projectName: string;
  finishedAt: string;
}

const MAX_FOLDERS = 6;

function Pane({ title, level, names }: { title: string; level: LevelSummary; names: boolean }) {
  const shown = level.folders.slice(0, MAX_FOLDERS);
  return (
    <section className="compare-pane">
      <h3>
        {title}
        {/* Loose files are what organizing removes, so they are the headline number. */}
        <span>{level.loose.length ? `散放 ${level.loose.length} 个文件` : '没有散放文件'}</span>
      </h3>
      <ul>
        {shown.map((folder) => (
          <li key={folder.name}>
            <FileIcon name="" folder size={16} />
            <strong>{folder.name}</strong>
            <span>{folder.files ? `${folder.files} 个文件` : '空'}</span>
          </li>
        ))}
        {level.folders.length > MAX_FOLDERS && (
          <li className="compare-more">还有 {level.folders.length - MAX_FOLDERS} 个文件夹</li>
        )}
        {!!level.loose.length && (
          <li className="compare-loose">
            <FileIcon name="文件" size={16} />
            <strong>散放文件 {level.loose.length} 个</strong>
            <span>
              {level.looseTypes
                .slice(0, 3)
                .map(([label, count]) => `${label} ${count}`)
                .join(' · ')}
            </span>
          </li>
        )}
        {names && !!level.loose.length && (
          <li className="compare-names">
            {level.loose.slice(0, 5).join('、')}
            {level.loose.length > 5 ? ` 等 ${level.loose.length} 个` : ''}
          </li>
        )}
        {!level.folders.length && !level.loose.length && <li className="compare-more">没有内容</li>}
      </ul>
    </section>
  );
}

/**
 * Shown once a plan has been applied and verified: what changed, a before/after card that can be
 * saved as an image (file names hidden unless the user asks), and the way back.
 */
export function ReportDialog({
  report,
  onRecover,
  onClose,
}: {
  report: ApplyReport;
  onRecover(): void;
  onClose(): void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [names, setNames] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const { comparison, moved, renamed, created } = report;
  const facts = [
    moved && `移动 ${moved} 项`,
    renamed && `改名 ${renamed} 项`,
    created && `新建 ${created} 个文件夹`,
  ].filter(Boolean);
  async function save() {
    const el = card.current;
    if (!el) return;
    setSaving(true);
    setMessage('');
    try {
      el.scrollIntoView({ block: 'nearest' });
      // Let the scroll settle so the captured box matches what is painted.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = el.getBoundingClientRect();
      const result = await window.fileCanvas.saveImage({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      });
      if (!result.ok) setMessage(result.error ?? '对比图没有保存。');
      else if (result.data) setSaved(result.data);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      wide
      title="整理完成"
      subtitle="文件已移动并逐个核验。不满意可以一键放回原处。"
      onClose={onClose}
    >
      <div className="preview-summary report-summary" data-testid="report-summary">
        {moved > 0 && (
          <div>
            <strong>{moved}</strong>
            <span>移动</span>
          </div>
        )}
        {renamed > 0 && (
          <div>
            <strong>{renamed}</strong>
            <span>改名</span>
          </div>
        )}
        {created > 0 && (
          <div>
            <strong>{created}</strong>
            <span>新建文件夹</span>
          </div>
        )}
        <span className="tag">
          <ShieldCheck size={13} />
          已核验 · 可恢复
        </span>
      </div>
      <div className="report-body">
        <div className="compare-card" ref={card} data-testid="compare-card">
          <header>
            <span className="brand-mark">
              <Files size={14} />
            </span>
            <strong>FileCanvas</strong>
            <span>整理前后对比{names ? ` · ${report.projectName}` : ''}</span>
            <time>{new Date(report.finishedAt).toLocaleDateString('zh-CN')}</time>
          </header>
          <div className="compare-panes">
            <Pane title="整理前" level={comparison.before} names={names} />
            <ArrowRight className="compare-arrow" size={20} />
            <Pane title="整理后" level={comparison.after} names={names} />
          </div>
          <footer>{facts.join(' · ')} · 已逐个核验，可一键恢复 · 先在画布预览，再应用到文件</footer>
        </div>
        <label className="check-line report-names">
          <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
          图中显示文件名和项目名（默认隐藏；文件夹名始终显示，分享前请看一眼）
        </label>
        {saved && (
          <p className="report-saved" role="status">
            对比图已保存：<code>{saved}</code>
            <button className="text-button" onClick={() => void window.fileCanvas.revealExport()}>
              <FolderOpen size={13} />
              在资源管理器中显示
            </button>
          </p>
        )}
        {message && (
          <p className="operation-error" role="alert">
            {message}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <span>统计只包含画布内的内容</span>
        <button className="button" onClick={onRecover}>
          <Undo2 size={15} />
          恢复上次文件移动
        </button>
        <button className="button" disabled={saving} onClick={() => void save()}>
          <Download size={15} />
          保存对比图
        </button>
        <button className="button primary" onClick={onClose}>
          完成
        </button>
      </footer>
    </Modal>
  );
}
