import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProject, importPaths, generatePreview } from '../../01_源码/electron/filesystem';
import { DiskOperations } from '../../01_源码/electron/disk-operations';
import { inventory, inventoryDigest, hashFile } from '../../01_源码/electron/operation-plan';
import {
  workspace,
  importEntries,
  moveNodes,
  renameNode,
} from '../../01_源码/src/domain/workspace';
import type { Workspace } from '../../01_源码/src/domain/types';
import { prepareRefresh } from '../../01_源码/electron/refresh';

let base: string, root: string, directory: string, disk: DiskOperations, state: Workspace;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-product-unit-'));
  root = path.join(base, '项目');
  directory = path.join(base, '记录');
  await fs.mkdir(path.join(root, '待整理', '子目录'), { recursive: true });
  await fs.mkdir(path.join(root, '交付'));
  await fs.writeFile(path.join(root, '待整理', '子目录', 'Example.txt'), '真实文件内容，UTF-8');
  await fs.writeFile(path.join(root, '保留.txt'), '不参与整理');
  state = importEntries(
    workspace(createProject(root)),
    await importPaths(root, [path.join(root, '待整理'), path.join(root, '交付')]),
    null,
  );
  disk = new DiskOperations(directory);
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});
const node = (name: string) => Object.values(state.project.nodes).find((n) => n.name === name)!;

