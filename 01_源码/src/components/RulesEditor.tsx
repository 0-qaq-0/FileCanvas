import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  MAX_RULES,
  RULE_EXAMPLE,
  countMatches,
  describeMatch,
  normalizeRule,
  parseExtensions,
  parseKeywords,
  ruleHits,
  ruleNameTaken,
  ruleProblem,
} from '../domain/rules';
import type { NodeMap, OrganizeRule } from '../domain/types';

interface Form {
  // null while writing a new rule.
  id: string | null;
  name: string;
  keywords: string;
  extensions: string;
  days: string;
  size: string;
  folder: string;
}
const blank = (): Form => ({
  id: null,
  name: '',
  keywords: '',
  extensions: '',
  days: '',
  size: '',
  folder: '',
});
const fromRule = (rule: OrganizeRule): Form => ({
  id: rule.id,
  name: rule.name,
  keywords: (rule.match.keywords ?? []).join('，'),
  extensions: (rule.match.extensions ?? []).join(' '),
  days: rule.match.olderThanDays === undefined ? '' : String(rule.match.olderThanDays),
  size: rule.match.minSizeMB === undefined ? '' : String(rule.match.minSizeMB),
  folder: rule.folder,
});
// What the form currently says, in the shape normalizeRule validates.
function toRaw(form: Form, id: string) {
  const days = form.days.trim();
  const size = form.size.trim();
  return {
    id,
    name: form.name,
    folder: form.folder,
    match: {
      keywords: parseKeywords(form.keywords),
      extensions: parseExtensions(form.extensions),
      ...(days ? { olderThanDays: Number(days) } : {}),
      ...(size ? { minSizeMB: Number(size) } : {}),
    },
  };
}

