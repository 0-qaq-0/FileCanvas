import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  addFolder,
  editCanvasGroups,
  groupMembership,
  importEntries,
  moveConflict,
  redo,
  renameNode,
  undo,
  workspace,
} from '../../app/src/domain/workspace';
import { createProject, readEntry, validateAuthorized } from '../../app/electron/filesystem';
import { ProjectStorage } from '../../app/electron/storage';
import { DiskOperations } from '../../app/electron/disk-operations';
import {
  availableGroupFiles,
  copyGroupFiles,
  writeGroupZip,
} from '../../app/electron/group-archive';

let base: string;
let root: string;

async function projectWithFile(file: string) {
  const entry = await readEntry(root, file);
  return importEntries(workspace(createProject(root)), [{ entry, parentSourceId: null }], null)
    .project;
}

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-groups-'));
  root = path.join(base, '原文件');
  await fs.mkdir(root);
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

function unpackSmallZip(bytes: Buffer) {
  const footer = bytes.length - 22;
  expect(bytes.readUInt32LE(footer)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(footer + 10);
  let offset = bytes.readUInt32LE(footer + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    files[name] = inflateRawSync(bytes.subarray(start, start + size)).toString('utf8');
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return files;
}

describe('文件集', () => {
  it('保存同一文件的多个分组，独立于磁盘计划，随画布操作撤销与重做', async () => {
    const source = path.join(root, '封面.txt');
    await fs.writeFile(source, '封面');
    const project = await projectWithFile(source);
    const storage = new ProjectStorage(path.join(base, '项目数据'));
    const groups = [
      { id: 'one', name: '比赛资料', files: [source] },
      { id: 'two', name: '发给老师', files: [source] },
    ];
    const state = editCanvasGroups(workspace(project), '新建分组', () => groups);
    expect(state.project.nodes).toBe(project.nodes);
    expect(undo(state).project.canvasGroups).toBeUndefined();
    expect(redo(undo(state)).project.canvasGroups).toEqual(groups);
    const renamed = renameNode(state, Object.keys(project.nodes)[0], '封面定稿.txt');
    expect(undo(renamed).project.canvasGroups).toEqual(groups);
    await storage.save(state.project);
    expect((await storage.last())?.canvasGroups).toEqual(groups);
    expect(await fs.readdir(root)).toEqual(['封面.txt']);
    expect(() =>
      validateAuthorized({ ...project, canvasGroups: [{ ...groups[0], files: [base] }] }, root),
    ).toThrow('路径超出');
  });

  it('实际改名和恢复后，分组能继续找到原件，并保留后来新建的分组', async () => {
    const oldPath = path.join(root, '原名.txt');
    const newPath = path.join(root, '新名字.txt');
    await fs.writeFile(oldPath, '原件');
    const project = await projectWithFile(oldPath);
    project.canvasGroups = [{ id: 'one', name: '发给老师', files: [oldPath] }];
    const changed = renameNode(
      workspace(project),
      Object.keys(project.nodes)[0],
      '新名字.txt',
    ).project;
    const disk = new DiskOperations(path.join(base, '日志'));
    const result = await disk.apply(project.rootPath, changed);
    expect(result.project.canvasGroups?.[0].files).toEqual([newPath]);
    const restored = await disk.undo(project.rootPath, project.id, [
      ...result.project.canvasGroups!,
      { id: 'later', name: '后来新建的组', files: [newPath] },
    ]);
    expect(restored.canvasGroups?.map((group) => group.files)).toEqual([[oldPath], [oldPath]]);
    expect(await fs.readFile(oldPath, 'utf8')).toBe('原件');
  });

  it('打包 Unicode 文件名并保留同名原件及其内容', async () => {
    const one = path.join(root, '封面.txt');
    const other = path.join(root, '另一版');
    await fs.mkdir(other);
    const two = path.join(other, '封面.txt');
    const three = path.join(other, '封面 (2).txt');
    await fs.writeFile(one, '第一版');
    await fs.writeFile(two, '第二版');
    await fs.writeFile(three, '第三个文件');
    const output = path.join(base, '发给老师.zip');
    await writeGroupZip(root, [one, one, two, three], output);
    expect(unpackSmallZip(await fs.readFile(output))).toEqual({
      '封面.txt': '第一版',
      '封面 (3).txt': '第二版',
      '封面 (2).txt': '第三个文件',
    });
    expect(await fs.readFile(one, 'utf8')).toBe('第一版');
    expect(await fs.readFile(two, 'utf8')).toBe('第二版');
    await expect(writeGroupZip(root, [one], output)).rejects.toThrow('同名文件');
    expect(unpackSmallZip(await fs.readFile(output))['封面 (3).txt']).toBe('第二版');
  });

  it('全部原件都找不到时报错，且不会留下压缩包', async () => {
    const output = path.join(base, '发给老师.zip');
    await expect(writeGroupZip(root, [path.join(root, '缺失.txt')], output)).rejects.toThrow(
      '都找不到',
    );
    expect(await fs.readdir(base)).toEqual(['原文件']);
  });

  it('部分原件找不到时打包其余文件，并报告跳过的文件', async () => {
    const here = path.join(root, '在.txt');
    const gone = path.join(root, '已改名.txt');
    await fs.writeFile(here, '还在');
    expect(await availableGroupFiles(root, [here, gone])).toMatchObject({ missing: [gone] });
    const output = path.join(base, '部分.zip');
    const result = await writeGroupZip(root, [here, gone], output);
    expect(result).toEqual({ path: output, missing: [gone] });
    expect(unpackSmallZip(await fs.readFile(output))).toEqual({ '在.txt': '还在' });
  });

  it('复制到新建的同名文件夹，不覆盖已有内容，原件不动', async () => {
    const one = path.join(root, 'a.txt');
    const other = path.join(root, '子');
    await fs.mkdir(other);
    const two = path.join(other, 'a.txt');
    await fs.writeFile(one, '一');
    await fs.writeFile(two, '二');
    const target = path.join(base, '导出');
    await fs.mkdir(path.join(target, '发给老师'), { recursive: true });
    const result = await copyGroupFiles(
      root,
      [one, two, path.join(root, '没了.txt')],
      target,
      '发给老师',
    );
    expect(result.folder).toBe(path.join(target, '发给老师 (2)'));
    expect(result).toMatchObject({ copied: 2, failed: [], missing: [path.join(root, '没了.txt')] });
    expect((await fs.readdir(result.folder)).sort()).toEqual(['a (2).txt', 'a.txt']);
    expect(await fs.readFile(path.join(result.folder, 'a (2).txt'), 'utf8')).toBe('二');
    expect(await fs.readFile(one, 'utf8')).toBe('一');
    expect(await fs.readdir(path.join(target, '发给老师'))).toEqual([]);
  });

  it('列出每个文件所在的文件集', () => {
    const map = groupMembership([
      { id: 'a', name: '甲', files: ['C:/x/A.txt'] },
      { id: 'b', name: '乙', files: ['c:/x/a.txt', 'C:/x/b.txt'] },
    ]);
    expect(map.get('c:/x/a.txt')).toEqual(['甲', '乙']);
    expect(map.get('c:/x/b.txt')).toEqual(['乙']);
  });
});

describe('拖放前的冲突提示', () => {
  it('同名文件和放进自己时说明原因，其他情况可以放入', async () => {
    const file = path.join(root, '封面.png');
    await fs.writeFile(file, 'x');
    let state = workspace(await projectWithFile(file));
    state = addFolder(state, '旧资料', null);
    state = addFolder(state, '空', null);
    const nodes = state.project.nodes;
    const id = (name: string) => Object.values(nodes).find((node) => node.name === name)!.id;
    expect(moveConflict(nodes, [id('封面.png')], id('空'))).toBeNull();
    expect(moveConflict(nodes, [id('旧资料')], id('旧资料'))).toContain('自己');
    const inside = { ...nodes, [id('空')]: { ...nodes[id('空')], name: '封面.png' } };
    expect(moveConflict(inside, [id('封面.png')], null)).toBeNull();
    const clash = {
      ...nodes,
      extra: { ...nodes[id('封面.png')], id: 'extra', parentId: id('旧资料') },
    };
    expect(moveConflict(clash, [id('封面.png')], id('旧资料'))).toContain('同名');
  });
});
