import { describe, expect, it } from 'vitest';
import { createProject } from '../../01_源码/electron/filesystem';
import { addFolder, importEntries, undo, workspace } from '../../01_源码/src/domain/workspace';
import { buildClassificationDraft } from '../../01_源码/src/domain/drafts';
import {
  DEFAULT_STALE_DAYS,
  monthOf,
  placeByName,
  placeFile,
  suggestRecipes,
} from '../../01_源码/src/domain/recipes';
import type { CanvasNode, ImportEntry } from '../../01_源码/src/domain/types';

const DAY = 86_400_000;
// Local noon keeps month and day assertions independent of the machine's time zone.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const NOW = at(2026, 10, 20);
function setup(files: [string, number][], extra: ImportEntry[] = []) {
  const entries: ImportEntry[] = files.map(([name, mtimeMs], i) => ({
    entry: { id: `f${i}`, name, path: `C:\\demo\\${name}`, kind: 'file', size: 10, mtimeMs },
    parentSourceId: null,
  }));
  return importEntries(workspace(createProject('C:\\demo')), [...entries, ...extra], null);
}
const nodeOf = (name: string, mtimeMs: number): CanvasNode =>
  setup([[name, mtimeMs]]).project.nodes.f0;

describe('type recipe', () => {
  it.each([
    ['发票.PDF', 'PDF'],
    ['预算.xlsx', '表格'],
    ['汇报.pptx', '演示'],
    ['笔记.md', '文档'],
    ['安装.exe', '安装包'],
    ['海报.psd', '设计文件'],
    ['思源.ttf', '字体'],
    ['小说.epub', '电子书'],
    ['照片.HEIC', '图片'],
    ['录像.mkv', '视频'],
    ['脚本.ts', '代码与配置'],
    ['神秘文件', '其他'],
    ['.gitignore', '其他'],
  ])('puts %s into %s', (name, folder) => {
    expect(placeByName(name, 'type').folder).toBe(folder);
  });
});

describe('time recipes', () => {
  it('groups by the local year-month of the last modification', () => {
    expect(monthOf(at(2026, 1, 31))).toBe('2026-01');
    expect(monthOf(at(2025, 12, 1))).toBe('2025-12');
    expect(placeFile(nodeOf('a.jpg', at(2026, 3, 9)), 'month')).toEqual({
      folder: '2026-03',
      reason: '最后修改于 2026-03-09',
    });
  });
  it('leaves files without a usable modification time alone', () => {
    expect(placeFile(nodeOf('a.jpg', 0), 'month')).toBeNull();
    expect(placeFile(nodeOf('a.jpg', 0), 'stale', { now: NOW })).toBeNull();
  });
  it('archives only files older than the limit, with an injectable clock', () => {
    const recent = nodeOf('a.txt', NOW - (DEFAULT_STALE_DAYS - 1) * DAY);
    const edge = nodeOf('b.txt', NOW - DEFAULT_STALE_DAYS * DAY);
    expect(placeFile(recent, 'stale', { now: NOW })).toBeNull();
    expect(placeFile(edge, 'stale', { now: NOW })).toMatchObject({
      folder: '久未修改',
      reason: expect.stringContaining('180 天'),
    });
    expect(placeFile(recent, 'stale', { now: NOW, staleDays: 90 })?.folder).toBe('久未修改');
  });
});

