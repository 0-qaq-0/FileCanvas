import { describe, expect, it } from 'vitest';
import {
  addFolder,
  commit,
  importEntries,
  moveNodes,
  redo,
  relativeTarget,
  renameNode,
  undo,
  validateName,
  validateNodes,
  workspace,
} from '../../01_源码/src/domain/workspace';
import { createProject } from '../../01_源码/electron/filesystem';
import type { ImportEntry } from '../../01_源码/src/domain/types';

function setup() {
  return workspace(createProject('C:\\FileCanvasTests'));
}
function item(
  id: string,
  name = 'A.jpg',
  kind: 'file' | 'folder' = 'file',
  parentSourceId: string | null = null,
): ImportEntry {
  return {
    entry: { id, name, kind, path: `C:\\FileCanvasTests\\${name}`, size: 12, mtimeMs: 1 },
    parentSourceId,
  };
}
describe('virtual workspace', () => {
  it('keeps a large flat import inside the supported coordinate range', () => {
    const entries = Array.from({ length: 1605 }, (_, i) => item(`file-${i}`, `文件-${i}.txt`));
    const state = importEntries(setup(), entries, null);
    expect(Object.keys(state.project.nodes)).toHaveLength(1605);
    expect(Math.max(...Object.values(state.project.nodes).map((n) => n.y))).toBeLessThan(50000);
  });
  it('imports one stable object, ignores duplicate drag and does not mutate the old snapshot', () => {
    const original = setup();
    const imported = importEntries(original, [item('a')], null);
    expect(Object.keys(original.project.nodes)).toHaveLength(0);
    expect(Object.keys(imported.project.nodes)).toHaveLength(1);
    const repeated = importEntries(imported, [item('a')], null);
    expect(repeated).toBe(imported);
    expect(imported.project.nodes.a.x).toBeGreaterThanOrEqual(0);
  });
  it('preserves nested source folder imports, then rejects conflicting names atomically', () => {
    const state = importEntries(
      setup(),
      [item('folder', '目录', 'folder'), item('a', 'A.jpg', 'file', 'folder')],
      null,
    );
    expect(state.project.nodes.a.parentId).toBe('folder');
    expect(() => importEntries(state, [item('b', 'a.JPG', 'file', 'folder')], null)).toThrow(
      '已存在',
    );
    expect(Object.keys(state.project.nodes)).toHaveLength(2);
  });
  it('keeps source and target separate when moving A.jpg into 图片', () => {
    let state = importEntries(setup(), [item('a')], null);
    state = addFolder(state, '图片', null);
    const folder = Object.values(state.project.nodes).find((n) => n.name === '图片')!;
    state = moveNodes(state, ['a'], folder.id);
    expect(relativeTarget(state.project.nodes, 'a')).toEqual(['图片', 'A.jpg']);
    expect(state.project.nodes.a.source!.path).toBe('C:\\FileCanvasTests\\A.jpg');
  });
  it('supports layout, create, rename and move undo/redo without mixing source paths', () => {
    let state = importEntries(setup(), [item('a')], null);
    state = commit(state, 'layout', (nodes) => {
      nodes.a.x = 234;
      nodes.a.y = 345;
    });
    expect(undo(state).project.nodes.a.x).not.toBe(234);
    expect(redo(undo(state)).project.nodes.a.x).toBe(234);
    state = renameNode(state, 'a', '新名称.jpg');
    expect(undo(state).project.nodes.a.name).toBe('A.jpg');
    expect(redo(undo(state)).project.nodes.a.name).toBe('新名称.jpg');
    const created = addFolder(state, '图片', null);
    expect(Object.keys(undo(created).project.nodes)).toHaveLength(1);
    expect(Object.keys(redo(undo(created)).project.nodes)).toHaveLength(2);
  });
  it('rejects moving a folder into itself or a descendant and validates corrupt cycles', () => {
    let state = addFolder(setup(), '父', null);
    const parent = Object.keys(state.project.nodes)[0];
    state = addFolder(state, '子', parent);
    const child = Object.keys(state.project.nodes).find((id) => id !== parent)!;
    expect(() => moveNodes(state, [parent], parent)).toThrow('自己');
    expect(() => moveNodes(state, [parent], child)).toThrow('自己');
    expect(() =>
      validateNodes({
        ...state.project.nodes,
        [parent]: { ...state.project.nodes[parent], parentId: child },
      }),
    ).toThrow('自己');
  });
  it('moves parent+child selection only once and clears redo after a new operation', () => {
    let state = importEntries(
      setup(),
      [item('f', '目录', 'folder'), item('a', 'A.jpg', 'file', 'f')],
      null,
    );
    state = addFolder(state, '目标', null);
    const target = Object.values(state.project.nodes).find((n) => n.name === '目标')!;
    const moved = moveNodes(state, ['f', 'a'], target.id);
    expect(moved.project.nodes.a.parentId).toBe('f');
    expect(moved.project.nodes.f.parentId).toBe(target.id);
    expect(renameNode(undo(moved), 'a', 'B.jpg').future).toHaveLength(0);
  });
  it.each([
    '../escape',
    'A/B',
    'A\\B',
    'C:secret',
    'CON',
    'nul.txt',
    'LPT1.doc',
    'COM¹.txt',
    'trailing.',
    'trailing ',
    '',
    '..',
    'a\u0000b',
  ])('rejects illegal Windows name %j', (name) => {
    expect(() => validateName(name)).toThrow();
  });
  it('rejects bad coordinates, orphan parents and duplicate source objects', () => {
    const state = importEntries(setup(), [item('a')], null);
    expect(() =>
      commit(state, 'invalid', (nodes) => {
        nodes.a.x = NaN;
      }),
    ).toThrow('坐标');
    expect(() => moveNodes(state, ['a'], 'missing')).toThrow('不存在');
    expect(() =>
      importEntries(
        state,
        [{ ...item('b', 'Other.jpg'), entry: { ...item('b').entry, name: 'Other.jpg' } }],
        null,
      ),
    ).toThrow('重复');
  });
});