export function RulesEditor({
  rules,
  nodes,
  parentId,
  now,
  ready,
  notice,
  error,
  onChange,
}: {
  rules: OrganizeRule[];
  nodes: NodeMap;
  parentId: string | null;
  now: number;
  ready: boolean;
  notice?: string;
  error?: string;
  onChange(next: OrganizeRule[]): void;
}) {
  const [editing, setEditing] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const hits = useMemo(
    () => ruleHits(nodes, parentId, rules, { now }),
    [nodes, parentId, rules, now],
  );
  // The form closing removes the element that had focus; hand focus back to the editor
  // so Esc and Tab keep working inside the dialog.
  useEffect(() => {
    if (wasEditing.current && !editing) addButton.current?.focus();
    wasEditing.current = !!editing;
  }, [editing]);

  const raw = editing ? toRaw(editing, editing.id ?? 'new-rule') : null;
  const problem = !raw
    ? null
    : (ruleProblem(raw) ??
      (ruleNameTaken(rules, editing!.name, editing!.id ?? undefined)
        ? '已有同名规则，请换一个名称。'
        : null));
  const own = raw && !problem ? countMatches(nodes, parentId, normalizeRule(raw), { now }) : null;

  function open(form: Form) {
    setEditing(form);
    setDirty(false);
    setConfirming(null);
  }
  function submit() {
    if (!editing || problem) return;
    const rule = normalizeRule(toRaw(editing, editing.id ?? crypto.randomUUID()));
    onChange(editing.id ? rules.map((r) => (r.id === editing.id ? rule : r)) : [...rules, rule]);
    setEditing(null);
  }
  function move(index: number, by: -1 | 1) {
    const next = [...rules];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
    const id = rules[index].id;
    const wanted = by < 0 ? 'up' : 'down';
    // The moved row is a different DOM position now; keep the keyboard on it.
    requestAnimationFrame(() => {
      const target = (action: string) =>
        root.current?.querySelector<HTMLButtonElement>(`[data-act="${action}-${id}"]`);
      const first = target(wanted);
      (first && !first.disabled ? first : target(wanted === 'up' ? 'down' : 'up'))?.focus();
    });
  }
  function remove(id: string) {
    onChange(rules.filter((r) => r.id !== id));
    setConfirming(null);
    addButton.current?.focus();
  }
  const set = (patch: Partial<Form>) => {
    setEditing({ ...editing!, ...patch });
    setDirty(true);
  };
  const form = editing && (
    <form
      className="rule-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        // Esc closes this form only, not the whole dialog with the half-written rule.
        if (event.key === 'Escape') {
          event.stopPropagation();
          setEditing(null);
        }
      }}
    >
      <label>
        规则名称
        <input
          aria-label="规则名称"
          autoFocus
          maxLength={60}
          value={editing.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label>
        目标文件夹
        <input
          aria-label="目标文件夹"
          placeholder="财务/发票（/ 表示多层）"
          value={editing.folder}
          onChange={(e) => set({ folder: e.target.value })}
        />
      </label>
      <label>
        名称包含
        <input
          aria-label="名称包含的关键词"
          placeholder="发票，报销（逗号分开，含任一个即可）"
          value={editing.keywords}
          onChange={(e) => set({ keywords: e.target.value })}
        />
      </label>
      <label>
        或扩展名是
        <input
          aria-label="文件扩展名"
          placeholder="pdf docx（空格或逗号分开）"
          value={editing.extensions}
          onChange={(e) => set({ extensions: e.target.value })}
        />
      </label>
      <label>
        且已有多少天没改过
        <input
          type="number"
          min={1}
          step={1}
          aria-label="至少多少天没改过"
          placeholder="不限"
          value={editing.days}
          onChange={(e) => set({ days: e.target.value })}
        />
      </label>
      <label>
        且大小不小于（MB）
        <input
          type="number"
          min={0}
          step="any"
          aria-label="大小不小于多少 MB"
          placeholder="不限"
          value={editing.size}
          onChange={(e) => set({ size: e.target.value })}
        />
      </label>
      <div className="rule-form-foot">
        <p className={`rule-hint ${dirty && problem ? 'bad' : ''}`}>
          {dirty && problem
            ? problem
            : own !== null
              ? `按这些条件，当前层会有 ${own} 个文件符合（不计前面规则抢先的）。`
              : `${RULE_EXAMPLE}。名称和扩展名满足其一即可；写了天数或大小，则还须同时满足。`}
        </p>
        <div className="rule-form-actions">
          <button type="button" className="button small" onClick={() => setEditing(null)}>
            取消编辑
          </button>
          <button type="submit" className="button small primary" disabled={!!problem}>
            保存规则
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div className="rules-editor" ref={root}>
      <div className="rules-head">
        <strong>规则列表</strong>
        <small>从上到下依次判断，文件归入第一条符合的规则；都不符合就保持原位。</small>
      </div>
      {notice && <p className="rule-hint">{notice}</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!ready && <p className="quiet-empty">正在读取已保存的规则…</p>}
      {ready && !rules.length && !editing && (
        <p className="quiet-empty">
          还没有规则。点“添加规则”写第一条，写好后会保存在本机，换个文件夹也能直接用。
        </p>
      )}
      <ol className="rule-list">
        {rules.map((rule, index) => {
          if (editing?.id === rule.id) return <li key={rule.id}>{form}</li>;
          const hit = hits[index];
          return (
            <li className="rule-row" key={rule.id}>
              <span className="rule-index">{index + 1}</span>
              <div className="rule-main">
                <strong>{rule.name}</strong>
                <span>{describeMatch(rule.match)}</span>
                <em>
                  <ArrowRight size={11} />
                  {rule.folder}
                </em>
              </div>
              <div className="rule-count">
                <b>命中 {hit.caught} 个</b>
                {hit.shadowed > 0 && <small>另有 {hit.shadowed} 个已被前面的规则归类</small>}
              </div>
              {confirming === rule.id ? (
                <div className="rule-actions confirm">
                  <button
                    type="button"
                    className="button small danger"
                    onClick={() => remove(rule.id)}
                  >
                    确认删除“{rule.name}”
                  </button>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => setConfirming(null)}
                  >
                    保留
                  </button>
                </div>
              ) : (
                <div className="rule-actions">
                  <button
                    type="button"
                    className="icon-button"
                    data-act={`up-${rule.id}`}
                    aria-label={`上移“${rule.name}”`}
                    title="上移（优先级更高）"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-act={`down-${rule.id}`}
                    aria-label={`下移“${rule.name}”`}
                    title="下移（优先级更低）"
                    disabled={index === rules.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`编辑“${rule.name}”`}
                    title="编辑"
                    onClick={() => open(fromRule(rule))}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`删除“${rule.name}”`}
                    title="删除"
                    onClick={() => {
                      setEditing(null);
                      setConfirming(rule.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {editing && editing.id === null ? (
        form
      ) : (
        <button
          type="button"
          ref={addButton}
          className="button small rule-add"
          disabled={!ready || rules.length >= MAX_RULES}
          onClick={() => open(blank())}
        >
          <Plus size={14} />
          添加规则
        </button>
      )}
    </div>
  );
}
