import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expandedLayout, folderAt } from '../../01_源码/src/domain/canvas-layout';
import {
  workspace,
  importEntries,
  moveNodes,
  addFolder,
  undo,
} from '../../01_源码/src/domain/workspace';
import { createProject, importPaths, generatePreview } from '../../01_源码/electron/filesystem';
import { DiskOperations } from '../../01_源码/electron/disk-operations';
import { applyFileAdvice } from '../../01_源码/src/domain/file-advice';
import type { FileAdvice } from '../../01_源码/src/domain/types';
let base: string, root: string, disk: DiskOperations;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-expanded-unit-'));
  root = path.join(base, '项目');
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, '待整理'));
  await fs.mkdir(path.join(root, '交付'));
  await fs.mkdir(path.join(root, '待整理', '子目录'));
  await fs.writeFile(path.join(root, '待整理', '方案.md'), '拍摄方案：校园照片三张。');
  await fs.writeFile(path.join(root, '待整理', '说明.txt'), '交付 JPG');
  await fs.writeFile(path.join(root, '待整理', '子目录', '引用.txt'), '引用拍摄方案。');
  disk = new DiskOperations(path.join(base, '记录'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(base, { recursive: true, force: true });
});
async function state() {
  return importEntries(
    workspace(createProject(root)),
    await importPaths(root, [path.join(root, '待整理'), path.join(root, '交付')]),
    null,
  );
}
it('lays out several expanded and nested containers without overlapping roots and resolves the innermost legal drop target', async () => {
  const s = await state(),
    ns = Object.values(s.project.nodes),
    a = ns.find((n) => n.name === '待整理')!,
    b = ns.find((n) => n.name === '交付')!,
    nested = ns.find((n) => n.name === '子目录')!,
    file = ns.find((n) => n.name === '方案.md')!;
  const layout = expandedLayout(s.project.nodes, null, new Set([a.id, b.id, nested.id]), 1000);
  expect(layout).toHaveLength(ns.length);
  const r = layout.find((r) => r.id === nested.id)!;
  expect(folderAt(s.project.nodes, layout, { x: r.x + 30, y: r.y + 60 }, [file.id])).toBe(
    nested.id,
  );
  expect(folderAt(s.project.nodes, layout, { x: r.x + 30, y: r.y + 60 }, [a.id])).not.toBe(
    nested.id,
  );
  for (const child of layout.filter((r) => s.project.nodes[r.id].parentId)) {
    const parent = layout.find((r) => r.id === s.project.nodes[child.id].parentId)!;
    expect(child.x).toBeGreaterThan(parent.x);
    expect(child.y).toBeGreaterThan(parent.y + 40);
    expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
    expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
  }
});
it('adopts a single-file recommendation and reverses virtual changes without deleting any file', async () => {
  const s = await state(),
    file = Object.values(s.project.nodes).find((n) => n.name === '方案.md')!;
  const advice: FileAdvice = {
    purpose: '方案',
    contents: [],
    projectRole: '执行',
    action: 'move',
    destinationId: null,
    newFolder: '项目资料',
    reason: '用途',
    sources: [],
    readBody: true,
  };
  const next = applyFileAdvice(s, file.id, advice);
  expect(next.project.nodes[file.id].parentId).not.toBe(file.parentId);
  expect(undo(next).project.nodes).toEqual(s.project.nodes);
  const marked = applyFileAdvice(s, file.id, { ...advice, action: 'review-delete' });
  expect(marked.project.nodes[file.id].reviewDelete).toBe(true);
  const kept = applyFileAdvice(marked, file.id, { ...advice, action: 'keep' });
  expect(kept.project.nodes[file.id].reviewDelete).toBe(false);
  expect(await fs.readFile(file.source!.path, 'utf8')).toContain('校园照片');
});
it('actually moves files, saves a persistent undo journal, rebases source IDs and restores original paths', async () => {
  const s = await state(),
    ns = Object.values(s.project.nodes),
    file = ns.find((n) => n.name === '方案.md')!,
    folder = ns.find((n) => n.name === '交付')!;
  const planned = moveNodes(s, [file.id], folder.id).project;
  const result = await disk.apply(root, planned);
  expect(result.moved).toBe(1);
  expect(await fs.readFile(path.join(root, '交付', file.name), 'utf8')).toContain('校园照片');
  await expect(fs.stat(file.source!.path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await generatePreview(root, result.project)).changed).toBe(0);
  expect((await generatePreview(root, result.project)).issues).toBe(0);
  const reopened = new DiskOperations(path.join(base, '记录'));
  expect(await reopened.available(root, s.project.id)).toBe(true);
  const restored = await reopened.undo(root, s.project.id);
  expect(await fs.readFile(file.source!.path, 'utf8')).toContain('校园照片');
  expect((await generatePreview(root, restored)).changed).toBe(0);
  expect((await generatePreview(root, restored)).issues).toBe(0);
  expect(await reopened.available(root, s.project.id)).toBe(false);
});
it('creates a new classification directory and removes only that empty directory when undoing', async () => {
  const s = await state(),
    file = Object.values(s.project.nodes).find((n) => n.name === '方案.md')!;
  const withFolder = addFolder(s, '新分类', null),
    folder = Object.values(withFolder.project.nodes).find((n) => n.name === '新分类')!;
  await disk.apply(root, moveNodes(withFolder, [file.id], folder.id).project);
  await disk.undo(root, s.project.id);
  await expect(fs.stat(path.join(root, '新分类'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(file.source!.path, 'utf8')).toContain('校园照片');
});
it('rejects existing targets and changed files during undo, with no overwrite', async () => {
  const s = await state(),
    ns = Object.values(s.project.nodes),
    file = ns.find((n) => n.name === '方案.md')!,
    folder = ns.find((n) => n.name === '交付')!,
    target = path.join(root, '交付', file.name);
  const planned = moveNodes(s, [file.id], folder.id).project;
  await fs.writeFile(target, '已有文件');
  await expect(disk.apply(root, planned)).rejects.toThrow('冲突');
  expect(await fs.readFile(target, 'utf8')).toBe('已有文件');
  await fs.unlink(target);
  await disk.apply(root, planned);
  await fs.writeFile(target, '用户后来编辑的内容');
  await expect(disk.undo(root, s.project.id)).rejects.toThrow('修改');
  expect(await fs.readFile(target, 'utf8')).toBe('用户后来编辑的内容');
});
it('rolls back completed moves if a later move fails, preserving all original content', async () => {
  const s = await state(),
    ns = Object.values(s.project.nodes),
    ids = ns.filter((n) => ['方案.md', '说明.txt'].includes(n.name)).map((n) => n.id),
    folder = ns.find((n) => n.name === '交付')!;
  const original = fs.link.bind(fs);
  let count = 0;
  vi.spyOn(fs, 'link').mockImplementation(async (source, target) => {
    if (++count === 2) throw Object.assign(new Error('injected failure'), { code: 'EPERM' });
    return original(source, target);
  });
  await expect(disk.apply(root, moveNodes(s, ids, folder.id).project)).rejects.toThrow(
    'injected failure',
  );
  expect(await fs.readFile(path.join(root, '待整理', '方案.md'), 'utf8')).toContain('校园照片');
  expect(await fs.readFile(path.join(root, '待整理', '说明.txt'), 'utf8')).toBe('交付 JPG');
  expect(await fs.readdir(path.join(root, '交付'))).toEqual([]);
});
