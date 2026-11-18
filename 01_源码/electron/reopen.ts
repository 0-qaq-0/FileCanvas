import { hasPendingPlan } from '../src/domain/workspace';
import type { Project } from '../src/domain/types';
import type { ProjectStorage } from './storage';
import { prepareRefresh } from './refresh';

/**
 * Opens the newest saved project of a folder again instead of starting another one, so 整理下载
 * clicked every day keeps one project (and its undo record). An unapplied plan comes back as it
 * was; otherwise the project is brought up to date with the folder, like 刷新并核对 would.
 * `open` activates the project (checks and recovery); null when the folder has no project yet.
 *
 * By the time the refresh runs the project is already the active one, so a refresh that fails
 * must not fail the open: the saved project still opens, and the user can refresh it by hand.
 */
export async function reopenSaved(
  storage: ProjectStorage,
  canonicalRoot: string,
  open: (project: Project) => Promise<Project>,
): Promise<Project | null> {
  const newest = (await storage.list()).find(
    (r) => r.rootPath.toLowerCase() === canonicalRoot.toLowerCase(),
  );
  if (!newest) return null;
  const project = await open(await storage.load(newest.id));
  if (hasPendingPlan(project)) return project;
  try {
    const refreshed = (await prepareRefresh(project.rootPath, project)).project;
    await storage.save(refreshed);
    return refreshed;
  } catch {
    return project;
  }
}
