import { describe, expect, it } from 'vitest';
import { createProject } from '../../01_源码/electron/filesystem';
import {
  addFolder,
  children,
  importEntries,
  moveNodes,
  moveToNewFolder,
  undo,
  workspace,
} from '../../01_源码/src/domain/workspace';
import { suggestFolderName } from '../../01_源码/src/domain/recipes';
import { filterLayer, matchesQuery, selectableMatches } from '../../01_源码/src/domain/filter';
import { applyBatchRename, planBatchRename } from '../../01_源码/src/domain/batch-rename';
import type { RenameOptions } from '../../01_源码/src/domain/batch-rename';
import type { ImportEntry, Workspace } from '../../01_源码/src/domain/types';

const MTIME = new Date(2026, 4, 6, 12).getTime();
function setup(names: string[], mtimeMs = MTIME): Workspace {
  const entries: ImportEntry[] = names.map((name, i) => ({
    entry: { id: `f${i}`, name, path: `C:\\demo\\${name}`, kind: 'file', size: 10, mtimeMs },
    parentSourceId: null,
  }));
  return importEntries(workspace(createProject('C:\\demo')), entries, null);
}
const byName = (state: Workspace, name: string) =>
  Object.values(state.project.nodes).find((n) => n.name === name)!;

describe('move to a new folder', () => {
  it('creates the folder and moves the selection in one undoable step', () => {
    const before = setup(['a.jpg', 'b.jpg', 'c.txt']);
    const after = moveToNewFolder(before, ['f0', 'f1'], '旅行', null, 'new-folder');
    const folder = after.project.nodes['new-folder'];
    expect(folder).toMatchObject({ name: '旅行', kind: 'folder', parentId: null, source: null });
    expect(after.project.nodes.f0.parentId).toBe('new-folder');
    expect(after.project.nodes.f1.parentId).toBe('new-folder');
    expect(after.project.nodes.f2.parentId).toBeNull();
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(undo(after).project.nodes).toEqual(before.project.nodes);
  });
  it('places the folder next to the selection, even inside another folder', () => {
    let state = addFolder(setup(['a.jpg', 'b.jpg', 'c.txt']), '资料', null);
    const parent = byName(state, '资料');
    state = moveNodes(state, ['f0', 'f1'], parent.id);
    const after = moveToNewFolder(state, ['f0', 'f1'], '子集', null, 'inner');
    expect(after.project.nodes.inner.parentId).toBe(parent.id);
    expect(children(after.project.nodes, parent.id).map((n) => n.name)).toEqual(['子集']);
  });
  it('falls back to the current level when the selection spans several folders', () => {
    let state = addFolder(setup(['a.jpg', 'b.jpg']), '资料', null);
    state = moveNodes(state, ['f0'], byName(state, '资料').id);
    const after = moveToNewFolder(state, ['f0', 'f1'], '汇总', null, 'merged');
    expect(after.project.nodes.merged.parentId).toBeNull();
    expect(after.project.nodes.f0.parentId).toBe('merged');
    expect(after.project.nodes.f1.parentId).toBe('merged');
  });
  it('moves a selected folder with its contents once, not twice', () => {
    let state = addFolder(setup(['a.jpg', 'b.jpg']), '资料', null);
    const folder = byName(state, '资料');
    state = moveNodes(state, ['f0'], folder.id);
    const after = moveToNewFolder(state, [folder.id, 'f0', 'f1'], '全部', null, 'all');
    expect(after.project.nodes[folder.id].parentId).toBe('all');
    expect(after.project.nodes.f0.parentId).toBe(folder.id);
    expect(after.project.nodes.f1.parentId).toBe('all');
  });
  it('rejects clashing, illegal and empty requests without changing anything', () => {
    const state = addFolder(setup(['a.jpg', 'b.jpg']), '资料', null);
    const frozen = structuredClone(state);
    expect(() => moveToNewFolder(state, ['f0'], '资料', null)).toThrow('已有');
    expect(() => moveToNewFolder(state, ['f0'], '图片', null)).not.toThrow();
    expect(() => moveToNewFolder(state, ['f0'], 'a/b', null)).toThrow('名称');
    expect(() => moveToNewFolder(state, ['f0'], '尾巴.', null)).toThrow('名称');
    expect(() => moveToNewFolder(state, [], '空', null)).toThrow('选择');
    expect(state).toEqual(frozen);
  });
  it('suggests a type name when everything selected is of one kind', () => {
    const state = setup(['a.jpg', 'b.PNG', 'c.txt']);
    const nodes = Object.values(state.project.nodes);
    expect(suggestFolderName(nodes.filter((n) => n.name !== 'c.txt'))).toBe('图片');
    expect(suggestFolderName(nodes)).toBe('新建文件夹');
  });
});

