import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  editCanvasGroups,
  importEntries,
  redo,
  renameNode,
  undo,
  workspace,
} from '../../01_源码/src/domain/workspace';
import { createProject, readEntry, validateAuthorized } from '../../01_源码/electron/filesystem';
import { ProjectStorage } from '../../01_源码/electron/storage';
import { DiskOperations } from '../../01_源码/electron/disk-operations';
import { writeGroupZip } from '../../01_源码/electron/group-archive';

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

describe('画布分组', () => {
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

  it('缺失原件时点明名称，且不会创建一个不完整的压缩包', async () => {
    const output = path.join(base, '发给老师.zip');
    await expect(writeGroupZip(root, [path.join(root, '缺失.txt')], output)).rejects.toThrow(
      '缺失.txt',
    );
    expect(await fs.readdir(base)).toEqual(['原文件']);
  });
});
