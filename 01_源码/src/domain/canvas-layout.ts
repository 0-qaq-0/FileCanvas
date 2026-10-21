import type { NodeMap } from './types';
import { children, isDescendant } from './workspace';
export const CARD_WIDTH = 136;
export const CARD_HEIGHT = 138;
/** Distance between the left edges of two neighbouring cards in a tidy grid. */
export const GRID_STEP = 156;
export const COORD_MAX = 49000;
const COLUMN = CARD_WIDTH + 14;
export interface CanvasRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  expanded: boolean;
}
/** A container shows its files in a flow whose width follows how many files it holds. */
function containerWidth(count: number, maxWidth: number): number {
  const columns = Math.min(12, Math.max(2, Math.ceil(Math.sqrt(count * 1.5))));
  return Math.max(172, Math.min(maxWidth, 14 + columns * COLUMN));
}
/**
 * Loose cards and folder cards stay exactly where the user put them. An expanded folder grows
 * from its own corner into a container whose files flow inside (reordering only changes their
 * order there). Containers sit on top of loose cards; two containers that would cover each other
 * are pushed down for display only, so nothing the user placed is rewritten by expanding.
 */
export function expandedLayout(
  nodes: NodeMap,
  parentId: string | null,
  expanded: Set<string>,
): CanvasRect[] {
  const ordered = (id: string | null) =>
    children(nodes, id).sort((a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name));
  const measure = (
    id: string,
    maxWidth: number,
    depth: number,
  ): { width: number; height: number; items: CanvasRect[] } => {
    if (nodes[id].kind !== 'folder' || !expanded.has(id))
      return {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        items: [{ id, x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT, depth, expanded: false }],
      };
    const inside = ordered(id);
    let width = containerWidth(inside.length, maxWidth);
    let x = 14,
      y = 52,
      rowHeight = 0;
    const items: CanvasRect[] = [];
    for (const child of inside) {
      const box = measure(child.id, width - 28, depth + 1);
      if (x > 14 && x + box.width > width - 14) {
        x = 14;
        y += rowHeight + 14;
        rowHeight = 0;
      }
      items.push(...box.items.map((r) => ({ ...r, x: r.x + x, y: r.y + y })));
      x += box.width + 14;
      rowHeight = Math.max(rowHeight, box.height);
    }
    const height = Math.max(156, y + rowHeight + 26);
    width = Math.max(
      width,
      ...items.filter((r) => r.depth === depth + 1).map((r) => r.x + r.width + 14),
    );
    return {
      width,
      height,
      items: [{ id, x: 0, y: 0, width, height, depth, expanded: true }, ...items],
    };
  };
  const result: CanvasRect[] = [];
  const containers: { x: number; y: number; width: number; height: number }[] = [];
  for (const n of ordered(parentId)) {
    const box = measure(n.id, 14 + 12 * COLUMN, 0);
    let y = n.y;
    if (box.items[0].expanded) {
      for (;;) {
        const hit = containers.find(
          (c) =>
            n.x < c.x + c.width + 16 &&
            n.x + box.width + 16 > c.x &&
            y < c.y + c.height + 16 &&
            y + box.height + 16 > c.y,
        );
        if (!hit) break;
        y = hit.y + hit.height + 20;
      }
      containers.push({ x: n.x, y, width: box.width, height: box.height });
    }
    result.push(...box.items.map((r) => ({ ...r, x: r.x + n.x, y: r.y + y })));
  }
  return result;
}
export function folderAt(
  nodes: NodeMap,
  layout: CanvasRect[],
  point: { x: number; y: number },
  moving: string[],
): string | null {
  return (
    layout
      .filter(
        (r) =>
          nodes[r.id].kind === 'folder' &&
          !moving.some((id) => isDescendant(nodes, r.id, id)) &&
          point.x >= r.x &&
          point.x <= r.x + r.width &&
          point.y >= r.y &&
          point.y <= r.y + r.height,
      )
      // The innermost wins; at equal depth an open container is drawn above a folder card.
      .sort((a, b) => b.depth - a.depth || Number(b.expanded) - Number(a.expanded))[0]?.id ?? null
  );
}
export type Positions = Record<string, { x: number; y: number }>;
export function clampCoord(value: number): number {
  return Math.round(Math.max(0, Math.min(COORD_MAX, Number.isFinite(value) ? value : 0)));
}
/** Where `count` items go when they are dropped as a group with the pointer at `point`. */
export function dropGrid(ids: string[], point: { x: number; y: number }): Positions {
  const columns = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(ids.length))));
  return Object.fromEntries(
    ids.map((id, i) => [
      id,
      {
        x: clampCoord(point.x - CARD_WIDTH / 2 + (i % columns) * GRID_STEP),
        y: clampCoord(point.y - CARD_HEIGHT / 2 + Math.floor(i / columns) * GRID_STEP),
      },
    ]),
  );
}
/**
 * Snaps a dragged group onto the tidy grid by its first item and keeps the others at the same
 * distance from it, so a pile that is dragged stays a pile.
 */