describe('filtering a canvas level', () => {
  function nested() {
    let state = addFolder(
      setup(['发票-三月.pdf', '发票-四月.pdf', '合同.docx', '旅行.jpg']),
      '财务',
      null,
    );
    const finance = byName(state, '财务');
    state = moveNodes(state, ['f0'], finance.id);
    state = addFolder(state, '归档', finance.id);
    state = moveNodes(state, ['f1'], byName(state, '归档').id);
    return { state, finance };
  }
  it('matches every word, ignoring case, and treats a blank query as no filter', () => {
    expect(matchesQuery('发票-三月.PDF', '发票 pdf')).toBe(true);
    expect(matchesQuery('发票-三月.pdf', '发票 合同')).toBe(false);
    expect(matchesQuery('anything', '   ')).toBe(false);
    const { state } = nested();
    expect(filterLayer(state.project.nodes, null, '')).toBeNull();
    expect(filterLayer(state.project.nodes, null, '  ')).toBeNull();
  });
  it('finds matches at any depth and counts them per enclosing folder', () => {
    const { state, finance } = nested();
    const result = filterLayer(state.project.nodes, null, '发票')!;
    expect([...result.matches].sort()).toEqual(['f0', 'f1']);
    expect(result.inside.get(finance.id)).toBe(2);
    expect(result.inside.get(byName(state, '归档').id)).toBe(1);
    expect(result.inside.has('f2')).toBe(false);
  });
  it('only looks inside the current level', () => {
    const { state, finance } = nested();
    const result = filterLayer(state.project.nodes, finance.id, '发票')!;
    expect([...result.matches].sort()).toEqual(['f0', 'f1']);
    expect(result.inside.has(finance.id)).toBe(false);
    expect(filterLayer(state.project.nodes, byName(state, '归档').id, '合同')!.matches.size).toBe(
      0,
    );
  });
  it('selects a matching folder once instead of also selecting what is inside it', () => {
    let { state, finance } = nested();
    state = addFolder(state, '财务备份', null);
    const nodes = state.project.nodes;
    const folders = filterLayer(nodes, null, '财务')!;
    expect(selectableMatches(nodes, folders).sort()).toEqual(
      [finance.id, byName(state, '财务备份').id].sort(),
    );
    const files = filterLayer(nodes, null, 'pdf')!;
    expect(selectableMatches(nodes, files).sort()).toEqual(['f0', 'f1']);
    // A folder and the file inside it both match: only the folder is selected.
    let withInvoices = addFolder(state, '发票', null);
    const invoices = byName(withInvoices, '发票');
    withInvoices = moveNodes(withInvoices, ['f0', 'f1'], invoices.id);
    const both = filterLayer(withInvoices.project.nodes, null, '发票')!;
    expect(both.matches.has(invoices.id)).toBe(true);
    expect(both.matches.size).toBe(3);
    expect(selectableMatches(withInvoices.project.nodes, both)).toEqual([invoices.id]);
  });
});

