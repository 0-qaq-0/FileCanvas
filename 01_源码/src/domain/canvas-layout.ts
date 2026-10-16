import type { NodeMap } from './types';
import { children, isDescendant } from './workspace';
export const CARD_WIDTH = 136;
export const CARD_HEIGHT = 138;
export interface CanvasRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  expanded: boolean;
}
export function expandedLayout(
  nodes: NodeMap,
  parentId: string | null,
  expanded: Set<string>,
  available: number,
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
    let width = Math.max(172, Math.min(352, maxWidth));
    let x = 14,
      y = 52,
      rowHeight = 0;
    const items: CanvasRect[] = [];
    for (const child of ordered(id)) {
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
  const roots = ordered(parentId);
  if (!roots.some((n) => n.kind === 'folder' && expanded.has(n.id)))
    return roots.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      depth: 0,
      expanded: false,
    }));
  const result: CanvasRect[] = [];
  let x = 24,
    y = 32,
    rowHeight = 0;
  for (const n of roots) {
    const box = measure(
      n.id,
      Math.max(172, available >= 560 ? Math.floor((available - 68) / 2) : available - 48),
      0,
    );
    if (x > 24 && x + box.width > available - 24) {
      x = 24;
      y += rowHeight + 24;
      rowHeight = 0;
    }
    result.push(...box.items.map((r) => ({ ...r, x: r.x + x, y: r.y + y })));
    x += box.width + 20;
    rowHeight = Math.max(rowHeight, box.height);
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
      .sort((a, b) => b.depth - a.depth)[0]?.id ?? null
  );
}
