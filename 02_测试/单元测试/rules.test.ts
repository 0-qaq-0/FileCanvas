import { describe, expect, it } from 'vitest';
import { createProject } from '../../01_源码/electron/filesystem';
import {
  addFolder,
  importEntries,
  moveNodes,
  undo,
  workspace,
} from '../../01_源码/src/domain/workspace';
import { buildClassificationDraft } from '../../01_源码/src/domain/drafts';
import {
  canonicalFolder,
  compileRules,
  countMatches,
  describeMatch,
  matchRule,
  normalizeRule,
  normalizeRules,
  parseExtensions,
  parseFolderPath,
  parseKeywords,
  placeByRules,
  ruleHits,
  ruleNameTaken,
} from '../../01_源码/src/domain/rules';
import type { ImportEntry, OrganizeRule } from '../../01_源码/src/domain/types';

const DAY = 86_400_000;
const MB = 1024 * 1024;
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const NOW = at(2026, 10, 20);
type Spec = [name: string, mtimeMs?: number, size?: number];
function setup(files: Spec[]) {
  const entries: ImportEntry[] = files.map(([name, mtimeMs = NOW, size = 10], i) => ({
    entry: { id: `f${i}`, name, path: `C:\\demo\\${name}`, kind: 'file', size, mtimeMs },
    parentSourceId: null,
  }));
  return importEntries(workspace(createProject('C:\\demo')), entries, null);
}
const nodeOf = (name: string, mtimeMs?: number, size?: number) =>
  setup([[name, mtimeMs, size]]).project.nodes.f0;
let counter = 0;
function rule(
  name: string,
  folder: string,
  match: OrganizeRule['match'],
  id = `r${++counter}`,
): OrganizeRule {
  return { id, name, folder, match };
}

describe('matching', () => {
  it('matches a keyword in the name, ignoring case, and says why', () => {
    const r = rule('发票', '财务', { keywords: ['invoice', '发票'] });
    expect(matchRule(nodeOf('2026-INVOICE.docx'), r)).toBe('名称含“invoice”');
    expect(matchRule(nodeOf('三月发票.pdf'), r)).toBe('名称含“发票”');
    expect(matchRule(nodeOf('合同.pdf'), r)).toBeNull();
  });
  it('treats keywords and extensions as alternatives', () => {
    const r = rule('发票', '财务/发票', { keywords: ['发票'], extensions: ['pdf'] });
    expect(matchRule(nodeOf('发票-三月.docx'), r)).toContain('发票');
    expect(matchRule(nodeOf('合同.PDF'), r)).toBe('扩展名 .pdf');
    expect(matchRule(nodeOf('合同.docx'), r)).toBeNull();
  });
  it('narrows with age and size using AND, with an exact boundary day', () => {
    const r = rule('大旧文件', '归档', { extensions: ['mp4'], olderThanDays: 90, minSizeMB: 100 });
    const big = 100 * MB;
    expect(matchRule(nodeOf('a.mp4', NOW - 90 * DAY, big), r, { now: NOW })).toContain('90 天');
    expect(matchRule(nodeOf('a.mp4', NOW - 89 * DAY, big), r, { now: NOW })).toBeNull();
    expect(matchRule(nodeOf('a.mp4', NOW - 200 * DAY, big - 1), r, { now: NOW })).toBeNull();
    expect(matchRule(nodeOf('a.mkv', NOW - 200 * DAY, big), r, { now: NOW })).toBeNull();
    expect(matchRule(nodeOf('a.mp4', NOW - 200 * DAY, 150 * MB), r, { now: NOW })).toBe(
      '扩展名 .mp4，已 200 天未修改，大小 150 MB',
    );
  });
  it('works with only an age or only a size condition', () => {
    const old = rule('旧', '旧', { olderThanDays: 30 });
    const large = rule('大', '大', { minSizeMB: 0.5 });
    expect(matchRule(nodeOf('x', NOW - 31 * DAY), old, { now: NOW })).not.toBeNull();
    expect(matchRule(nodeOf('x', NOW - 29 * DAY), old, { now: NOW })).toBeNull();
    expect(matchRule(nodeOf('x', NOW, 0.5 * MB), large)).not.toBeNull();
    expect(matchRule(nodeOf('x', NOW, 0.5 * MB - 1), large)).toBeNull();
  });
  it('never lets a file without a modification time satisfy an age rule', () => {
    const r = rule('旧', '旧', { olderThanDays: 1 });
    expect(matchRule(nodeOf('x.txt', 0), r, { now: NOW })).toBeNull();
    const broken = nodeOf('x.txt');
    broken.source = { ...broken.source!, mtimeMs: Number.NaN };
    expect(matchRule(broken, r, { now: NOW })).toBeNull();
    expect(matchRule({ ...broken, source: null }, r, { now: NOW })).toBeNull();
  });
  it('catches nothing for a rule that somehow has no conditions', () => {
    expect(matchRule(nodeOf('x.txt'), rule('空', '空', {}))).toBeNull();
  });
  it('lets the first matching rule win and leaves unmatched files alone', () => {
    const rules = compileRules([
      rule('发票', '财务/发票', { keywords: ['发票'] }),
      rule('PDF', 'PDF', { extensions: ['pdf'] }),
    ]);
    expect(placeByRules(nodeOf('发票.pdf'), rules)).toMatchObject({ folder: '财务/发票' });
    expect(placeByRules(nodeOf('合同.pdf'), rules)).toMatchObject({
      folder: 'PDF',
      reason: '规则“PDF”：扩展名 .pdf',
    });
    expect(placeByRules(nodeOf('照片.jpg'), rules)).toBeNull();
  });
});

