import { describe, expect, it } from 'vitest';
import { createProject } from '../../01_源码/electron/filesystem';
import {
  addFolder,
  importEntries,
  undo,
  redo,
  workspace,
} from '../../01_源码/src/domain/workspace';
import { buildClassificationDraft, classify } from '../../01_源码/src/domain/drafts';
import { markdownPlan, planTrees } from '../../01_源码/src/domain/plan-report';
import type { ImportEntry, Preview } from '../../01_源码/src/domain/types';

const entries: ImportEntry[] = [
  '封面草稿.png',
  '封面定稿.png',
  '选题清单.csv',
  '演示配音.wav',
  '不确定.sample',
].map((name, i) => ({
  entry: { id: `item-${i}`, name, path: `C:\\demo\\${name}`, kind: 'file', size: 20, mtimeMs: 1 },
  parentSourceId: null,
}));
function setup() {
  return importEntries(workspace(createProject('C:\\demo')), entries, null);
}
describe('explainable classification drafts', () => {
  it('prepares a proposal without mutating state or source mappings and supports one-step undo/redo', () => {
    const before = setup();
    const frozen = structuredClone(before);
    const draft = buildClassificationDraft(before, null, 'content-project');
    expect(before).toEqual(frozen);
    expect(draft.rows).toHaveLength(5);
    expect(draft.issues).toEqual([]);
    expect(draft.rows.find((r) => r.name === '封面定稿.png')).toMatchObject({
      folder: '03_交付成品',
      reason: expect.stringContaining('定稿'),
    });
    expect(draft.rows.find((r) => r.name === '不确定.sample')?.folder).toBe('99_待确认');
    expect(draft.next!.past).toHaveLength(before.past.length + 1);
    expect(undo(draft.next!).project.nodes).toEqual(before.project.nodes);
    expect(redo(undo(draft.next!)).project.nodes).toEqual(draft.next!.project.nodes);
    for (const e of entries) expect(draft.next!.project.nodes[e.entry.id].source).toEqual(e.entry);
  });
  it('classifies only current-level files and reuses an existing destination folder', () => {
    let state = addFolder(setup(), '图片', null);
    const folder = Object.values(state.project.nodes).find((n) => n.name === '图片')!;
    const draft = buildClassificationDraft(state, null, 'type');
    expect(Object.values(draft.next!.project.nodes).filter((n) => n.name === '图片')).toHaveLength(
      1,
    );
    expect(draft.next!.project.nodes['item-0'].parentId).toBe(folder.id);
    expect(buildClassificationDraft(draft.next!, null, 'type').rows).toHaveLength(0);
    expect(buildClassificationDraft(draft.next!, folder.id, 'type').rows).toHaveLength(2);
  });
  it('rejects name collisions atomically instead of partially adopting the draft', () => {
    let state = addFolder(setup(), '图片', null);
    const folder = Object.values(state.project.nodes).find((n) => n.name === '图片')!;
    state = importEntries(
      state,
      [
        {
          entry: { ...entries[0].entry, id: 'duplicate', path: 'C:\\demo\\old\\封面草稿.png' },
          parentSourceId: null,
        },
      ],
      folder.id,
    );
    const before = structuredClone(state);
    const draft = buildClassificationDraft(state, null, 'type');
    expect(draft.next).toBeNull();
    expect(draft.issues.join()).toContain('已存在');
    expect(state).toEqual(before);
  });
  it('rejects a file occupying a category folder name, and handles unknown/uppercase extensions', () => {
    const state = importEntries(
      setup(),
      [
        {
          entry: { ...entries[0].entry, id: 'blocking', name: '图片', path: 'C:\\demo\\图片' },
          parentSourceId: null,
        },
      ],
      null,
    );
    expect(buildClassificationDraft(state, null, 'type').issues.join()).toContain('已被文件占用');
    expect(classify('PHOTO.PNG', 'type').folder).toBe('图片');
    expect(classify('unknown', 'type').folder).toBe('其他');
  });
});
describe('before/after report', () => {
  const preview: Preview = {
    changes: [
      {
        id: '1',
        name: '封面.png',
        kind: 'move',
        source: 'C:\\demo\\封面.png',
        target: 'C:\\demo\\图片\\封面.png',
        issues: ['目标已存在'],
      },
      { id: '2', name: '图片', kind: 'create', source: null, target: 'C:\\demo\\图片', issues: [] },
      {
        id: '3',
        name: 'notes.txt',
        kind: 'unchanged',
        source: 'C:\\demo\\notes.txt',
        target: 'C:\\demo\\notes.txt',
        issues: [],
      },
    ],
    changed: 2,
    unchanged: 1,
    issues: 1,
    checkedAt: '2026-10-16T08:00:00.000Z',
  };
  it('derives different trees from real preview paths, including unchanged items', () => {
    const trees = planTrees(preview, 'C:\\demo');
    expect(trees.before).not.toContain('图片');
    expect(trees.after).toContain('图片');
    expect(trees.before).toContain('notes.txt');
    expect(trees.after).toContain('notes.txt');
  });
  it('exports a portable, explicit non-execution report with conflicts and safe text escaping', () => {
    const project = createProject('C:\\demo');
    const report = markdownPlan(project, preview);
    expect(report).toContain('未执行真实文件操作');
    expect(report).toContain('目标已存在');
    expect(report).toContain('图片/封面.png');
    expect(report).not.toContain('C:\\demo');
    const odd = {
      ...preview,
      changes: [
        {
          ...preview.changes[0],
          source: 'C:\\demo\\a`<img>.png',
          target: 'C:\\demo\\图片\\a`<img>.png',
        },
      ],
    };
    expect(markdownPlan(project, odd)).toContain('&lt;img&gt;');
  });
});
