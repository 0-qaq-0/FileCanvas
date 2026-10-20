import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProject, importPaths } from '../../01_源码/electron/filesystem';
import { DiskOperations } from '../../01_源码/electron/disk-operations';
import { hashStats, inventory, inventoryDigest } from '../../01_源码/electron/operation-plan';
import {
  workspace,
  importEntries,
  moveNodes,
  renameNode,
} from '../../01_源码/src/domain/workspace';
import type { Workspace } from '../../01_源码/src/domain/types';

// Regression tests for the 0.4.1 reliability pass: the plan is verified against
// only the paths it touches, content is re-read a bounded number of times, and a
// volume without hard links is refused before a plan can be confirmed.
let base: string, root: string, directory: string, disk: DiskOperations, state: Workspace;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-reliability-'));
  root = path.join(base, '项目');
  directory = path.join(base, '记录');
  await fs.mkdir(path.join(root, '待整理'), { recursive: true });
  await fs.mkdir(path.join(root, '交付'));
  await fs.writeFile(path.join(root, '待整理', '方案.md'), '方案正文，UTF-8');
  await fs.writeFile(path.join(root, '待整理', '说明.txt'), '说明正文');
  await fs.writeFile(path.join(root, '保留.txt'), '不参与整理');
  state = importEntries(
    workspace(createProject(root)),
    await importPaths(root, [path.join(root, '待整理'), path.join(root, '交付')]),
    null,
  );
  disk = new DiskOperations(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(base, { recursive: true, force: true });
});
const node = (name: string) => Object.values(state.project.nodes).find((n) => n.name === name)!;
const planned = () =>
  moveNodes(state, [node('方案.md').id, node('说明.txt').id], node('交付').id).project;
const realLinks = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => !String(c[1]).includes('.filecanvas-probe-')).length;

it('applies and restores while unrelated files appear and change after the preview', async () => {
  const project = planned();
  const preview = await disk.preview(root, project);
  expect(preview.issues).toBe(0);
  await fs.mkdir(path.join(root, '别处'));
  await fs.writeFile(path.join(root, '别处', '~$方案.docx'), 'Office 锁文件');
  await fs.writeFile(path.join(root, '下载中.crdownload'), '已下载一半');
  await fs.writeFile(path.join(root, '交付', '无关新文件.txt'), '落在目标文件夹里的无关文件');
  await fs.writeFile(path.join(root, '保留.txt'), '预览后又编辑了');
  await disk.apply(root, project, preview.planId);
  expect(await fs.readFile(path.join(root, '交付', '方案.md'), 'utf8')).toContain('方案正文');
  await fs.writeFile(path.join(root, '下载中.crdownload'), '已下载更多的内容');
  await disk.undo(root, state.project.id);
  expect(await fs.readFile(path.join(root, '待整理', '方案.md'), 'utf8')).toContain('方案正文');
  expect(await fs.readFile(path.join(root, '别处', '~$方案.docx'), 'utf8')).toBe('Office 锁文件');
  expect(await fs.readFile(path.join(root, '下载中.crdownload'), 'utf8')).toBe('已下载更多的内容');
  expect(await fs.readFile(path.join(root, '交付', '无关新文件.txt'), 'utf8')).toContain('无关');
  expect(await fs.readFile(path.join(root, '保留.txt'), 'utf8')).toBe('预览后又编辑了');
});

it('keeps going when an unrelated file shows up in the middle of applying', async () => {
  const project = planned();
  const preview = await disk.preview(root, project);
  const original = fs.link.bind(fs);
  let count = 0;
  vi.spyOn(fs, 'link').mockImplementation(async (source, target) => {
    const result = await original(source, target);
    if (!String(target).includes('.filecanvas-probe-') && ++count === 3)
      await fs.writeFile(path.join(root, 'Unconfirmed 123.crdownload'), '浏览器正在写入');
    return result;
  });
  await disk.apply(root, project, preview.planId);
  expect(await fs.readdir(path.join(root, '交付'))).toEqual(['方案.md', '说明.txt']);
  expect(await fs.readFile(path.join(root, 'Unconfirmed 123.crdownload'), 'utf8')).toBe(
    '浏览器正在写入',
  );
});

it('still refuses a plan whose own source or target changes after the preview', async () => {
  const project = planned();
  const first = await disk.preview(root, project);
  await fs.writeFile(path.join(root, '交付', '方案.md'), '目标位置被新文件占用');
  await expect(disk.apply(root, project, first.planId)).rejects.toThrow('预览后');
  expect(await fs.readFile(path.join(root, '交付', '方案.md'), 'utf8')).toBe(
    '目标位置被新文件占用',
  );
  await fs.unlink(path.join(root, '交付', '方案.md'));
  const second = await disk.preview(root, project);
  await fs.appendFile(path.join(root, '待整理', '说明.txt'), '，又追加了内容');
  await expect(disk.apply(root, project, second.planId)).rejects.toThrow('预览后');
  expect(await fs.readdir(path.join(root, '交付'))).toEqual([]);
});

