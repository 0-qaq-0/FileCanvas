import { describe, expect, it } from 'vitest';
import {
  fileInfo,
  folderDescription,
  formatSize,
  summarizeFolders,
} from '../../01_源码/src/domain/file-info';
import type { CanvasNode, NodeMap } from '../../01_源码/src/domain/types';

function node(
  id: string,
  name: string,
  parentId: string | null,
  size?: number,
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
      size === undefined
        ? null
        : { id, name, kind: 'file', path: `D:\\sample\\${name}`, size, mtimeMs: 0 },
  };
}
const fixture = (): NodeMap => ({
  root: node('root', '资料', null, undefined, true),
  nested: node('nested', '图片', 'root', undefined, true),
  image: node('image', '照片.JPG', 'nested', 2048),
  doc: node('doc', '说明.md', 'root', 1024),
  empty: node('empty', '空目录', null, undefined, true),
  outside: node('outside', '其他.pdf', null, 9000),
});

describe('file information shown on cards', () => {
  it('shows readable sizes through GB/TB and keeps an unknown size distinct from an empty file', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(2 * 1024 ** 3)).toBe('2.0 GB');
    expect(formatSize(1024 ** 4)).toBe('1.0 TB');
    for (const value of [undefined, null, NaN, -1]) expect(formatSize(value)).toBe('大小未知');
  });
  it('uses file types and extensions consistently, including extensionless and hidden files', () => {
    expect(fileInfo('照片.HEIC')).toMatchObject({
      label: '图片',
      tone: 'image',
      extension: 'HEIC',
    });
    expect(fileInfo('方案.pdf').description).toBe('PDF 文档');
    expect(fileInfo('资料.tar.gz').tone).toBe('archive');
    expect(fileInfo('README').extension).toBe('');
    expect(fileInfo('.gitignore').extension).toBe('');
  });
  it('counts nested imported files once and excludes unrelated files and empty folders from byte totals', () => {
    const nodes = fixture(),
      before = JSON.stringify(nodes);
    const summaries = summarizeFolders(nodes);
    expect(summaries.get('root')).toEqual({
      files: 2,
      folders: 1,
      bytes: 3072,
      unknown: 0,
      types: [
        ['图片', 1],
        ['文档', 1],
      ],
    });
    expect(summaries.get('nested')?.bytes).toBe(2048);
    expect(summaries.get('empty')).toMatchObject({ files: 0, bytes: 0 });
    expect(folderDescription(summaries.get('root')!)).toContain('仅统计已加入画布');
    expect(JSON.stringify(nodes)).toBe(before);
  });
  it('updates when a planned move changes a folder and does not invent bytes for an unknown file', () => {
    const nodes = fixture();
    nodes.image.parentId = 'empty';
    nodes.unknown = node('unknown', '待确认.bin', 'root');
    const summaries = summarizeFolders(nodes);
    expect(summaries.get('empty')).toMatchObject({ files: 1, bytes: 2048 });
    expect(summaries.get('root')).toMatchObject({ files: 2, bytes: 1024, unknown: 1 });
    expect(folderDescription(summaries.get('root')!)).toContain('1.0 KB + 未知');
  });
});
