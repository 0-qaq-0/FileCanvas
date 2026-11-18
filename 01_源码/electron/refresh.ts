import {
  importSummary,
  listDirectory,
  readEntry,
  skippedKind,
  validateAuthorized,
} from './filesystem';
import {
  MAX_NODES,
  importEntries,
  isDescendant,
  validateProject,
  workspace,
} from '../src/domain/workspace';
import type { ImportEntry, Project, RefreshReview } from '../src/domain/types';

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
      // A folder's own time changes whenever something inside it does, which says nothing new.
      const edited =
        node.kind === 'file' &&
        (current.size !== node.source.size || Math.abs(current.mtimeMs - node.source.mtimeMs) > 1);
      if (edited || current.name !== node.source.name)
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
  const roots = await listDirectory(root, root, { cap: true });
  // Windows' own files (desktop.ini) sit in almost every folder and are never organized, so
  // listing them on every refresh would only look like a problem.
  const blocked = roots.filter((e) => e.blocked && skippedKind(e.name) !== 'system');
  const known = new Set(Object.keys(candidate.nodes));
  const summary = await importSummary(
    root,
    roots.filter((e) => !e.blocked).map((e) => e.path),
    { room: MAX_NODES - known.size, known },
  );
  // Items the user took off the canvas stay off, along with what is inside them.
  const left = new Set(project.view?.removedIds ?? []);
  const entries: ImportEntry[] = [];
  for (const item of summary.entries) {
    if (
      !candidate.nodes[item.entry.id] &&
      (left.has(item.entry.id) || (item.parentSourceId && left.has(item.parentSourceId)))
    ) {
      left.add(item.entry.id);
      continue;
    }
    entries.push(item);
  }
  for (const { entry } of entries)
    if (!candidate.nodes[entry.id])
      changes.push({ kind: 'new', path: entry.path, name: entry.name });
  const refreshed = importEntries(workspace(candidate), entries, null).project;
  validateProject(refreshed);
  return {
    project: { ...refreshed, updatedAt: new Date().toISOString() },
    changes,
    skipped: [
      ...blocked.map((e) => ({ path: e.path, name: e.name, reason: e.blocked! })),
      ...(summary.limited
        ? [
            {
              path: root,
              name: '部分文件夹的内容',
              reason: `项目最多容纳 ${MAX_NODES} 个条目，内容较多的文件夹没有完整加入，这些文件夹暂时不能整体移动。`,
            },
          ]
        : []),
    ],
  };
}
