import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  checkPath,
  createProject,
  fileId,
  generatePreview,
  importPaths,
  listDirectory,
  readableError,
  searchFiles,
} from '../../01_源码/electron/filesystem';
import { ProjectStorage } from '../../01_源码/electron/storage';
import {
  addFolder,
  importEntries,
  moveNodes,
  renameNode,
  workspace,
} from '../../01_源码/src/domain/workspace';

let root: string;
let appData: string;
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const { createHash } = await import('node:crypto');
  const out: Record<string, string> = {};
  async function visit(p: string) {
    for (const entry of await fs.readdir(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      out[path.relative(dir, full)] = entry.isDirectory()
        ? 'folder'
        : createHash('sha256')
            .update(await fs.readFile(full))
            .digest('hex');
      if (entry.isDirectory()) await visit(full);
    }
  }
  await visit(dir);
  return out;
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-unit-'));
  appData = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-store-'));
  await fs.mkdir(path.join(root, '子目录'));
  await fs.mkdir(path.join(root, '其他目录'));
  for (const [index, name] of [
    'A.jpg',
    'B.jpg',
    '报告.docx',
    '视频.mp4',
    '音频.mp3',
    '笔记.txt',
    '表格.xlsx',
    '归档.zip',
    '子目录/代码.py',
    '其他目录/记录.md',
  ].entries())
    await fs.writeFile(path.join(root, name), `test-file-${index}`, 'utf8');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(appData, { recursive: true, force: true });
});
describe('read-only filesystem and persistence', () => {
  it('A/B: imports 10 files, organizes, saves/reloads structure and coordinates while disk stays identical', async () => {
    const before = await fingerprint(root);
    const entries = await importPaths(
      root,
      (await listDirectory(root, root)).map((e) => e.path),
    );
    expect(entries.filter((e) => e.entry.kind === 'file')).toHaveLength(10);
    let state = importEntries(workspace(createProject(root)), entries, null);
    state = addFolder(state, '图片', null);
    const folder = Object.values(state.project.nodes).find((n) => n.name === '图片')!;
    state = moveNodes(
      state,
      [fileId(path.join(root, 'A.jpg')), fileId(path.join(root, 'B.jpg'))],
      folder.id,
    );
    state.project.nodes[folder.id].x = 347;
    state.project.nodes[folder.id].y = 198;
    const storage = new ProjectStorage(appData);
    await storage.save(state.project);
    const loaded = await storage.load(state.project.id);
    expect(loaded.nodes).toEqual(state.project.nodes);
    expect((await storage.last())?.id).toBe(loaded.id);
    expect(await fingerprint(root)).toEqual(before);
  });
  it('C: previews real original/target A.jpg paths while original file still exists', async () => {
    let state = importEntries(
      workspace(createProject(root)),
      await importPaths(root, [path.join(root, 'A.jpg'), path.join(root, 'B.jpg')]),
      null,
    );
    state = addFolder(state, '图片', null);
    const folder = Object.values(state.project.nodes).find((n) => n.name === '图片')!;
    state = moveNodes(state, [fileId(path.join(root, 'A.jpg'))], folder.id);
    const preview = await generatePreview(root, state.project);
    const a = preview.changes.find((c) => c.name === 'A.jpg')!;
    expect(a).toMatchObject({
      kind: 'move',
      source: path.join(root, 'A.jpg'),
      target: path.join(root, '图片', 'A.jpg'),
      issues: [],
    });
    expect(preview.unchanged).toBe(1);
    expect(preview.changed).toBe(2);
    expect(await fs.readFile(a.source!, 'utf8')).toBe('test-file-0');
    await expect(fs.stat(a.target)).rejects.toHaveProperty('code', 'ENOENT');
  });
  it('D: checks source deletion, external edits, target collision and non-folder ancestors', async () => {
    let state = importEntries(
      workspace(createProject(root)),
      await importPaths(root, [path.join(root, 'A.jpg')]),
      null,
    );
    state = renameNode(state, fileId(path.join(root, 'A.jpg')), 'B.jpg');
    expect((await generatePreview(root, state.project)).changes[0].issues.join()).toContain(
      '已存在',
    );
    await fs.appendFile(path.join(root, 'A.jpg'), 'changed');
    expect((await generatePreview(root, state.project)).changes[0].issues.join()).toContain(
      '发生变化',
    );
    await fs.unlink(path.join(root, 'A.jpg'));
    expect((await generatePreview(root, state.project)).changes[0].issues.join()).toContain(
      '不存在',
    );
    let second = addFolder(workspace(createProject(root)), '笔记.txt', null);
    const folder = Object.keys(second.project.nodes)[0];
    second = addFolder(second, '子', folder);
    expect(
      (await generatePreview(root, second.project)).changes
        .find((c) => c.name === '子')!
        .issues.join(),
    ).toContain('上级路径是一个文件');
  });
  it('D: denies paths outside root, spoofed IDs, illegal names, and project storage traversal', async () => {
    expect(() => checkPath(root, path.join(root, '..', 'outside'))).toThrow('超出');
    await expect(importPaths(root, [appData])).rejects.toThrow('超出');
    let state = importEntries(
      workspace(createProject(root)),
      await importPaths(root, [path.join(root, 'A.jpg')]),
      null,
    );
    const n = Object.values(state.project.nodes)[0];
    n.source!.path = path.join(root, 'B.jpg');
    await expect(generatePreview(root, state.project)).rejects.toThrow('标识');
    const storage = new ProjectStorage(appData);
    await expect(storage.load('../escape')).rejects.toThrow('ID');
  });
  it('D: refuses a folder tree containing directory junctions without following them', async () => {
    const junction = path.join(root, '联接');
    await fs.symlink(appData, junction, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await listDirectory(root, root)).find((e) => e.name === '联接')?.blocked).toContain(
      '符号链接',
    );
    await expect(importPaths(root, [junction])).rejects.toThrow('符号链接');
    await fs.unlink(junction);
  });
  it('D: reports permission errors and aborts the whole import (deterministic EPERM simulation)', async () => {
    const original = fs.access.bind(fs);
    vi.spyOn(fs, 'access').mockImplementation(async (p, mode) => {
      if (String(p).endsWith('A.jpg')) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return original(p, mode);
    });
    expect((await listDirectory(root, root)).find((e) => e.name === 'A.jpg')?.blocked).toContain(
      '没有访问权限',
    );
    await expect(
      importPaths(root, [path.join(root, 'B.jpg'), path.join(root, 'A.jpg')]),
    ).rejects.toHaveProperty('code', 'EPERM');
    expect(readableError(Object.assign(new Error(), { code: 'EACCES' }))).toContain('没有访问权限');
  });
  it('searches nested entries and deduplicates overlapping folder/file imports', async () => {
    expect((await searchFiles(root, '代码')).entries).toHaveLength(1);
    const items = await importPaths(root, [
      path.join(root, '子目录', '代码.py'),
      path.join(root, '子目录'),
      path.join(root, '子目录'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[1].parentSourceId).toBe(items[0].entry.id);
  });
  it('serializes concurrent project saves and restores the last complete snapshot', async () => {
    const p = createProject(root);
    const storage = new ProjectStorage(appData);
    await Promise.all([storage.save(p), storage.save({ ...p, name: '后一次保存' })]);
    expect((await storage.last())?.name).toBe('后一次保存');
    expect(await storage.list()).toHaveLength(1);
  });
});