describe('drafts from recipes', () => {
  const files: [string, number][] = [
    ['旅行1.jpg', at(2026, 9, 3)],
    ['旅行2.jpg', at(2026, 9, 28)],
    ['发票.pdf', at(2026, 10, 2)],
    ['老文档.docx', at(2024, 1, 5)],
    ['老照片.png', at(2023, 6, 1)],
  ];
  it('builds month groups and adopts them as a single undoable step', () => {
    const before = setup(files);
    const draft = buildClassificationDraft(before, null, 'month', { now: NOW });
    expect(draft.groups.map((g) => [g.folder, g.rows.length])).toEqual([
      ['2026-10', 1],
      ['2026-09', 2],
      ['2024-01', 1],
      ['2023-06', 1],
    ]);
    expect(draft.issues).toEqual([]);
    const folders = Object.values(draft.next!.project.nodes).filter((n) => n.kind === 'folder');
    expect(folders.map((f) => f.name).sort()).toEqual(['2023-06', '2024-01', '2026-09', '2026-10']);
    expect(draft.next!.past).toHaveLength(before.past.length + 1);
    expect(undo(draft.next!).project.nodes).toEqual(before.project.nodes);
  });
  it('moves only stale files and keeps recent ones in place', () => {
    const draft = buildClassificationDraft(setup(files), null, 'stale', { now: NOW });
    expect(draft.rows.map((r) => r.name).sort()).toEqual(['老文档.docx', '老照片.png']);
    const nodes = draft.next!.project.nodes;
    expect(nodes.f0.parentId).toBeNull();
    expect(nodes[nodes.f3.parentId!].name).toBe('久未修改');
    expect(nodes.f3.parentId).toBe(nodes.f4.parentId);
  });
  it('skips a switched-off group, and does nothing when every group is switched off', () => {
    const before = setup(files);
    const draft = buildClassificationDraft(before, null, 'type', { excluded: ['图片'] });
    expect(draft.groups.map((g) => g.folder)).toContain('图片');
    expect(draft.rows.some((r) => r.folder === '图片')).toBe(false);
    expect(draft.next!.project.nodes.f0.parentId).toBeNull();
    expect(draft.next!.project.nodes.f2.parentId).not.toBeNull();
    const none = buildClassificationDraft(before, null, 'type', {
      excluded: draft.groups.map((g) => g.folder),
    });
    expect(none.rows).toEqual([]);
    expect(none.next).toBe(before);
  });
  it('reuses an existing folder and reports it, case-insensitively', () => {
    const state = addFolder(setup(files), 'pdf', null);
    const draft = buildClassificationDraft(state, null, 'type');
    expect(draft.groups.find((g) => g.folder === 'PDF')?.existing).toBe(true);
    expect(draft.groups.find((g) => g.folder === '图片')?.existing).toBe(false);
    expect(
      Object.values(draft.next!.project.nodes).filter((n) => n.name.toLowerCase() === 'pdf'),
    ).toHaveLength(1);
  });
  it('rejects a name collision in the destination without adopting anything', () => {
    const clash: ImportEntry = {
      entry: {
        id: 'older',
        name: '旅行1.jpg',
        path: 'C:\\demo\\2026-09\\旅行1.jpg',
        kind: 'file',
        size: 1,
        mtimeMs: at(2026, 9, 1),
      },
      parentSourceId: null,
    };
    let state = addFolder(setup(files), '2026-09', null);
    const folder = Object.values(state.project.nodes).find((n) => n.name === '2026-09')!;
    state = importEntries(state, [clash], folder.id);
    const draft = buildClassificationDraft(state, null, 'month');
    expect(draft.next).toBeNull();
    expect(draft.issues.join()).toContain('已存在');
  });
});

describe('suggestions', () => {
  it('offers recipes that actually change something and hides the rest', () => {
    const state = setup([
      ['a.jpg', NOW - 10 * DAY],
      ['b.pdf', NOW - 40 * DAY],
      ['c.docx', NOW - 400 * DAY],
      ['d.docx', NOW - 500 * DAY],
    ]);
    const { loose, items } = suggestRecipes(state, null, { now: NOW });
    expect(loose).toBe(4);
    expect(items.map((i) => [i.id, i.files, i.folders])).toEqual([
      ['type', 4, 3],
      ['month', 4, 4],
      ['stale', 2, 1],
    ]);
  });
  it('offers the content-project recipe first only when asked, and nothing for tiny folders', () => {
    const state = setup([
      ['脚本.md', NOW],
      ['封面.png', NOW],
    ]);
    expect(suggestRecipes(state, null, { now: NOW, contentProject: true }).items[0].id).toBe(
      'content-project',
    );
    expect(suggestRecipes(setup([['a.jpg', NOW]]), null, { now: NOW }).items).toEqual([]);
  });
});
