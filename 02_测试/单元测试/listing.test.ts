import { describe, expect, it } from 'vitest';
import { createProject } from '../../01_源码/electron/filesystem';
import {
  addFolder,
  children,
  importEntries,
  moveNodes,
  renameNode,
  workspace,
} from '../../01_源码/src/domain/workspace';
import {
  formatModified,
  groupNodes,
  listRows,
  pendingLabel,
  sortNodes,
  typeLabel,
} from '../../01_源码/src/domain/listing';
import type { CanvasNode, ImportEntry, Workspace } from '../../01_源码/src/domain/types';

const ROOT = 'C:\\demo';
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const files: [string, number, number][] = [
  ['b-报告.docx', 300, at(2026, 9, 3)],
  ['a-照片.jpg', 9000, at(2026, 10, 1)],
  ['c-预算.xlsx', 50, at(2026, 10, 15)],
  ['d-笔记.txt', 700, at(2026, 9, 20)],
  ['zz-无扩展名', 5, at(2026, 8, 1)],
];
function setup(): Workspace {
  const entries: ImportEntry[] = files.map(([name, size, mtimeMs], i) => ({
    entry: { id: `f${i}`, name, path: `${ROOT}\\${name}`, kind: 'file', size, mtimeMs },
    parentSourceId: null,
  }));
  return importEntries(workspace(createProject(ROOT)), entries, null);
}
const find = (state: Workspace, name: string): CanvasNode =>
  Object.values(state.project.nodes).find((n) => n.name === name)!;
const names = (list: { name: string }[]) => list.map((n) => n.name);
const rootLevel = (state: Workspace) => children(state.project.nodes, null);

describe('sorting a level', () => {
  const state = setup();
  const level = rootLevel(state);

  it('orders by name in either direction', () => {
    expect(names(sortNodes(level, 'name', 'asc'))).toEqual([
      'a-照片.jpg',
      'b-报告.docx',
      'c-预算.xlsx',
      'd-笔记.txt',
      'zz-无扩展名',
    ]);
    expect(names(sortNodes(level, 'name', 'desc'))[0]).toBe('zz-无扩展名');
  });
  it('keeps folders first whichever way a column is sorted', () => {
    const withFolder = rootLevel(addFolder(state, '资料', null));
    for (const key of ['name', 'type', 'size', 'modified'] as const)
      for (const dir of ['asc', 'desc'] as const)
        expect(sortNodes(withFolder, key, dir)[0].name).toBe('资料');
  });
  it('orders by size and by modified time', () => {
    expect(names(sortNodes(level, 'size', 'desc'))[0]).toBe('a-照片.jpg');
    expect(names(sortNodes(level, 'size', 'asc'))[0]).toBe('zz-无扩展名');
    expect(names(sortNodes(level, 'modified', 'desc'))[0]).toBe('c-预算.xlsx');
    expect(names(sortNodes(level, 'modified', 'asc'))[0]).toBe('zz-无扩展名');
  });
  it('orders by type with names as the tie-break, and never mutates its input', () => {
    const before = names(level);
    const sorted = sortNodes(level, 'type', 'asc');
    // "文件" (no extension) sorts before the upper-case extensions in a Chinese collation.
    expect(sorted.map(typeLabel)).toEqual(
      [...sorted.map(typeLabel)].sort((a, b) => a.localeCompare(b, 'zh')),
    );
    expect(names(level)).toEqual(before);
  });
  it('labels types from the extension', () => {
    expect(typeLabel(find(state, 'a-照片.jpg'))).toBe('JPG');
    expect(typeLabel(find(state, 'zz-无扩展名'))).toBe('文件');
    expect(typeLabel(find(addFolder(state, '资料', null), '资料'))).toBe('文件夹');
  });
});

