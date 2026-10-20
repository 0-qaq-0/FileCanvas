import type { NodeMap, Workspace } from './types';
import { commit, topLevelSelection, validateName } from './workspace';

export interface RenameOptions {
  find: string;
  replace: string;
  // Placeholders: {name} original name without extension, {n} running number,
  // {date} last-modified date, {parent} name of the folder it sits in.
  template: string;
  start: number;
  pad: number;
  now?: number;
}
export interface RenameRow {
  id: string;
  from: string;
  to: string;
  changed: boolean;
  error?: string;
}
export const DEFAULT_TEMPLATE = '{name}';
const TOKEN = /\{(name|n|date|parent)\}/g;

// The extension is always kept; folders have none.
export function splitName(name: string, kind: 'file' | 'folder'): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return kind === 'file' && dot > 0
    ? { base: name.slice(0, dot), ext: name.slice(dot) }
    : { base: name, ext: '' };
}
function dateOf(ms: number): string {
  const d = new Date(ms);
  const two = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
// Numbering follows the name order, so the result does not depend on how the
// selection was made.
export function planBatchRename(
  nodes: NodeMap,
  ids: string[],
  options: RenameOptions,
): RenameRow[] {
  const picked = topLevelSelection(nodes, ids)
    .map((id) => nodes[id])
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const template = options.template || DEFAULT_TEMPLATE;
  const leftover = template.replace(TOKEN, '').match(/\{[^}]*\}?/);
  const rows: RenameRow[] = picked.map((node, index) => {
    const { base, ext } = splitName(node.name, node.kind);
    let error: string | undefined = leftover
      ? `模板里有无法识别的占位符 ${leftover[0]}，可用：{name} {n} {date} {parent}`
      : undefined;
    const searched = options.find ? base.split(options.find).join(options.replace) : base;
    const number = String(options.start + index).padStart(Math.max(0, options.pad), '0');
    const parent = node.parentId ? (nodes[node.parentId]?.name ?? '') : '';
    const mtime = node.source?.mtimeMs || options.now || Date.now();
    const to =
      template.replace(TOKEN, (_, token: string) =>
        token === 'name'
          ? searched
          : token === 'n'
            ? number
            : token === 'date'
              ? dateOf(mtime)
              : parent,
      ) + ext;
    if (!error)
      try {
        validateName(to);
      } catch (e) {
        error = (e as Error).message;
      }
    return { id: node.id, from: node.name, to, changed: to !== node.name, error };
  });
  // A final name must be unique among its siblings, counting those not being renamed.
  const finalName = new Map(rows.map((row) => [row.id, row.to]));
  const taken = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    const key = `${node.parentId ?? ''}\0${(finalName.get(node.id) ?? node.name).toLowerCase()}`;
    taken.set(key, [...(taken.get(key) ?? []), node.id]);
  }
  for (const row of rows) {
    if (row.error) continue;
    const key = `${nodes[row.id].parentId ?? ''}\0${row.to.toLowerCase()}`;
    if ((taken.get(key) ?? []).length > 1) row.error = `同一文件夹里已有同名条目“${row.to}”`;
  }
  return rows;
}
export function applyBatchRename(state: Workspace, rows: RenameRow[]): Workspace {
  const changes = rows.filter((row) => row.changed);
  if (rows.some((row) => row.error)) throw new Error('有名称不合法或重名，请先修改规则。');
  if (!changes.length) throw new Error('没有需要改名的条目。');
  return commit(state, '批量重命名', (nodes) => {
    for (const row of changes) nodes[row.id].name = row.to;
  });
}
