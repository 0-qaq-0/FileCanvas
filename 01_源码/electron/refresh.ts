import { importPaths, listDirectory, readEntry, validateAuthorized } from './filesystem';
import { importEntries, isDescendant, validateProject, workspace } from '../src/domain/workspace';
import type { Project, RefreshReview } from '../src/domain/types';

export async function prepareRefresh(root: string, project: Project): Promise<RefreshReview> {
  validateAuthorized(project, root);
  const candidate = structuredClone(project),
    changes: RefreshReview['changes'] = [];
  const missing = new Set<string>();
  for (const node of Object.values(candidate.nodes)) {
    if (!node.source) continue;
    try {
      const current = await readEntry(root, node.source.path);
      if (current.kind !== node.kind) throw new Error('文件类型已改变');
      if (
        current.size !== node.source.size ||
        Math.abs(current.mtimeMs - node.source.mtimeMs) > 1 ||
        current.name !== node.source.name
      )
        changes.push({ kind: 'modified', path: current.path, name: node.name });
      if (node.name === node.source.name) node.name = current.name;
      node.source = current;
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code !== 'ENOENT' &&
        (e as Error).message !== '文件类型已改变'
      )
        throw e;
      missing.add(node.id);
    }
  }
  const removed = Object.values(candidate.nodes).filter((node) =>
    [...missing].some((id) => isDescendant(candidate.nodes, node.id, id)),
  );
  for (const node of removed) {
    changes.push({ kind: 'missing', path: node.source?.path ?? node.name, name: node.name });
    delete candidate.nodes[node.id];
  }
  const roots = await listDirectory(root, root);
  const blocked = roots.filter((e) => e.blocked);
  const entries = await importPaths(
    root,
    roots.filter((e) => !e.blocked).map((e) => e.path),
  );
  for (const { entry } of entries)
    if (!candidate.nodes[entry.id])
      changes.push({ kind: 'new', path: entry.path, name: entry.name });
  const refreshed = importEntries(workspace(candidate), entries, null).project;
  validateProject(refreshed);
  return {
    project: { ...refreshed, updatedAt: new Date().toISOString() },
    changes,
    skipped: blocked.map((e) => ({ path: e.path, name: e.name, reason: e.blocked! })),
  };
}