it('applies a folder move and a child rename, verifies the entire directory and restores it', async () => {
  const before = inventoryDigest(await inventory(root));
  let next = moveNodes(state, [node('待整理').id], node('交付').id);
  next = renameNode(next, node('Example.txt').id, '改名.txt');
  expect((await generatePreview(root, next.project)).issues).toBe(0);
  const preview = await disk.preview(root, next.project);
  const result = await disk.apply(root, next.project, preview.planId);
  expect(
    await fs.readFile(path.join(root, '交付', '待整理', '子目录', '改名.txt'), 'utf8'),
  ).toContain('真实文件内容');
  expect((await generatePreview(root, result.project)).changed).toBe(0);
  expect(await fs.readdir(root)).not.toContain('待整理');
  await disk.undo(root, state.project.id);
  expect(inventoryDigest(await inventory(root))).toBe(before);
});
it('handles nested folder rename with a child moved out to another existing directory', async () => {
  const baseline = inventoryDigest(await inventory(root));
  let next = renameNode(state, node('待整理').id, '新项目');
  next = moveNodes(next, [node('Example.txt').id], node('交付').id);
  await disk.apply(root, next.project);
  expect(await fs.readdir(path.join(root, '新项目', '子目录'))).toEqual([]);
  expect(await fs.readFile(path.join(root, '交付', 'Example.txt'), 'utf8')).toContain('UTF-8');
  await disk.undo(root, state.project.id);
  expect(inventoryDigest(await inventory(root))).toBe(baseline);
});
it('changes only the case of a filename and folder name and restores the exact casing', async () => {
  const baseline = inventoryDigest(await inventory(root));
  let next = renameNode(state, node('Example.txt').id, 'example.txt');
  next = renameNode(next, node('子目录').id, 'Child');
  const result = await disk.apply(root, next.project);
  expect(await fs.readdir(path.join(root, '待整理', 'Child'))).toEqual(['example.txt']);
  expect((await generatePreview(root, result.project)).issues).toBe(0);
  await disk.undo(root, state.project.id);
  expect(inventoryDigest(await inventory(root))).toBe(baseline);
});
it('rejects incomplete subtrees during preview and leaves every file untouched', async () => {
  await fs.writeFile(path.join(root, '待整理', '新加入.txt'), '外部新文件');
  const next = moveNodes(state, [node('待整理').id], node('交付').id);
  const preview = await disk.preview(root, next.project);
  expect(preview.issues).toBeGreaterThan(0);
  expect(preview.changes.flatMap((c) => c.issues).join()).toContain('未加入画布');
  await expect(disk.apply(root, next.project)).rejects.toThrow('冲突');
  expect(await fs.readFile(path.join(root, '待整理', '新加入.txt'), 'utf8')).toBe('外部新文件');
});
it('rejects a stale plan when the workspace or a file changes after confirmation preview', async () => {
  const next = moveNodes(state, [node('Example.txt').id], node('交付').id).project;
  const preview = await disk.preview(root, next);
  await expect(disk.apply(root, { ...next, name: '已修改草案' }, preview.planId)).rejects.toThrow(
    '计划',
  );
  await fs.writeFile(path.join(root, '保留.txt'), '外部编辑');
  await expect(disk.apply(root, next, preview.planId)).rejects.toThrow('预览后');
});
it('retains history and rebuilds the committed project after project-save interruption', async () => {
  const next = moveNodes(state, [node('Example.txt').id], node('交付').id).project;
  const first = await disk.apply(root, next);
  const reopened = new DiskOperations(directory);
  expect((await reopened.reconcile(next)).nodes).toEqual(first.project.nodes);
  await reopened.acknowledge(root, next.id);
  expect(await reopened.reconcile(next)).toEqual(next);
  state = workspace(first.project);
  const second = renameNode(state, node('Example.txt').id, '第二次.txt').project;
  await reopened.apply(root, second);
  expect((await fs.readdir(path.join(directory, 'history'))).length).toBe(1);
});
it('migrates a legacy interrupted planned move and removes its unrecorded extra hard link', async () => {
  const file = node('Example.txt'),
    source = file.source!.path,
    target = path.join(root, '交付', file.name);
  await fs.link(source, target);
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(directory, `${state.project.id}.json`),
    JSON.stringify({
      id: 'legacy-test',
      root,
      projectId: state.project.id,
      status: 'applying',
      before: state.project,
      moves: [{ source, target, sha256: await hashFile(source), status: 'planned' }],
      directories: [],
      createdAt: new Date().toISOString(),
    }),
  );
  await disk.undo(root, state.project.id);
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(source, 'utf8')).toContain('真实文件');
  expect((await fs.readdir(directory)).some((n) => n.endsWith('.v1-backup'))).toBe(true);
});
it('migrates a legacy interrupted undo whose source was restored before the log was updated', async () => {
  const source = node('Example.txt').source!.path,
    target = path.join(root, '交付', 'Example.txt');
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(directory, `${state.project.id}.json`),
    JSON.stringify({
      id: 'legacy-undo',
      root,
      projectId: state.project.id,
      status: 'applied',
      before: state.project,
      moves: [{ source, target, sha256: await hashFile(source), status: 'moved' }],
      directories: [],
      createdAt: new Date().toISOString(),
    }),
  );
  await disk.undo(root, state.project.id);
  expect(await disk.available(root, state.project.id)).toBe(false);
});
it('preserves unrelated edits and new files when restoring a previously completed operation', async () => {
  const next = moveNodes(state, [node('待整理').id], node('交付').id).project;
  await disk.apply(root, next);
  await fs.writeFile(path.join(root, '保留.txt'), '整理完成后继续编辑');
  await fs.writeFile(path.join(root, '交付', '待整理', '新文件.txt'), '用户新增的内容');
  await disk.undo(root, state.project.id);
  expect(await fs.readFile(path.join(root, '保留.txt'), 'utf8')).toBe('整理完成后继续编辑');
  expect(await fs.readFile(path.join(root, '交付', '待整理', '新文件.txt'), 'utf8')).toBe(
    '用户新增的内容',
  );
  expect(await fs.readFile(path.join(root, '待整理', '子目录', 'Example.txt'), 'utf8')).toContain(
    '真实文件',
  );
});
it('refreshes changed metadata and new files while preserving the planned file destination', async () => {
  const file = node('Example.txt');
  const next = moveNodes(state, [file.id], node('交付').id).project;
  await fs.writeFile(file.source!.path, '在系统编辑器中新写的内容');
  await fs.writeFile(path.join(root, '新增.txt'), '新增');
  const review = await prepareRefresh(root, next);
  expect(review.changes.some((c) => c.kind === 'modified')).toBe(true);
  expect(review.changes.some((c) => c.kind === 'new' && c.name === '新增.txt')).toBe(true);
  expect(review.project.nodes[file.id].parentId).toBe(next.nodes[file.id].parentId);
  const result = await disk.apply(root, review.project);
  expect((await generatePreview(root, result.project)).issues).toBe(0);
});
it('refreshes a missing nested subtree without leaving dangling parent references', async () => {
  await fs.rm(path.join(root, '待整理'), { recursive: true });
  const review = await prepareRefresh(root, state.project);
  expect(review.changes.filter((c) => c.kind === 'missing')).toHaveLength(3);
  expect(Object.values(review.project.nodes).some((n) => n.name === 'Example.txt')).toBe(false);
});