export function snapPositions(positions: Positions): Positions {
  const entries = Object.entries(positions);
  if (!entries.length) return positions;
  const [, first] = entries[0];
  const snap = (v: number) => 32 + Math.round((v - 32) / GRID_STEP) * GRID_STEP;
  const dx = snap(first.x) - first.x,
    dy = snap(first.y) - first.y;
  return Object.fromEntries(
    entries.map(([id, p]) => [id, { x: clampCoord(p.x + dx), y: clampCoord(p.y + dy) }]),
  );
}
export type ArrangeMode = 'tidy' | 'type';
export interface ArrangeItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  folder: boolean;
}
function extension(item: ArrangeItem): string {
  const dot = item.name.lastIndexOf('.');
  return dot > 0 ? item.name.slice(dot + 1).toLowerCase() : '';
}
const byName = (a: ArrangeItem, b: ArrangeItem) =>
  a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
/** Groups of items that should start on their own row, in the order they are laid out. */
function arrangeGroups(items: ArrangeItem[], mode: ArrangeMode): ArrangeItem[][] {
  if (mode === 'tidy') {
    // Keep the reading order the user sees: top to bottom, left to right within a row.
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: ArrangeItem[][] = [];
    let start = -Infinity;
    for (const item of sorted) {
      if (!rows.length || item.y - start >= CARD_HEIGHT / 2) {
        rows.push([]);
        start = item.y;
      }
      rows.at(-1)!.push(item);
    }
    return [rows.flatMap((row) => row.sort((a, b) => a.x - b.x))];
  }
  const folders = items.filter((i) => i.folder).sort(byName);
  const byExt = new Map<string, ArrangeItem[]>();
  for (const item of items.filter((i) => !i.folder)) {
    const key = extension(item);
    byExt.set(key, [...(byExt.get(key) ?? []), item]);
  }
  const groups: ArrangeItem[][] = folders.length ? [folders] : [];
  const rest: ArrangeItem[] = [];
  for (const [, list] of [...byExt].sort(([a], [b]) => a.localeCompare(b)))
    if (list.length >= 3) groups.push(list.sort(byName));
    else rest.push(...list);
  if (rest.length)
    groups.push(rest.sort((a, b) => extension(a).localeCompare(extension(b)) || byName(a, b)));
  return groups;
}
/**
 * Packs the items into rows starting at `origin`, using each item's real size so open
 * containers never overlap their neighbours. `tidy` keeps the current reading order; `type`
 * puts folders first and gives every file type (three or more files) its own row(s).
 */
export function arrangeItems(
  items: ArrangeItem[],
  mode: ArrangeMode,
  origin: { x: number; y: number },
  wrapWidth: number,
): Positions {
  const gapX = GRID_STEP - CARD_WIDTH,
    gapY = GRID_STEP - CARD_HEIGHT;
  // Wide enough that even thousands of cards stay below the coordinate limit.
  const wrap = Math.max(wrapWidth, Math.ceil(items.length / 300) * GRID_STEP);
  const result: Positions = {};
  let x = 0,
    y = 0,
    rowHeight = 0;
  for (const group of arrangeGroups(items, mode)) {
    if (x > 0) {
      x = 0;
      y += rowHeight + gapY;
      rowHeight = 0;
    }
    for (const item of group) {
      if (x > 0 && x + item.width > wrap) {
        x = 0;
        y += rowHeight + gapY;
        rowHeight = 0;
      }
      result[item.id] = { x: clampCoord(origin.x + x), y: clampCoord(origin.y + y) };
      x += item.width + gapX;
      rowHeight = Math.max(rowHeight, item.height);
    }
  }
  return result;
}