describe('batch rename', () => {
  const options = (over: Partial<RenameOptions> = {}): RenameOptions => ({
    find: '',
    replace: '',
    template: '{name}',
    start: 1,
    pad: 2,
    now: new Date(2026, 9, 20, 12).getTime(),
    ...over,
  });
  const names = (rows: { to: string }[]) => rows.map((r) => r.to);
  it('replaces text in the base name and always keeps the extension', () => {
    const state = setup(['IMG_001.jpg', 'IMG_002.JPG', 'notes.IMG.txt']);
    const rows = planBatchRename(
      state.project.nodes,
      ['f0', 'f1', 'f2'],
      options({ find: 'IMG', replace: '旅行' }),
    );
    expect(names(rows)).toEqual(['旅行_001.jpg', '旅行_002.JPG', 'notes.旅行.txt']);
    expect(rows.every((r) => r.changed && !r.error)).toBe(true);
  });
  it('numbers in name order with a start value and zero padding', () => {
    const state = setup(['b.png', 'a.png', 'c.png']);
    const rows = planBatchRename(
      state.project.nodes,
      ['f2', 'f0', 'f1'],
      options({ template: '封面_{n}', start: 8, pad: 3 }),
    );
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      ['a.png', '封面_008.png'],
      ['b.png', '封面_009.png'],
      ['c.png', '封面_010.png'],
    ]);
  });
  it('fills in the modification date and the parent folder name', () => {
    let state = addFolder(setup(['a.png']), '旅行', null);
    state = moveNodes(state, ['f0'], byName(state, '旅行').id);
    const [row] = planBatchRename(
      state.project.nodes,
      ['f0'],
      options({ template: '{date}_{parent}_{name}' }),
    );
    expect(row.to).toBe('2026-05-06_旅行_a.png');
  });
  it('renames folders without inventing an extension', () => {
    const state = addFolder(setup(['a.png']), '资料.2024', null);
    const folder = byName(state, '资料.2024');
    const [row] = planBatchRename(
      state.project.nodes,
      [folder.id],
      options({ template: '归档_{name}' }),
    );
    expect(row.to).toBe('归档_资料.2024');
  });
  it('flags illegal names, unknown placeholders and name clashes before anything changes', () => {
    const state = setup(['a.png', 'b.png', 'c.png']);
    const nodes = state.project.nodes;
    expect(planBatchRename(nodes, ['f0'], options({ template: '{name}?' }))[0].error).toContain(
      '名称',
    );
    expect(planBatchRename(nodes, ['f0'], options({ template: '{title}' }))[0].error).toContain(
      '占位符',
    );
    // Two selected files collapse to one name.
    const same = planBatchRename(nodes, ['f0', 'f1'], options({ template: 'x' }));
    expect(same.every((r) => r.error?.includes('同名'))).toBe(true);
    // A renamed file takes the name of a sibling that is not part of the selection.
    const clash = planBatchRename(nodes, ['f0'], options({ find: 'a', replace: 'c' }));
    expect(clash[0].error).toContain('c.png');
    expect(() => applyBatchRename(state, same)).toThrow('重名');
  });
  it('allows swapping two names and reports unchanged rows as such', () => {
    const state = setup(['a1.png', 'b1.png', 'keep.png']);
    const rows = planBatchRename(
      state.project.nodes,
      ['f0', 'f1', 'f2'],
      options({ find: '1', replace: '2' }),
    );
    expect(rows.find((r) => r.from === 'keep.png')?.changed).toBe(false);
    expect(rows.filter((r) => r.changed)).toHaveLength(2);
    expect(rows.every((r) => !r.error)).toBe(true);
  });
  it('applies as one undoable step and refuses when nothing changes', () => {
    const before = setup(['a.png', 'b.png']);
    const rows = planBatchRename(before.project.nodes, ['f0', 'f1'], options({ template: 'p{n}' }));
    const after = applyBatchRename(before, rows);
    expect(Object.values(after.project.nodes).map((n) => n.name)).toEqual(['p01.png', 'p02.png']);
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(undo(after).project.nodes).toEqual(before.project.nodes);
    expect(() =>
      applyBatchRename(before, planBatchRename(before.project.nodes, ['f0'], options())),
    ).toThrow('没有需要');
  });
});