describe('input normalization', () => {
  it('parses folder paths on / and \\, trimming and dropping empty segments', () => {
    expect(parseFolderPath(' 财务 \\ 发票/ ')).toEqual(['财务', '发票']);
    expect(canonicalFolder('/财务//发票/2026')).toBe('财务/发票/2026');
  });
  it.each([
    '',
    '   ',
    '//',
    'con',
    '财务/aux',
    'a/../b',
    '..',
    '发票.',
    'a:b',
    '财务/发票?',
    'one/two/three/four/five/six/seven',
    'x'.repeat(201),
  ])('rejects the folder %j', (folder) => {
    expect(() => parseFolderPath(folder)).toThrow();
  });
  it('splits keywords on commas and 、 but not on spaces, without duplicates', () => {
    expect(parseKeywords('发票， 报销、Invoice, tax return;发票\n')).toEqual([
      '发票',
      '报销',
      'Invoice',
      'tax return',
    ]);
  });
  it('normalizes extensions written as .PDF, *.pdf or pdf', () => {
    expect(parseExtensions('.PDF *.docx, xlsx  pdf')).toEqual(['pdf', 'docx', 'xlsx']);
  });
  it('normalizes a rule to its canonical stored form', () => {
    expect(
      normalizeRule({
        id: 'a-1',
        name: '  发票  ',
        folder: ' 财务\\发票 ',
        match: { keywords: [' 发票 ', '', '发票'], extensions: ['.PDF', '*.pdf'], extra: 1 },
      }),
    ).toEqual({
      id: 'a-1',
      name: '发票',
      folder: '财务/发票',
      match: { keywords: ['发票'], extensions: ['pdf'] },
    });
  });
  it.each([
    ['not an object', 'x'],
    ['no id', { name: 'a', folder: 'a', match: { keywords: ['a'] } }],
    ['bad id', { id: '../x', name: 'a', folder: 'a', match: { keywords: ['a'] } }],
    ['empty name', { id: 'a', name: ' ', folder: 'a', match: { keywords: ['a'] } }],
    ['long name', { id: 'a', name: 'n'.repeat(61), folder: 'a', match: { keywords: ['a'] } }],
    ['no conditions', { id: 'a', name: 'a', folder: 'a', match: {} }],
    ['only blank keywords', { id: 'a', name: 'a', folder: 'a', match: { keywords: [' '] } }],
    ['bad folder', { id: 'a', name: 'a', folder: 'a/../b', match: { keywords: ['a'] } }],
    ['no folder', { id: 'a', name: 'a', match: { keywords: ['a'] } }],
    ['keywords not an array', { id: 'a', name: 'a', folder: 'a', match: { keywords: 'a' } }],
    ['bad extension', { id: 'a', name: 'a', folder: 'a', match: { extensions: ['p/df'] } }],
    ['zero days', { id: 'a', name: 'a', folder: 'a', match: { olderThanDays: 0 } }],
    ['fractional days', { id: 'a', name: 'a', folder: 'a', match: { olderThanDays: 1.5 } }],
    ['negative size', { id: 'a', name: 'a', folder: 'a', match: { minSizeMB: -1 } }],
    ['size as text', { id: 'a', name: 'a', folder: 'a', match: { minSizeMB: '5' } }],
    ['long keyword', { id: 'a', name: 'a', folder: 'a', match: { keywords: ['k'.repeat(51)] } }],
  ])('rejects a rule with %s', (_label, input) => {
    expect(() => normalizeRule(input)).toThrow();
  });
  it('rejects duplicate ids and oversized lists, and keeps names distinct in the editor', () => {
    const one = rule('一', '一', { keywords: ['一'] }, 'same');
    expect(() => normalizeRules([one, { ...one, name: '二' }])).toThrow('重复');
    expect(() => normalizeRules('x')).toThrow();
    const many = Array.from({ length: 51 }, (_, i) => rule(`r${i}`, 'a', { keywords: ['a'] }));
    expect(() => normalizeRules(many)).toThrow('最多');
    expect(ruleNameTaken([one], ' 一 ')).toBe(true);
    expect(ruleNameTaken([one], '一', 'same')).toBe(false);
    expect(ruleNameTaken([one], '二')).toBe(false);
  });
  it('describes the conditions in one line', () => {
    expect(
      describeMatch({
        keywords: ['发票', '报销'],
        extensions: ['pdf'],
        olderThanDays: 90,
        minSizeMB: 5,
      }),
    ).toBe('名称含“发票”“报销” 或 扩展名 .pdf · 超过 90 天未修改 · 不小于 5 MB');
  });
});

