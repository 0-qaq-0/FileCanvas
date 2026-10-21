import { describe, it, expect } from 'vitest';
import {
  arrangeItems,
  dropGrid,
  expandedLayout,
  folderAt,
  snapPositions,
  type ArrangeItem,
} from '../../01_源码/src/domain/canvas-layout';
import { moveNodes, workspace } from '../../01_源码/src/domain/workspace';
import type { CanvasNode, NodeMap, Project } from '../../01_源码/src/domain/types';

function node(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
  kind = 'file',
): CanvasNode {
  return {
    id,
    name: kind === 'folder' ? id : `${id}.txt`,
    kind: kind as 'file' | 'folder',
    parentId,
    x,
    y,
    source:
      kind === 'folder'
        ? null
        : { id, path: `C:/r/${id}.txt`, name: `${id}.txt`, kind: 'file', size: 1, mtimeMs: 1 },
  } as CanvasNode;
}
const project = (nodes: NodeMap): Project =>
  ({ version: 1, id: 'p', name: 'p', rootPath: 'C:/r', nodes }) as unknown as Project;
const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('free placement', () => {
  it('keeps loose cards and an expanded folder at their own coordinates', () => {
    const nodes: NodeMap = {
      f: node('f', null, 700, 300, 'folder'),
      a: node('a', null, 40, 50),
      inner: node('inner', 'f', 0, 0),
    };
    const layout = expandedLayout(nodes, null, new Set(['f']));
    expect(layout.find((r) => r.id === 'a')).toMatchObject({ x: 40, y: 50 });
    expect(layout.find((r) => r.id === 'f')).toMatchObject({ x: 700, y: 300, expanded: true });
    expect(layout.find((r) => r.id === 'inner')!.x).toBeGreaterThan(700);
  });
  it('pushes one open container below another it would cover, without moving the data', () => {
    const nodes: NodeMap = {
      f1: node('f1', null, 100, 100, 'folder'),
      f2: node('f2', null, 120, 120, 'folder'),
    };
    const layout = expandedLayout(nodes, null, new Set(['f1', 'f2']));
    const [a, b] = ['f1', 'f2'].map((id) => layout.find((r) => r.id === id)!);
    expect(overlap(a, b)).toBe(false);
    expect(nodes.f2.y).toBe(120);
  });
  it('prefers the open container over a folder card at the same depth', () => {
    const nodes: NodeMap = {
      f: node('f', null, 0, 0, 'folder'),
      g: node('g', null, 20, 20, 'folder'),
    };
    const layout = expandedLayout(nodes, null, new Set(['g']));
    expect(folderAt(nodes, layout, { x: 30, y: 30 }, [])).toBe('g');
  });
  it('places moved items exactly where they were released', () => {
    const nodes: NodeMap = {
      box: node('box', null, 0, 0, 'folder'),
      a: node('a', 'box', 32, 32),
      b: node('b', 'box', 188, 32),
    };
    const next = moveNodes(workspace(project(nodes)), ['a', 'b'], null, {
      a: { x: 500.4, y: 260 },
      b: { x: 99999, y: -5 },
    }).project.nodes;
    expect(next.a).toMatchObject({ parentId: null, x: 500, y: 260 });
    expect(next.b).toMatchObject({ parentId: null, x: 49000, y: 0 });
  });
  it('still picks a free slot when no position is given', () => {
    const nodes: NodeMap = {
      box: node('box', null, 0, 0, 'folder'),
      a: node('a', null, 500, 500),
    };
    const next = moveNodes(workspace(project(nodes)), ['a'], 'box').project.nodes;
    expect(next.a).toMatchObject({ parentId: 'box', x: 32, y: 32 });
  });
  it('snaps a group by its first item and keeps the pile shape', () => {
    const snapped = snapPositions({ a: { x: 200, y: 70 }, b: { x: 230, y: 90 } });
    expect(snapped.a).toEqual({ x: 188, y: 32 });
    expect(snapped.b.x - snapped.a.x).toBe(30);
    expect(snapped.b.y - snapped.a.y).toBe(20);
  });
  it('drops a group around the pointer in a compact block', () => {
    const grid = dropGrid(['a', 'b', 'c', 'd'], { x: 400, y: 300 });
    expect(grid.a).toEqual({ x: 332, y: 231 });
    expect(grid.d.x).toBe(grid.b.x);
    expect(grid.d.y).toBeGreaterThan(grid.a.y);
  });
});

describe('arranging', () => {
  const item = (id: string, name: string, x: number, y: number, w = 136, h = 138): ArrangeItem => ({
    id,
    name,
    x,
    y,
    width: w,
    height: h,
    folder: !name.includes('.'),
  });
  it('keeps the reading order and never overlaps, even with a wide open container', () => {
    const items = [
      item('c', 'c.txt', 900, 40),
      item('a', 'a.txt', 10, 30),
      item('wide', 'Box', 300, 35, 700, 400),
      item('d', 'd.txt', 20, 400),
    ];
    const out = arrangeItems(items, 'tidy', { x: 32, y: 32 }, 1000);
    expect(Object.keys(out)).toEqual(['a', 'wide', 'c', 'd']);
    const rects = items.map((i) => ({ ...i, ...out[i.id] }));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
  });
  it('groups folders first and gives every common file type its own row', () => {
    const items = [
      item('1', 'a.jpg', 0, 0),
      item('2', 'b.pdf', 0, 0),
      item('3', 'c.jpg', 0, 0),
      item('4', 'd.jpg', 0, 0),
      item('5', 'Docs', 0, 0),
      item('6', 'e.pdf', 0, 0),
    ];
    const out = arrangeItems(items, 'type', { x: 32, y: 32 }, 2000);
    expect(out['5'].y).toBe(32);
    expect(new Set(['1', '3', '4'].map((id) => out[id].y)).size).toBe(1);
    expect(out['1'].y).toBeGreaterThan(out['5'].y);
    // The two pdfs are below the 3-file jpg threshold, so they share the leftover row.
    expect(out['2'].y).toBe(out['6'].y);
    expect(out['2'].y).toBeGreaterThan(out['1'].y);
  });
  it('stays inside the coordinate limit for thousands of cards', () => {
    const many = Array.from({ length: 5000 }, (_, i) => item(`n${i}`, `f${i}.txt`, 0, 0));
    const out = arrangeItems(many, 'tidy', { x: 32, y: 32 }, 600);
    const max = Math.max(...Object.values(out).map((p) => Math.max(p.x, p.y)));
    expect(max).toBeLessThanOrEqual(49000);
  });
});
