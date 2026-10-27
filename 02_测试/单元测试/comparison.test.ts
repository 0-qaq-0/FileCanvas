import { describe, expect, it } from 'vitest';
import { comparePlan } from '../../01_源码/src/domain/comparison';
import { systemOrPartial } from '../../01_源码/electron/filesystem';
import type { CanvasNode, NodeMap } from '../../01_源码/src/domain/types';

const ROOT = 'D:\\下载';
// `disk` is where the item is now (relative to the root); null for a folder the plan creates.
function node(
  id: string,
  name: string,
  parentId: string | null,
  disk: string | null,
  folder = false,
): CanvasNode {
  return {
    id,
    name,
    parentId,
    kind: folder ? 'folder' : 'file',
    x: 0,
    y: 0,
    source:
      disk === null
        ? null
        : {
            id,
            name: disk.split('\\').at(-1)!,
            kind: folder ? 'folder' : 'file',
            path: `${ROOT}\\${disk}`,
            size: 1,
            mtimeMs: 0,
          },
  };
}
// Three loose files and a folder with two files (one nested); the plan gathers the pictures
// into a new folder 图片 and renames 资料 to 参考.
const planned = (): NodeMap => ({
  a: node('a', '封面.png', 'pics', '封面.png'),
  b: node('b', '海报.jpg', 'pics', '海报.jpg'),
  c: node('c', '报价.xlsx', null, '报价.xlsx'),
  pics: node('pics', '图片', null, null, true),
  docs: node('docs', '参考', null, '资料', true),
  sub: node('sub', '旧版', 'docs', '资料\\旧版', true),
  d: node('d', '说明.md', 'docs', '资料\\说明.md'),
  e: node('e', '草稿.md', 'sub', '资料\\旧版\\草稿.md'),
  empty: node('empty', '空', null, '空', true),
});

describe('before/after comparison for the completion report', () => {
  it('summarizes the top level on disk and as planned, counting nested files once', () => {
    const { before, after } = comparePlan(planned(), ROOT);
    expect(before.folders).toEqual([
      { name: '资料', files: 2 },
      { name: '空', files: 0 },
    ]);
    expect(before.loose).toEqual(['报价.xlsx', '封面.png', '海报.jpg']);
    expect(before.looseTypes).toEqual([
      ['图片', 2],
      ['表格', 1],
    ]);
    expect(before.files).toBe(5);
    expect(after.folders).toEqual([
      { name: '参考', files: 2 },
      { name: '图片', files: 2 },
      { name: '空', files: 0 },
    ]);
    expect(after.loose).toEqual(['报价.xlsx']);
    expect(after.files).toBe(5);
  });
  it('ignores sources outside the root and a trailing separator on the root', () => {
    const nodes = planned();
    nodes.c.source!.path = 'E:\\别处\\报价.xlsx';
    const { before, after } = comparePlan(nodes, `${ROOT}\\`);
    expect(before.loose).toEqual(['封面.png', '海报.jpg']);
    expect(after.loose).toEqual(['报价.xlsx']);
  });
  it('does not change the plan it reads', () => {
    const nodes = planned(),
      copy = JSON.stringify(nodes);
    comparePlan(nodes, ROOT);
    expect(JSON.stringify(nodes)).toBe(copy);
  });
});

describe('files that are never imported', () => {
  it('skips Windows system files, Office lock files and downloads in progress', () => {
    for (const name of ['desktop.ini', 'Thumbs.db', '~$报价.xlsx', '视频.mp4.crdownload', 'a.part'])
      expect(systemOrPartial(name)).toBeTruthy();
    for (const name of ['报价.xlsx', 'desktop.ini.bak', 'partner.pdf', '说明.txt'])
      expect(systemOrPartial(name)).toBeNull();
  });
});