describe('live counts', () => {
  const rules = [
    rule('发票', '财务', { keywords: ['发票'] }),
    rule('PDF', 'PDF', { extensions: ['pdf'] }),
    rule('没有', '无', { keywords: ['不存在'] }),
  ];
  const state = setup([['发票-三月.pdf'], ['发票-四月.pdf'], ['合同.pdf'], ['照片.jpg']]);
  it('counts what each rule catches and what earlier rules took from it', () => {
    expect(ruleHits(state.project.nodes, null, rules)).toEqual([
      { id: rules[0].id, caught: 2, shadowed: 0 },
      { id: rules[1].id, caught: 1, shadowed: 2 },
      { id: rules[2].id, caught: 0, shadowed: 0 },
    ]);
  });
  it('counts one rule on its own, ignoring the others', () => {
    expect(countMatches(state.project.nodes, null, rules[1])).toBe(3);
  });
  it('counts only the loose files of the current level', () => {
    const inside = addFolder(state, '子目录', null);
    const folder = Object.values(inside.project.nodes).find((n) => n.kind === 'folder')!;
    expect(ruleHits(inside.project.nodes, folder.id, rules).map((h) => h.caught)).toEqual([
      0, 0, 0,
    ]);
  });
});

describe('custom drafts', () => {
  const invoice = rule('发票', '财务/发票', { keywords: ['发票'], extensions: ['pdf'] });
  const photos = rule('照片', '图片', { extensions: ['jpg', 'png'] });
  const files: Spec[] = [
    ['发票-三月.docx'],
    ['合同.pdf'],
    ['旅行1.jpg'],
    ['旅行2.jpg'],
    ['笔记.md'],
  ];
  it('groups by target folder in rule order, builds the nested chain and adopts in one undo step', () => {
    const before = setup(files);
    const draft = buildClassificationDraft(before, null, 'custom', { rules: [photos, invoice] });
    expect(draft.issues).toEqual([]);
    expect(draft.groups.map((g) => [g.folder, g.rows.length, g.existing])).toEqual([
      ['图片', 2, false],
      ['财务/发票', 2, false],
    ]);
    expect(draft.rows.find((r) => r.name === '合同.pdf')).toMatchObject({
      folder: '财务/发票',
      to: '财务/发票/合同.pdf',
      reason: '规则“发票”：扩展名 .pdf',
    });
    // 笔记.md is caught by no rule: it stays put and no catch-all folder appears.
    expect(draft.rows.map((r) => r.name)).not.toContain('笔记.md');
    const nodes = draft.next!.project.nodes;
    const named = (name: string) => Object.values(nodes).filter((n) => n.name === name);
    expect(named('财务')).toHaveLength(1);
    expect(named('发票')).toHaveLength(1);
    expect(nodes[named('发票')[0].parentId!].name).toBe('财务');
    expect(nodes[named('财务')[0].id].parentId).toBeNull();
    expect(nodes[named('合同.pdf')[0].parentId!].name).toBe('发票');
    expect(named('笔记.md')[0].parentId).toBeNull();
    expect(Object.values(nodes).filter((n) => n.kind === 'folder')).toHaveLength(3);
    expect(draft.next!.past).toHaveLength(before.past.length + 1);
    expect(undo(draft.next!).project.nodes).toEqual(before.project.nodes);
  });
  it('shares one group between rules that name the same folder in different casing', () => {
    const state = setup([['a.jpg'], ['b.mp4']]);
    const draft = buildClassificationDraft(state, null, 'custom', {
      rules: [
        rule('图', 'Media/Pics', { extensions: ['jpg'] }),
        rule('视频', 'media\\pics', { extensions: ['mp4'] }),
      ],
    });
    expect(draft.groups.map((g) => [g.folder, g.rows.length])).toEqual([['Media/Pics', 2]]);
    expect(
      Object.values(draft.next!.project.nodes).filter((n) => n.kind === 'folder'),
    ).toHaveLength(2);
  });
  it('reuses existing folders case-insensitively and only creates the missing part', () => {
    let state = setup(files);
    state = addFolder(state, '财务', null);
    const draft = buildClassificationDraft(state, null, 'custom', {
      rules: [rule('发票', '财务/发票', { extensions: ['pdf'] })],
    });
    expect(draft.groups).toMatchObject([{ folder: '财务/发票', existing: false }]);
    const folders = Object.values(draft.next!.project.nodes).filter((n) => n.kind === 'folder');
    expect(folders.map((f) => f.name).sort()).toEqual(['发票', '财务']);
    // Now both exist, in other casing: nothing new is created.
    const again = addFolder(addFolder(setup(files), 'FINANCE', null), '发票', null);
    const finance = Object.values(again.project.nodes).find((n) => n.name === 'FINANCE')!;
    const inner = Object.values(again.project.nodes).find((n) => n.name === '发票')!;
    const nested = moveNodes(again, [inner.id], finance.id);
    const reused = buildClassificationDraft(nested, null, 'custom', {
      rules: [rule('发票', 'finance/发票', { extensions: ['pdf'] })],
    });
    expect(reused.groups[0].existing).toBe(true);
    expect(
      Object.values(reused.next!.project.nodes).filter((n) => n.kind === 'folder'),
    ).toHaveLength(2);
  });
  it('switches a nested group off without touching the others', () => {
    const state = setup(files);
    const draft = buildClassificationDraft(state, null, 'custom', {
      rules: [photos, invoice],
      excluded: ['财务/发票'],
    });
    expect(draft.groups).toHaveLength(2);
    expect(draft.rows.map((r) => r.folder)).toEqual(['图片', '图片']);
    const nodes = draft.next!.project.nodes;
    expect(nodes.f1.parentId).toBeNull();
    expect(Object.values(nodes).some((n) => n.name === '财务')).toBe(false);
    const none = buildClassificationDraft(state, null, 'custom', {
      rules: [photos, invoice],
      excluded: ['图片', '财务/发票'],
    });
    expect(none.rows).toEqual([]);
    expect(none.next).toBe(state);
  });
  it('reports a file that occupies a folder name on the path, adopting nothing', () => {
    const top = setup([...files, ['财务']]);
    const first = buildClassificationDraft(top, null, 'custom', { rules: [invoice] });
    expect(first.next).toBeNull();
    expect(first.issues[0]).toContain('“财务”已被文件占用');
    // The same check applies to a deeper segment inside an existing folder.
    let nested = addFolder(setup([...files]), '财务', null);
    const parent = Object.values(nested.project.nodes).find((n) => n.name === '财务')!;
    nested = importEntries(
      nested,
      [
        {
          entry: {
            id: 'blocker',
            name: '发票',
            path: 'C:\\demo\\财务\\发票',
            kind: 'file',
            size: 1,
            mtimeMs: NOW,
          },
          parentSourceId: null,
        },
      ],
      parent.id,
    );
    const second = buildClassificationDraft(nested, null, 'custom', { rules: [invoice] });
    expect(second.next).toBeNull();
    expect(second.issues[0]).toContain('“发票”已被文件占用');
  });
  it('reports a name already taken in the destination folder', () => {
    let state = setup([['合同.pdf']]);
    state = addFolder(addFolder(state, '财务', null), '发票', null);
    const finance = Object.values(state.project.nodes).find((n) => n.name === '财务')!;
    const bills = Object.values(state.project.nodes).find((n) => n.name === '发票')!;
    state = importEntries(
      moveNodes(state, [bills.id], finance.id),
      [
        {
          entry: {
            id: 'older',
            name: '合同.pdf',
            path: 'C:\\demo\\财务\\发票\\合同.pdf',
            kind: 'file',
            size: 1,
            mtimeMs: NOW,
          },
          parentSourceId: null,
        },
      ],
      bills.id,
    );
    const draft = buildClassificationDraft(state, null, 'custom', { rules: [invoice] });
    expect(draft.next).toBeNull();
    expect(draft.issues.join()).toContain('已存在');
  });
  it('refuses invalid rules instead of guessing, and does nothing without rules', () => {
    const state = setup(files);
    const bad = buildClassificationDraft(state, null, 'custom', {
      rules: [rule('坏', 'a/../b', { keywords: ['a'] })],
    });
    expect(bad.next).toBeNull();
    expect(bad.issues).toHaveLength(1);
    const empty = buildClassificationDraft(state, null, 'custom', { rules: [] });
    expect(empty).toMatchObject({ rows: [], groups: [], issues: [] });
    expect(empty.next).toBe(state);
    expect(buildClassificationDraft(state, null, 'custom').next).toBe(state);
  });
  it('plans inside a folder with the folder as the path prefix', () => {
    let state = addFolder(setup([]), '收件', null);
    const inbox = Object.values(state.project.nodes).find((n) => n.name === '收件')!;
    state = importEntries(
      state,
      [
        {
          entry: {
            id: 'in1',
            name: '合同.pdf',
            path: 'C:\\demo\\收件\\合同.pdf',
            kind: 'file',
            size: 1,
            mtimeMs: NOW,
          },
          parentSourceId: null,
        },
      ],
      inbox.id,
    );
    const draft = buildClassificationDraft(state, inbox.id, 'custom', { rules: [invoice] });
    expect(draft.rows[0].to).toBe('收件/财务/发票/合同.pdf');
    const nodes = draft.next!.project.nodes;
    expect(nodes[nodes.in1.parentId!].name).toBe('发票');
    expect(nodes[nodes[nodes.in1.parentId!].parentId!].parentId).toBe(inbox.id);
  });
});
