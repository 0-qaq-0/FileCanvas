import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProject, importPaths, listDirectory } from '../../01_源码/electron/filesystem';
import { ProjectStorage } from '../../01_源码/electron/storage';
import { reopenSaved } from '../../01_源码/electron/reopen';
import { prepareRefresh } from '../../01_源码/electron/refresh';
import { addFolder, importEntries, workspace } from '../../01_源码/src/domain/workspace';
import type { Project } from '../../01_源码/src/domain/types';

// Opening 下载 again keeps one project per folder: an unapplied plan comes back untouched,
// otherwise the saved project picks up what changed in the folder.
let base: string, root: string, storage: ProjectStorage;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-reopen-'));
  await fs.mkdir(path.join(base, '下载'));
  root = await fs.realpath(path.join(base, '下载'));
  storage = new ProjectStorage(path.join(base, 'projects'));
  for (const name of ['报告.pdf', 'desktop.ini', '电影.mp4.crdownload'])
    await fs.writeFile(path.join(root, name), name);
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});
async function saved(): Promise<Project> {
  const entries = (await listDirectory(root, root)).filter((e) => !e.blocked);
  const project = importEntries(
    workspace(createProject(root)),
    await importPaths(
      root,
      entries.map((e) => e.path),
    ),
    null,
  ).project;
  await storage.save(project);
  return project;
}
const names = (project: Project) =>
  Object.values(project.nodes)
    .map((n) => n.name)
    .sort();
const open = async (project: Project) => project;

it('has nothing to reopen for a folder without a project', async () => {
  expect(await reopenSaved(storage, root, open)).toBeNull();
});

it('reopens the saved project and adds what is new in the folder', async () => {
  const first = await saved();
  await fs.writeFile(path.join(root, '截图.png'), 'png');
  const again = await reopenSaved(storage, root.toUpperCase(), open);
  expect(again?.id).toBe(first.id);
  expect(names(again!)).toEqual(['截图.png', '报告.pdf'].sort());
  expect(await storage.list()).toHaveLength(1);
  expect(names(await storage.load(first.id))).toEqual(names(again!));
});

it('brings back an unapplied plan as it was', async () => {
  const first = await saved();
  const planned = addFolder(workspace(first), '待整理', null).project;
  await storage.save(planned);
  await fs.writeFile(path.join(root, '截图.png'), 'png');
  const again = await reopenSaved(storage, root, open);
  expect(again).toEqual(planned);
  expect(names(again!)).not.toContain('截图.png');
});

it('does not list system files as skipped when refreshing', async () => {
  const review = await prepareRefresh(root, await saved());
  expect(review.skipped.map((s) => s.name)).toEqual(['电影.mp4.crdownload']);
});
