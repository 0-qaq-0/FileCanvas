import { describe, expect, it } from 'vitest';
import { createProject } from '../../app/electron/filesystem';
import { addFolder, children, importEntries, workspace } from '../../app/src/domain/workspace';
import { buildClassificationDraft } from '../../app/src/domain/drafts';
import type { ImportEntry } from '../../app/src/domain/types';

function setup(names: string[], withFolders: string[] = []) {
  const entries: ImportEntry[] = names.map((name, i) => ({
    entry: { id: `f-${i}`, name, path: `C:/demo/${name}`, kind: 'file', size: 20, mtimeMs: 1 },
    parentSourceId: null,
  }));
  let state = importEntries(workspace(createProject('C:/demo')), entries, null);
  for (const folder of withFolders) state = addFolder(state, folder, null);
  return state;
}
const sizes = (draft: ReturnType<typeof buildClassificationDraft>) =>
  Object.fromEntries(draft.groups.map((g) => [g.folder, g.rows.length]));

describe('type classification: merging scattered types', () => {
  const mixed = ['a.png', 'b.png', 'c.jpg', 'd.pdf', 'e.pdf', 'f.xlsx', 'g.zip', 'h.wav'];
  it('keeps one folder per type when no group is worth keeping', () => {
    const state = setup([
      'a.png',
      'b.pdf',
      'c.xlsx',
      'd.zip',
      'e.wav',
      'f.mp4',
      'g.docx',
      'h.pptx',
    ]);
    const draft = buildClassificationDraft(state, null, 'type', { mergeSmall: true });
    expect(draft.groups).toHaveLength(8);
    expect(draft.groups.every((g) => g.rows.length === 1)).toBe(true);
    expect(draft.groups.some((g) => g.folder === '其他')).toBe(false);
  });
  it('folds single-file types into 其他 beside real groups', () => {
    const draft = buildClassificationDraft(setup(mixed), null, 'type', { mergeSmall: true });
    expect(sizes(draft)).toEqual({ 图片: 3, 其他: 3, PDF: 2 });
    expect(draft.groups.map((g) => g.folder)).toEqual(['图片', 'PDF', '其他']);
    const moved = draft.rows.find((r) => r.name === 'f.xlsx')!;
    expect(moved.reason).toBe('该类型只有 1 个文件，并入“其他”');
    expect(moved.to).toBe('其他/f.xlsx');
    expect(draft.issues).toEqual([]);
    const nodes = draft.next!.project.nodes;
    const misc = children(nodes, null).find((n) => n.name === '其他')!;
    expect(
      children(nodes, misc.id)
        .map((n) => n.name)
        .sort(),
    ).toEqual(['f.xlsx', 'g.zip', 'h.wav']);
    expect(children(nodes, null).some((n) => n.name === '表格')).toBe(false);
  });
  it('still sends a single file to an existing folder of its type', () => {
    const draft = buildClassificationDraft(setup(mixed, ['表格']), null, 'type', {
      mergeSmall: true,
    });
    expect(sizes(draft)).toEqual({ 图片: 3, 其他: 2, PDF: 2, 表格: 1 });
    expect(draft.groups.find((g) => g.folder === '表格')!.existing).toBe(true);
  });
  it('leaves a lone leftover as its own group, but joins an existing 其他 group', () => {
    const lone = buildClassificationDraft(setup(['a.png', 'b.png', 'c.xlsx']), null, 'type', {
      mergeSmall: true,
    });
    expect(sizes(lone)).toEqual({ 图片: 2, 表格: 1 });
    const joined = buildClassificationDraft(
      setup(['a.png', 'b.png', 'c.xlsx', 'd.unknown', 'e.nope']),
      null,
      'type',
      { mergeSmall: true },
    );
    expect(sizes(joined)).toEqual({ 图片: 2, 其他: 3 });
    const single = buildClassificationDraft(setup(['a.png', 'b.png', 'x.unknown']), null, 'type', {
      mergeSmall: true,
    });
    expect(sizes(single)).toEqual({ 图片: 2, 其他: 1 });
  });
  it('behaves as before when mergeSmall is off or missing, and for other modes', () => {
    const off = buildClassificationDraft(setup(mixed), null, 'type', { mergeSmall: false });
    expect(sizes(off)).toEqual({ 图片: 3, PDF: 2, 压缩包: 1, 表格: 1, 音频: 1 });
    expect(sizes(buildClassificationDraft(setup(mixed), null, 'type'))).toEqual(sizes(off));
    const project = buildClassificationDraft(setup(mixed), null, 'content-project', {
      mergeSmall: true,
    });
    expect(project.groups.some((g) => g.folder === '其他')).toBe(false);
  });
  it('keeps files in place when the merged 其他 group is switched off', () => {
    const draft = buildClassificationDraft(setup(mixed), null, 'type', {
      mergeSmall: true,
      excluded: ['其他'],
    });
    expect(draft.rows).toHaveLength(5);
    expect(draft.folders).toEqual(['图片', 'PDF']);
    const nodes = draft.next!.project.nodes;
    expect(children(nodes, null).filter((n) => n.kind === 'file')).toHaveLength(3);
    expect(children(nodes, null).some((n) => n.name === '其他')).toBe(false);
  });
  it('reports a file standing in the way of the merged folder', () => {
    const state = setup([...mixed, '其他']);
    const draft = buildClassificationDraft(state, null, 'type', { mergeSmall: true });
    expect(draft.issues.join()).toContain('已被文件占用');
    expect(draft.next).toBeNull();
  });
  it('lays the result out with the requested number of columns', () => {
    const pos = (columns?: number) => {
      const draft = buildClassificationDraft(setup(mixed), null, 'type', {
        mergeSmall: true,
        columns,
      });
      const items = children(draft.next!.project.nodes, null);
      return new Set(items.map((n) => n.y)).size;
    };
    // 3 folders: 其他, PDF, 图片
    expect(pos(1)).toBe(3);
    expect(pos(2)).toBe(2);
    expect(pos(3)).toBe(1);
    expect(pos(0)).toBe(3);
    expect(pos(undefined)).toBe(1);
  });
});