it('previews, applies and restores a root with more than 10000 unrelated entries', async () => {
  const bulk = path.join(root, '大量无关文件');
  await fs.mkdir(bulk);
  const total = 10500;
  for (let i = 0; i < total; i += 500)
    await Promise.all(
      Array.from({ length: 500 }, (_, k) => fs.writeFile(path.join(bulk, `f${i + k}.txt`), '')),
    );
  const project = planned();
  const preview = await disk.preview(root, project);
  expect(preview.issues).toBe(0);
  expect(preview.preserved).toBeLessThan(20);
  await disk.apply(root, project, preview.planId);
  await disk.undo(root, state.project.id);
  expect(await fs.readdir(bulk)).toHaveLength(total);
  expect(await fs.readFile(path.join(root, '待整理', '方案.md'), 'utf8')).toContain('方案正文');
}, 60_000);

it('reads each moved file once for the preview and at most once more to verify', async () => {
  const project = planned();
  const files = 2;
  let reads = hashStats.reads;
  const preview = await disk.preview(root, project);
  expect(hashStats.reads - reads).toBe(files);
  reads = hashStats.reads;
  await disk.apply(root, project, preview.planId);
  expect(hashStats.reads - reads).toBeLessThanOrEqual(files);
  reads = hashStats.reads;
  await disk.undo(root, state.project.id);
  expect(hashStats.reads - reads).toBeLessThanOrEqual(files);
});

it('reports an automatic rollback accurately and leaves every original file in place', async () => {
  const project = planned();
  const preview = await disk.preview(root, project);
  const original = fs.link.bind(fs);
  const spy = vi.spyOn(fs, 'link').mockImplementation(async (source, target) => {
    // Links 1-2 create the recovery copies; link 3 is the first final placement.
    if (!String(target).includes('.filecanvas-probe-') && realLinks(spy) === 3)
      throw Object.assign(new Error('injected failure'), { code: 'EPERM' });
    return original(source, target);
  });
  const failure = await disk.apply(root, project, preview.planId).catch((e: Error) => e);
  expect((failure as Error).message).toContain('自动恢复到原位置');
  expect((failure as Error).message).toContain('injected failure');
  expect((failure as Error).message).not.toContain('请查看恢复任务');
  expect(await fs.readFile(path.join(root, '待整理', '方案.md'), 'utf8')).toContain('方案正文');
  expect(await fs.readFile(path.join(root, '待整理', '说明.txt'), 'utf8')).toBe('说明正文');
  expect(await fs.readdir(path.join(root, '交付'))).toEqual([]);
  expect((await disk.status(root, state.project.id))?.needsRecovery).toBe(false);
});

it('refuses to confirm a plan on a volume without hard links, leaving nothing behind', async () => {
  const project = planned();
  const original = fs.link.bind(fs);
  const spy = vi.spyOn(fs, 'link').mockImplementation(async (source, target) => {
    if (String(target).includes('.filecanvas-probe-'))
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    return original(source, target);
  });
  const before = inventoryDigest(await inventory(root));
  const blocked = await disk.preview(root, project);
  expect(blocked.planId).toBeUndefined();
  expect(blocked.issues).toBeGreaterThan(0);
  expect(blocked.changes.flatMap((c) => c.issues).join()).toContain('不支持硬链接');
  await expect(disk.apply(root, project)).rejects.toThrow('预览问题');
  expect(inventoryDigest(await inventory(root))).toBe(before);
  spy.mockRestore();
  const retry = await disk.preview(root, project);
  expect(retry.issues).toBe(0);
  expect(retry.planId).toBeTruthy();
});

it('probes only once per folder and sweeps leftovers from an interrupted probe', async () => {
  const project = planned();
  const original = fs.link.bind(fs);
  const spy = vi.spyOn(fs, 'link').mockImplementation((source, target) => original(source, target));
  await disk.preview(root, project);
  await disk.preview(root, project);
  expect(spy.mock.calls.filter((c) => String(c[1]).includes('.filecanvas-probe-'))).toHaveLength(1);
  const stale = path.join(root, '.filecanvas-probe-11111111-1111-1111-1111-111111111111-a');
  const fresh = path.join(root, '.filecanvas-probe-22222222-2222-2222-2222-222222222222-b');
  await fs.writeFile(stale, 'x');
  await fs.writeFile(fresh, 'x');
  const old = new Date(Date.now() - 5 * 60_000);
  await fs.utimes(stale, old, old);
  await new DiskOperations(directory).reconcile(project);
  await expect(fs.stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fs.stat(fresh)).isFile()).toBe(true);
});

it('applies and restores a case-only folder rename that has files inside', async () => {
  await fs.mkdir(path.join(root, 'Child'));
  await fs.writeFile(path.join(root, 'Child', 'x.txt'), '文件夹里的文件');
  await fs.mkdir(path.join(root, 'Child', 'Inner'));
  await fs.writeFile(path.join(root, 'Child', 'Inner', 'y.txt'), '更深一层');
  state = importEntries(state, await importPaths(root, [path.join(root, 'Child')]), null);
  const before = inventoryDigest(await inventory(root));
  const project = renameNode(state, node('Child').id, 'child').project;
  const preview = await disk.preview(root, project);
  expect(preview.issues).toBe(0);
  await disk.apply(root, project, preview.planId);
  expect(await fs.readdir(root)).toContain('child');
  expect(await fs.readdir(root)).not.toContain('Child');
  expect(await fs.readFile(path.join(root, 'child', 'Inner', 'y.txt'), 'utf8')).toBe('更深一层');
  await disk.undo(root, state.project.id);
  expect(await fs.readdir(root)).toContain('Child');
  expect(await fs.readdir(root)).not.toContain('child');
  expect(inventoryDigest(await inventory(root))).toBe(before);
});