describe('grouping a level', () => {
  const state = setup();
  const level = sortNodes(rootLevel(state), 'name', 'asc');

  it('groups by type with unknown types last, keeping the order inside a group', () => {
    const sections = groupNodes(state.project.nodes, ROOT, level, 'type');
    expect(sections.at(-1)!.label).toBe('其他');
    expect(sections.map((s) => s.label)).toEqual(expect.arrayContaining(['图片', '文档', '表格']));
    expect(sections.find((s) => s.label === '文档')!.items.map((n) => n.name)).toEqual([
      'b-报告.docx',
      'd-笔记.txt',
    ]);
    // Biggest group first.
    expect(sections[0].label).toBe('文档');
  });
  it('puts folders first when grouping by type', () => {
    const withFolder = addFolder(state, '资料', null);
    const items = sortNodes(rootLevel(withFolder), 'name', 'asc');
    expect(groupNodes(withFolder.project.nodes, ROOT, items, 'type')[0].label).toBe('文件夹');
  });
  it('groups by month, newest first', () => {
    const sections = groupNodes(state.project.nodes, ROOT, level, 'month');
    expect(sections.map((s) => s.label)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(sections[1].items.map((n) => n.name)).toEqual(['b-报告.docx', 'd-笔记.txt']);
  });
  it('groups by plan status once something is changed', () => {
    const untouched = groupNodes(state.project.nodes, ROOT, level, 'status');
    expect(untouched.map((g) => g.label)).toEqual(['未改动']);
    const fresh = setup();
    let s = renameNode(fresh, find(fresh, 'a-照片.jpg').id, '封面.jpg');
    s = addFolder(s, '资料', null);
    const groups = groupNodes(s.project.nodes, ROOT, rootLevel(s), 'status');
    expect(groups.map((g) => g.label)).toEqual(['待处理的变化', '未改动']);
    expect(names(groups[0].items).sort()).toEqual(['封面.jpg', '资料'].sort());
  });
});

describe('plan status of a node', () => {
  it('is empty for untouched files and names each kind of change', () => {
    let s = setup();
    const photo = find(s, 'a-照片.jpg');
    expect(pendingLabel(s.project.nodes, ROOT, photo)).toBe('');
    s = renameNode(s, photo.id, '封面.jpg');
    expect(pendingLabel(s.project.nodes, ROOT, s.project.nodes[photo.id])).toBe('待改名 / 移动');
    s = addFolder(s, '资料', null);
    const folder = find(s, '资料');
    expect(pendingLabel(s.project.nodes, ROOT, folder)).toBe('待新建');
    const report = find(s, 'b-报告.docx');
    s = moveNodes(s, [report.id], folder.id);
    expect(pendingLabel(s.project.nodes, ROOT, s.project.nodes[report.id])).toBe('待移动');
  });
});

describe('list rows', () => {
  function nested() {
    let s = addFolder(setup(), '资料', null);
    const folder = find(s, '资料');
    s = addFolder(s, '内层', folder.id);
    s = moveNodes(s, [find(s, 'd-笔记.txt').id], folder.id);
    return { s, folder };
  }
  it('lists one level while folders are closed', () => {
    const { s } = nested();
    expect(
      names(listRows(s.project.nodes, null, new Set(), 'name', 'asc').map((r) => r.node)),
    ).toEqual(['资料', 'a-照片.jpg', 'b-报告.docx', 'c-预算.xlsx', 'zz-无扩展名']);
  });
  it('shows opened folders in place, indented, in the chosen order', () => {
    const { s, folder } = nested();
    const rows = listRows(s.project.nodes, null, new Set([folder.id]), 'name', 'asc');
    expect(rows.map((r) => [r.node.name, r.depth])).toEqual([
      ['资料', 0],
      ['内层', 1],
      ['d-笔记.txt', 1],
      ['a-照片.jpg', 0],
      ['b-报告.docx', 0],
      ['c-预算.xlsx', 0],
      ['zz-无扩展名', 0],
    ]);
    expect(rows[0].expanded).toBe(true);
    expect(rows[1].expanded).toBe(false);
  });
  it('ignores an opened id that is not a folder', () => {
    const s = setup();
    const photo = find(s, 'a-照片.jpg');
    const rows = listRows(s.project.nodes, null, new Set([photo.id]), 'name', 'asc');
    expect(rows.every((r) => !r.expanded)).toBe(true);
  });
});

describe('modified time text', () => {
  it('formats local date and time, and dashes for a missing one', () => {
    expect(formatModified(new Date(2026, 9, 5, 8, 7).getTime())).toBe('2026-10-05 08:07');
    expect(formatModified(undefined)).toBe('—');
    expect(formatModified(NaN)).toBe('—');
  });
});
