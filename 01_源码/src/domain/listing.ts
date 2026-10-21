import type { CanvasNode, NodeMap } from './types';
import type { GroupBy, SortDir, SortKey } from './preferences';
import { children, relativeTarget } from './workspace';
import { extensionOf, monthOf, typeOf } from './recipes';

// Pure helpers behind the tile, group and list views: what the plan says about a node, how
// a level is ordered and grouped, and which rows the list shows when folders are open.
// Nothing here reads or changes the plan.

/** '' when the node still matches the disk; otherwise the badge text shown on it. */
export function pendingLabel(nodes: NodeMap, rootPath: string, node: CanvasNode): string {
  if (!node.source) return '待新建';
  const target = `${rootPath.replace(/[\\/]+$/, '')}\\${relativeTarget(nodes, node.id).join('\\')}`;
  if (target === node.source.path) return '';
  return node.name !== node.source.name ? '待改名 / 移动' : '待移动';
}

export function typeLabel(node: CanvasNode): string {
  if (node.kind === 'folder') return '文件夹';
  const ext = extensionOf(node.name);
  return ext ? ext.toUpperCase() : '文件';
}

// Natural order (file2 before file10) in the system language, like the canvas layout.
const collate = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const byName = (a: CanvasNode, b: CanvasNode) =>
  collate(a.name, b.name) || a.id.localeCompare(b.id);

/** Folders first, then by the chosen key; names break ties so the order is stable. */
export function sortNodes(items: CanvasNode[], key: SortKey, dir: SortDir): CanvasNode[] {
  const sign = dir === 'desc' ? -1 : 1;
  const value = (n: CanvasNode): number | string =>
    key === 'size'
      ? (n.source?.size ?? 0)
      : key === 'modified'
        ? (n.source?.mtimeMs ?? 0)
        : key === 'type'
          ? typeLabel(n)
          : n.name;
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const x = value(a),
      y = value(b);
    const order =
      typeof x === 'number' && typeof y === 'number' ? x - y : collate(String(x), String(y));
    return order * sign || byName(a, b);
  });
}

export interface Section {
  key: string;
  label: string;
  items: CanvasNode[];
}

const FOLDERS = '文件夹';
const OTHER = '其他';
const UNKNOWN_TIME = '未知时间';
const CHANGED = '待处理的变化';
const UNCHANGED = '未改动';

/** Splits an already ordered level into sections; the order inside each section is kept. */
export function groupNodes(
  nodes: NodeMap,
  rootPath: string,
  items: CanvasNode[],
  by: GroupBy,
): Section[] {
  const buckets = new Map<string, CanvasNode[]>();
  for (const node of items) {
    const label =
      by === 'type'
        ? node.kind === 'folder'
          ? FOLDERS
          : (typeOf(node.name) ?? OTHER)
        : by === 'month'
          ? node.source?.mtimeMs
            ? monthOf(node.source.mtimeMs)
            : UNKNOWN_TIME
          : pendingLabel(nodes, rootPath, node)
            ? CHANGED
            : UNCHANGED;
    buckets.set(label, [...(buckets.get(label) ?? []), node]);
  }
  const sections = [...buckets].map(([label, group]) => ({
    key: `${by}:${label}`,
    label,
    items: group,
  }));
  const rank = (s: Section) =>
    by === 'status'
      ? s.label === CHANGED
        ? 0
        : 1
      : s.label === FOLDERS
        ? 0
        : s.label === OTHER || s.label === UNKNOWN_TIME
          ? 2
          : 1;
  return sections.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    // Newest month first; kinds of file by how many there are.
    if (by === 'month') return b.label.localeCompare(a.label);
    if (by === 'type') return b.items.length - a.items.length || collate(a.label, b.label);
    return 0;
  });
}

export interface Row {
  node: CanvasNode;
  depth: number;
  expanded: boolean;
}

/** The rows of the list view: one level, with the folders the user opened expanded in place. */
export function listRows(
  nodes: NodeMap,
  parentId: string | null,
  open: Set<string>,
  key: SortKey,
  dir: SortDir,
): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const node of sortNodes(children(nodes, parent), key, dir)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const expanded = node.kind === 'folder' && open.has(node.id);
      rows.push({ node, depth, expanded });
      if (expanded) walk(node.id, depth + 1);
    }
  };
  walk(parentId, 0);
  return rows;
}

const two = (n: number) => String(n).padStart(2, '0');
export function formatModified(mtimeMs: number | undefined): string {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return '—';
  const d = new Date(mtimeMs);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
