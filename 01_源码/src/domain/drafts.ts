import type { Workspace } from './types';
import { addFolder, children, commit, moveNodes, relativeTarget } from './workspace';
import { placeByName, placeFile } from './recipes';
import type { Placement, RecipeId, RecipeOptions } from './recipes';

export type DraftMode = RecipeId;
export interface DraftRow {
  id: string;
  name: string;
  folder: string;
  reason: string;
  from: string;
  to: string;
}
export interface DraftGroup {
  folder: string;
  // True when the folder is already on the canvas and will simply receive the files.
  existing: boolean;
  rows: DraftRow[];
}
export interface DraftOptions extends RecipeOptions {
  // Target folders the user switched off; their files stay where they are.
  excluded?: string[];
}
export interface ClassificationDraft {
  mode: DraftMode;
  rows: DraftRow[];
  groups: DraftGroup[];
  folders: string[];
  issues: string[];
  next: Workspace | null;
}
export function classify(name: string, mode: 'type' | 'content-project'): Placement {
  return placeByName(name, mode);
}
export function buildClassificationDraft(
  state: Workspace,
  parentId: string | null,
  mode: DraftMode,
  options: DraftOptions = {},
): ClassificationDraft {
  const excluded = new Set((options.excluded ?? []).map((name) => name.toLowerCase()));
  const files = children(state.project.nodes, parentId).filter((n) => n.kind === 'file');
  const prefix = parentId ? relativeTarget(state.project.nodes, parentId) : [];
  const everything = files.flatMap((node) => {
    const place = placeFile(node, mode, options);
    return place
      ? [
          {
            id: node.id,
            name: node.name,
            ...place,
            from: relativeTarget(state.project.nodes, node.id).join('/'),
            to: [...prefix, place.folder, node.name].join('/'),
          },
        ]
      : [];
  });
  const existingFolder = (nodes: Workspace['project']['nodes'], folder: string) =>
    children(nodes, parentId).find((n) => n.name.toLowerCase() === folder.toLowerCase());
  const allFolders = [...new Set(everything.map((row) => row.folder))];
  const groups: DraftGroup[] = allFolders
    .map((folder) => ({
      folder,
      existing: existingFolder(state.project.nodes, folder)?.kind === 'folder',
      rows: everything.filter((row) => row.folder === folder),
    }))
    // Numbered project folders keep their order, months list newest first, and
    // type folders put the biggest group on top.
    .sort((a, b) =>
      mode === 'content-project'
        ? a.folder.localeCompare(b.folder, 'zh-CN', { numeric: true })
        : mode === 'month'
          ? b.folder.localeCompare(a.folder)
          : b.rows.length - a.rows.length || a.folder.localeCompare(b.folder, 'zh-CN'),
    );
  const rows = everything.filter((row) => !excluded.has(row.folder.toLowerCase()));
  // Folders are created in first-appearance order (not display order), so a file that
  // occupies a category name is reported before it gets moved out of the way.
  const folders = allFolders.filter((folder) => !excluded.has(folder.toLowerCase()));
  let candidate = state;
  try {
    for (const folder of folders) {
      let target = existingFolder(candidate.project.nodes, folder);
      if (target && target.kind !== 'folder')
        throw new Error(`“${folder}”已被文件占用，请先重命名该文件。`);
      if (!target) {
        candidate = addFolder(candidate, folder, parentId);
        target = children(candidate.project.nodes, parentId).find((n) => n.name === folder)!;
      }
      candidate = moveNodes(
        candidate,
        rows.filter((r) => r.folder === folder).map((r) => r.id),
        target.id,
      );
    }
    if (rows.length)
      candidate = commit(candidate, '排列分类结果', (nodes) => {
        const visible = children(nodes, parentId).sort((a, b) =>
          a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
        );
        const columns = Math.max(5, Math.ceil(visible.length / 300));
        visible.forEach((n, i) => {
          n.x = 32 + (i % columns) * 156;
          n.y = 32 + Math.floor(i / columns) * 156;
        });
      });
    const next = rows.length
      ? {
          project: candidate.project,
          past: [...state.past.slice(-79), { nodes: state.project.nodes, label: '采用分类草案' }],
          future: [],
        }
      : state;
    return { mode, rows, groups, folders, issues: [], next };
  } catch (error) {
    return { mode, rows, groups, folders, issues: [(error as Error).message], next: null };
  }
}
