import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProject, importPaths, generatePreview } from '../../app/electron/filesystem';
import { DiskOperations } from '../../app/electron/disk-operations';
import { inventory, inventoryDigest } from '../../app/electron/operation-plan';
import { workspace, importEntries, moveNodes } from '../../app/src/domain/workspace';
import type { Workspace } from '../../app/src/domain/types';

// Windows keeps desktop.ini / Thumbs.db in many folders. They never reach the canvas, but a
// moved folder takes them along; Office lock files and unfinished downloads hold the folder back.
let base: string, root: string, disk: DiskOperations;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-system-files-'));
  root = path.join(base, '下载');
  await fs.mkdir(path.join(root, '照片', '旅行'), { recursive: true });
  await fs.mkdir(path.join(root, '归档'));
  await fs.mkdir(path.join(root, '精选'));
  await fs.writeFile(path.join(root, '照片', 'a.jpg'), '照片内容');
  await fs.writeFile(path.join(root, '照片', 'Thumbs.db'), '缩略图缓存');
  await fs.writeFile(path.join(root, '照片', 'desktop.ini'), '[.ShellClassInfo]');
  await fs.writeFile(path.join(root, '照片', '旅行', 'b.jpg'), '旅行照片');
  await fs.writeFile(path.join(root, '照片', '旅行', 'Thumbs.db'), '旅行缩略图');
  disk = new DiskOperations(path.join(base, '记录'));
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});
async function load(): Promise<Workspace> {
  const top = ['照片', '归档', '精选'].map((name) => path.join(root, name));
  return importEntries(workspace(createProject(root)), await importPaths(root, top), null);
}
const id = (state: Workspace, name: string) =>
  Object.values(state.project.nodes).find((n) => n.name === name)!.id;

it('keeps system files off the canvas', async () => {
  const names = Object.values((await load()).project.nodes).map((n) => n.name);
  expect(names).not.toContain('Thumbs.db');
  expect(names).not.toContain('desktop.ini');
});

it('moves system files along with their folder, verifies them and restores them', async () => {
  const before = inventoryDigest(await inventory(root));
  const state = await load();
  const next = moveNodes(state, [id(state, '照片')], id(state, '归档'));
  const preview = await disk.preview(root, next.project);
  expect(preview.issues).toBe(0);
  expect(preview.companions?.map((c) => path.basename(c.source)).sort()).toEqual([
    'Thumbs.db',
    'Thumbs.db',
    'desktop.ini',
  ]);
  await disk.apply(root, next.project, preview.planId);
  const moved = path.join(root, '归档', '照片');
  expect(await fs.readFile(path.join(moved, 'Thumbs.db'), 'utf8')).toBe('缩略图缓存');
  expect(await fs.readFile(path.join(moved, 'desktop.ini'), 'utf8')).toBe('[.ShellClassInfo]');
  expect(await fs.readFile(path.join(moved, '旅行', 'Thumbs.db'), 'utf8')).toBe('旅行缩略图');
  expect(await fs.readdir(root)).not.toContain('照片');
  await disk.undo(root, state.project.id);
  expect(inventoryDigest(await inventory(root))).toBe(before);
});

it('sends a system file with its own folder when a subfolder moves elsewhere', async () => {
  const state = await load();
  let next = moveNodes(state, [id(state, '照片')], id(state, '归档'));
  next = moveNodes(next, [id(next, '旅行')], id(next, '精选'));
  const preview = await disk.preview(root, next.project);
  expect(preview.issues).toBe(0);
  await disk.apply(root, next.project, preview.planId);
  expect(await fs.readFile(path.join(root, '精选', '旅行', 'Thumbs.db'), 'utf8')).toBe(
    '旅行缩略图',
  );
  expect(await fs.readFile(path.join(root, '归档', '照片', 'Thumbs.db'), 'utf8')).toBe(
    '缩略图缓存',
  );
  expect(await fs.readdir(path.join(root, '归档', '照片'))).not.toContain('旅行');
});

it('holds a folder back while Office or a download still uses a file in it', async () => {
  await fs.writeFile(path.join(root, '照片', '~$报告.docx'), '锁');
  await fs.writeFile(path.join(root, '照片', '旅行', '视频.mp4.crdownload'), '下载中');
  const state = await load();
  const next = moveNodes(state, [id(state, '照片'), id(state, '旅行')], id(state, '归档'));
  const preview = await generatePreview(root, next.project);
  const issues = (name: string) => preview.changes.find((c) => c.name === name)!.issues.join();
  expect(issues('照片')).toMatch(/“~\$报告\.docx”是 Office 正在使用的临时文件/);
  expect(issues('旅行')).toMatch(/“视频\.mp4\.crdownload”还在下载/);
  await expect(disk.apply(root, next.project)).rejects.toThrow();
  expect(await fs.readdir(path.join(root, '照片'))).toContain('Thumbs.db');
});
