import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers3,
  Folder,
  ShieldCheck,
  AlertTriangle,
  CalendarDays,
  Archive,
  ListChecks,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { buildClassificationDraft } from '../domain/drafts';
import type { DraftMode, DraftOptions } from '../domain/drafts';
import { RECIPE_INFO } from '../domain/recipes';
import { CUSTOM_INFO } from '../domain/rules';
import { children } from '../domain/workspace';
import type { OrganizeRule, Workspace } from '../domain/types';
import { Modal } from './Dialogs';
import { RulesEditor } from './RulesEditor';

const ICONS = {
  'content-project': Layers3,
  type: Folder,
  month: CalendarDays,
  stale: Archive,
  custom: ListChecks,
} as const;
const INFO = { ...RECIPE_INFO, custom: CUSTOM_INFO };
const ORDER: DraftMode[] = ['content-project', 'type', 'month', 'stale', 'custom'];
const STALE_CHOICES = [30, 90, 180, 365];

export function DraftDialog({
  state,
  parentId,
  initialMode,
  onAdopt,
  onClose,
}: {
  state: Workspace;
  parentId: string | null;
  initialMode?: DraftMode;
  onAdopt(mode: DraftMode, options: DraftOptions): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState<DraftMode>(
    initialMode ??
      (state.project.demo?.scenario === 'content-project' ? 'content-project' : 'type'),
  );
  const [staleDays, setStaleDays] = useState(180);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  // One clock for the preview and the adoption, so they always agree.
  const now = useRef(Date.now());
  // The saved rules live in the app data directory. The list here is the source of truth
  // while the dialog is open; replies from the main process only report errors.
  const [rules, setRules] = useState<OrganizeRule[]>([]);
  const [rulesReady, setRulesReady] = useState(false);
  const [rulesNotice, setRulesNotice] = useState('');
  const [rulesError, setRulesError] = useState('');
  const saves = useRef(0);
  const rulesRequested = useRef(false);
  // Read once, the first time "我的规则" is chosen: users who never write rules never
  // touch the file.
  useEffect(() => {
    if (mode !== 'custom' || rulesRequested.current) return;
    rulesRequested.current = true;
    window.fileCanvas.loadRules().then((result) => {
      if (result.ok && result.data) {
        setRules(result.data.rules);
        setRulesNotice(result.data.notice ?? '');
      } else setRulesError(`没能读取已保存的规则：${result.error ?? '未知错误'}`);
      setRulesReady(true);
    });
  }, [mode]);
  async function changeRules(next: OrganizeRule[]) {
    setRules(next);
    const version = ++saves.current;
    const result = await window.fileCanvas.saveRules(next);
    // Only the latest save may speak, so a slow older reply can not overwrite its error.
    if (version === saves.current)
      setRulesError(result.ok ? '' : `规则没能保存：${result.error ?? '未知错误'}。本次仍可使用。`);
  }
  const options: DraftOptions = { now: now.current, staleDays, excluded, rules };
  const draft = useMemo(
    () =>
      buildClassificationDraft(state, parentId, mode, {
        now: now.current,
        staleDays,
        excluded,
        rules,
      }),
    [state, parentId, mode, staleDays, excluded, rules],
  );
  const loose = useMemo(
    () => children(state.project.nodes, parentId).filter((n) => n.kind === 'file').length,
    [state, parentId],
  );
  const matched = draft.groups.reduce((sum, group) => sum + group.rows.length, 0);
  function choose(next: DraftMode) {
    // Re-clicking the active recipe must not throw away the user's switches.
    if (next === mode) return;
    setMode(next);
    setExcluded([]);
    setOpen([]);
  }
  function toggle(list: string[], set: (value: string[]) => void, folder: string) {
    set(list.includes(folder) ? list.filter((f) => f !== folder) : [...list, folder]);
  }
  return (
    <Modal
      title="先生成一份分类草案"
      subtitle="只规划当前层的文件，现有子文件夹保持原样。规则依据文件名、扩展名和修改时间，不读取内容，也不是 AI 判断。"
      wide
      onClose={onClose}
    >
      <div className="draft-body">
        <div className="draft-presets">
          {ORDER.map((id) => {
            const Icon = ICONS[id];
            return (
              <button
                key={id}
                className={mode === id ? 'preset active' : 'preset'}
                aria-pressed={mode === id}
                onClick={() => choose(id)}
              >
                <Icon size={20} />
                <span>
                  <strong>{INFO[id].title}</strong>
                  <small>
                    {id === 'stale'
                      ? `把超过 ${staleDays} 天没改过的文件收进“久未修改”，近期文件留在原处`
                      : INFO[id].description}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        {mode === 'stale' && (
          <div className="draft-options">
            <label>
              多久没修改算“久未修改”
              <select
                aria-label="久未修改天数"
                value={staleDays}
                onChange={(e) => setStaleDays(Number(e.target.value))}
              >
                {STALE_CHOICES.map((days) => (
                  <option key={days} value={days}>
                    超过 {days} 天
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {mode === 'custom' && (
          <RulesEditor
            rules={rules}
            nodes={state.project.nodes}
            parentId={parentId}
            now={now.current}
            ready={rulesReady}
            notice={rulesNotice}
            error={rulesError}
            onChange={changeRules}
          />
        )}
        <div className="draft-summary">
          <span>{draft.rows.length} 个文件</span>
          <span>{draft.folders.length} 个目标文件夹（同名目录会复用）</span>
          {mode === 'custom' && <span>{loose - matched} 个文件不符合任何规则，保持原位</span>}
          <span>
            <ShieldCheck size={13} />
            采用后仍然只在画布内变化
          </span>
        </div>
        <div className={mode === 'custom' ? 'draft-rows flow' : 'draft-rows'}>
          {!draft.groups.length && (
            <p className="quiet-empty">
              {mode === 'stale'
                ? `当前层没有超过 ${staleDays} 天未修改的文件。`
                : mode === 'custom'
                  ? rules.length
                    ? '当前层没有文件符合这些规则。'
                    : '添加规则后，这里会按目标文件夹分组显示将要整理的文件。'
                  : '当前层没有可分类的文件。请先加入文件或进入有文件的虚拟文件夹。'}
            </p>
          )}
          {draft.groups.map((group) => {
            const on = !excluded.includes(group.folder);
            const expanded = open.includes(group.folder);
            return (
              <div className={`draft-group ${on ? '' : 'off'}`} key={group.folder}>
                <div className="draft-group-head">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`整理到 ${group.folder}`}
                    className="switch"
                    onClick={() => toggle(excluded, setExcluded, group.folder)}
                  />
                  <button
                    type="button"
                    className="draft-group-title"
                    aria-expanded={expanded}
                    onClick={() => toggle(open, setOpen, group.folder)}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <strong>{group.folder}</strong>
                    <span>{group.rows.length} 个文件</span>
                    <em>{group.existing ? '放入已有文件夹' : '新建文件夹'}</em>
                  </button>
                  <small>
                    {on
                      ? expanded
                        ? group.rows[0].reason
                        : group.rows
                            .slice(0, 3)
                            .map((r) => r.name)
                            .join('、') + (group.rows.length > 3 ? ' 等' : '')
                      : '已关闭：这些文件保持原位'}
                  </small>
                </div>
                {expanded && (
                  <div className="draft-group-rows">
                    {group.rows.map((row) => (
                      <div className="draft-row" key={row.id}>
                        <strong>{row.name}</strong>
                        <small>{row.reason}</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {draft.issues.map((issue) => (
            <p className="inline-error" role="alert" key={issue}>
              <AlertTriangle size={14} /> {issue}
            </p>
          ))}
        </div>
      </div>
      <footer className="modal-footer">
        <span>可一次撤销整份草案。采用后请用“预览变更”检查硬盘冲突。</span>
        <button
          className="button primary"
          disabled={!draft.rows.length || !draft.next}
          onClick={() => onAdopt(mode, options)}
        >
          采用草案到画布
        </button>
      </footer>
    </Modal>
  );
}
