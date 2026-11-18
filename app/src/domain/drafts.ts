import type { CanvasNode, OrganizeRule, Workspace } from './types';
import { addFolder, children, commit, moveNodes, relativeTarget } from './workspace';
import { placeByName, placeFile } from './recipes';
import type { Placement, RecipeId, RecipeOptions } from './recipes';
import { compileRules, placeByRules } from './rules';

// 'custom' is the user's saved rules (see rules.ts); the rest are the built-in recipes.
export type DraftMode = RecipeId | 'custom';
export interface DraftRow {
  id: string;
  name: string;
  // Target folder relative to the current level; a nested path uses "/" (财务/发票).
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
  // The rules for mode 'custom'; list order decides which rule wins.
  rules?: OrganizeRule[];
  // Mode 'type' only: a type with a single file that has no folder on the canvas yet is
  // folded into "其他" (when there is a real group to keep), instead of getting its own
  // one-file folder. Off by default.
  mergeSmall?: boolean;
  // Icons per row when the result is laid out; defaults to a width that grows with the count.
  columns?: number;
}
export interface ClassificationDraft {
  mode: DraftMode;
  rows: DraftRow[];
  groups: DraftGroup[];
  folders: string[];
  issues: string[];
  next: Workspace | null;
}
const MISC_FOLDER = '其他';
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
  let compiled: ReturnType<typeof compileRules> = [];
  if (mode === 'custom') {
    try {
      compiled = compileRules(options.rules ?? []);
    } catch (error) {
      return {
        mode,
        rows: [],
        groups: [],
        folders: [],
        issues: [(error as Error).message],
        next: null,
      };
    }
  }
  const files = children(state.project.nodes, parentId).filter((n) => n.kind === 'file');
  const prefix = parentId ? relativeTarget(state.project.nodes, parentId) : [];
  let everything = files.flatMap((node) => {
    const place =
      mode === 'custom' ? placeByRules(node, compiled, options) : placeFile(node, mode, options);
    return place
      ? [
          {
            id: node.id,
            name: node.name,
            ...place,
            from: relativeTarget(state.project.nodes, node.id).join('/'),
            // Only custom rules produce nested paths ("财务/发票"), one segment per level.
            to: [...prefix, ...place.folder.split('/'), node.name].join('/'),
          },
        ]
      : [];
  });
  // The node a target path leads to, following it one segment at a time (names are
  // compared case-insensitively, like Windows). Returns the file that stands in the way
  // when a segment is taken by a file, and undefined when the path does not exist yet.
  const findPath = (
    nodes: Workspace['project']['nodes'],
    folder: string,
  ): CanvasNode | undefined => {
    let parent = parentId;
    let found: CanvasNode | undefined;
    for (const segment of folder.split('/')) {
      found = children(nodes, parent).find((n) => n.name.toLowerCase() === segment.toLowerCase());
      if (!found || found.kind !== 'folder') return found;
      parent = found.id;
    }
    return found;
  };
  if (mode === 'type' && options.mergeSmall) {
    const byFolder = new Map<string, typeof everything>();
    for (const row of everything)
      byFolder.set(row.folder, [...(byFolder.get(row.folder) ?? []), row]);
    const isSmall = (folder: string, rows: typeof everything) =>
      rows.length === 1 && findPath(state.project.nodes, folder)?.kind !== 'folder';
    const small = [...byFolder].filter(([folder, rows]) => isSmall(folder, rows));
    const hasRealGroup = small.length < byFolder.size;
    const movable = small.filter(([folder]) => folder !== MISC_FOLDER).map(([, rows]) => rows[0]);
    // A lone leftover is not worth a new "其他" folder, unless that folder is coming anyway.
    if (
      hasRealGroup &&
      movable.length &&
      movable.length + (byFolder.get(MISC_FOLDER)?.length ?? 0) >= 2
    ) {
      const ids = new Set(movable.map((row) => row.id));
      everything = everything.map((row) =>
        ids.has(row.id)
          ? {
              ...row,
              folder: MISC_FOLDER,
              reason: `该类型只有 1 个文件，并入“${MISC_FOLDER}”`,
              to: [...prefix, MISC_FOLDER, row.name].join('/'),
            }
          : row,
      );
    }
  }
  const allFolders = [...new Set(everything.map((row) => row.folder))];
  const ruleRank = (folder: string) => compiled.findIndex((c) => c.folder === folder);
  const groups: DraftGroup[] = allFolders
    .map((folder) => ({
      folder,
      existing: findPath(state.project.nodes, folder)?.kind === 'folder',
      rows: everything.filter((row) => row.folder === folder),
    }))
    // Numbered project folders keep their order, months list newest first, type folders
    // put the biggest group on top, and custom rules list in the order they were written.
    .sort((a, b) =>
      mode === 'custom'
        ? ruleRank(a.folder) - ruleRank(b.folder)
        : mode === 'content-project'
          ? a.folder.localeCompare(b.folder, 'zh-CN', { numeric: true })
          : mode === 'month'
            ? b.folder.localeCompare(a.folder, 'zh-CN')
            : // "其他" is the leftovers, so it always comes last.
              Number(a.folder === MISC_FOLDER) - Number(b.folder === MISC_FOLDER) ||
              b.rows.length - a.rows.length ||
              a.folder.localeCompare(b.folder, 'zh-CN'),
    );
  const rows = everything.filter((row) => !excluded.has(row.folder.toLowerCase()));
  // Folders are created in first-appearance order (not display order), so a file that
  // occupies a category name is reported before it gets moved out of the way.
  const folders = allFolders.filter((folder) => !excluded.has(folder.toLowerCase()));
  let candidate = state;
  try {
    for (const folder of folders) {
      // Walk the chain, reusing what exists and creating only the missing folders.
      let parent = parentId;
      for (const segment of folder.split('/')) {
        let target = children(candidate.project.nodes, parent).find(
          (n) => n.name.toLowerCase() === segment.toLowerCase(),
        );
        if (target && target.kind !== 'folder')
          throw new Error(`“${segment}”已被文件占用，请先重命名该文件。`);
        if (!target) {
          candidate = addFolder(candidate, segment, parent);
          target = children(candidate.project.nodes, parent).find((n) => n.name === segment)!;
        }
        parent = target.id;
      }
      candidate = moveNodes(
        candidate,
        rows.filter((r) => r.folder === folder).map((r) => r.id),
        parent!,
      );
    }
    if (rows.length)
      candidate = commit(candidate, '排列分类结果', (nodes) => {
        const visible = children(nodes, parentId).sort((a, b) =>
          a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
        );
        const columns = Math.max(
          1,
          Math.floor(options.columns ?? Math.max(5, Math.ceil(visible.length / 300))),
        );
        visible.forEach((n, i) => {
          n.x = 32 + (i % columns) * 156;
          n.y = 32 + Math.floor(i / columns) * 156;
        });
      });
    const next = rows.length
      ? {
          project: candidate.project,
          past: [
            ...state.past.slice(-79),
            {
              nodes: state.project.nodes,
              canvasGroups: state.project.canvasGroups,
              label: '采用分类草案',
            },
          ],
          future: [],
        }
      : state;
    return { mode, rows, groups, folders, issues: [], next };
  } catch (error) {
    return { mode, rows, groups, folders, issues: [(error as Error).message], next: null };
  }
}
