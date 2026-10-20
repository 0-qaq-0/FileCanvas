import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { DEFAULT_TEMPLATE, planBatchRename } from '../domain/batch-rename';
import type { RenameRow } from '../domain/batch-rename';
import type { NodeMap } from '../domain/types';
import { Modal } from './Dialogs';

const TEMPLATES: [string, string][] = [
  ['原名 + 序号', '{name}_{n}'],
  ['序号 + 原名', '{n}_{name}'],
  ['日期 + 原名', '{date}_{name}'],
  ['文件夹名 + 序号', '{parent}_{n}'],
];

export function BatchRenameDialog({
  nodes,
  ids,
  rootName,
  onApply,
  onClose,
}: {
  nodes: NodeMap;
  ids: string[];
  rootName: string;
  onApply(rows: RenameRow[]): void;
  onClose(): void;
}) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [start, setStart] = useState(1);
  const [pad, setPad] = useState(2);
  const now = useMemo(() => Date.now(), []);
  const rows = useMemo(
    () => planBatchRename(nodes, ids, { find, replace, template, start, pad, now, rootName }),
    [nodes, ids, find, replace, template, start, pad, now, rootName],
  );
  const changed = rows.filter((row) => row.changed).length;
  const problems = rows.filter((row) => row.error).length;
  return (
    <Modal
      title={`批量重命名 ${rows.length} 项`}
      subtitle="扩展名始终保留。结果实时预览，确认后只改整理计划，真实文件要等“检查并应用”。"
      wide
      onClose={onClose}
    >
      <div className="rename-form">
        <label>
          查找
          <input aria-label="查找" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <label>
          替换为
          <input aria-label="替换为" value={replace} onChange={(e) => setReplace(e.target.value)} />
        </label>
        <label className="wide-field">
          命名模板
          <input
            aria-label="命名模板"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <small>
            可用占位符：{'{name}'} 原名、{'{n}'} 序号、{'{date}'} 修改日期、{'{parent}'} 所在文件夹
          </small>
        </label>
        <div className="template-chips">
          {TEMPLATES.map(([label, value]) => (
            <button
              type="button"
              className={template === value ? 'chip active' : 'chip'}
              key={value}
              onClick={() => setTemplate(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          起始序号
          <input
            type="number"
            min={0}
            aria-label="起始序号"
            value={start}
            onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label>
          序号位数
          <input
            type="number"
            min={0}
            max={6}
            aria-label="序号位数"
            value={pad}
            onChange={(e) => setPad(Math.min(6, Math.max(0, Number(e.target.value) || 0)))}
          />
        </label>
      </div>
      <div className="draft-summary">
        <span>将改名 {changed} 项</span>
        <span>{rows.length - changed - problems > 0 ? `${rows.length - changed} 项不变` : ''}</span>
        <span className={problems ? 'warning-text' : ''}>
          {problems ? (
            <>
              <AlertTriangle size={13} />
              {problems} 项有问题
            </>
          ) : (
            <>
              <ShieldCheck size={13} />
              名称都合法，没有重名
            </>
          )}
        </span>
      </div>
      <div className="draft-rows rename-rows">
        {rows.map((row) => (
          <div className={`rename-row ${row.error ? 'bad' : ''}`} key={row.id}>
            <span>{row.from}</span>
            <ArrowRight size={13} />
            <strong>{row.to}</strong>
            {row.error && <small role="alert">{row.error}</small>}
            {!row.error && !row.changed && <small>不变</small>}
          </div>
        ))}
      </div>
      <footer className="modal-footer">
        <span>可一次撤销（Ctrl+Z）。</span>
        <button className="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={!changed || !!problems}
          onClick={() => onApply(rows)}
        >
          应用批量重命名
        </button>
      </footer>
    </Modal>
  );
}
