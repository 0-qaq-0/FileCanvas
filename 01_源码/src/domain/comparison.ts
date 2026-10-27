import type { NodeMap } from './types';
import { relativeTarget } from './workspace';
import { fileInfo } from './file-info';

export interface LevelSummary {
  // Folders directly in the root, with how many files they hold at any depth.
  folders: { name: string; files: number }[];
  // Files lying directly in the root, and their types (most common first).
  loose: string[];
  looseTypes: [string, number][];
  files: number;
}
export interface PlanComparison {
  before: LevelSummary;
  after: LevelSummary;
}

function summarize(paths: { segments: string[]; folder: boolean }[]): LevelSummary {
  const folders = new Map<string, number>();
  const loose: string[] = [];
  let files = 0;
  for (const { segments, folder } of paths) {
    if (!segments.length) continue;
    if (!folder) files++;
    if (segments.length === 1) {
      if (folder) folders.set(segments[0], folders.get(segments[0]) ?? 0);
      else loose.push(segments[0]);
    } else folders.set(segments[0], (folders.get(segments[0]) ?? 0) + (folder ? 0 : 1));
  }
  const types = new Map<string, number>();
  for (const name of loose) {
    const label = fileInfo(name).shortLabel;
    types.set(label, (types.get(label) ?? 0) + 1);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, 'zh-CN', { numeric: true });
  return {
    folders: [...folders]
      .map(([name, count]) => ({ name, files: count }))
      .sort((a, b) => b.files - a.files || byName(a.name, b.name)),
    loose: loose.sort(byName),
    looseTypes: [...types].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])),
    files,
  };
}

/**
 * The root's top level as it is on disk and as the plan will leave it, read from the canvas
 * alone (source paths before, planned paths after). Call it before applying: afterwards the
 * sources already point at the new places. Only what is on the canvas is counted.
 */
export function comparePlan(nodes: NodeMap, rootPath: string): PlanComparison {
  const root = rootPath.replace(/[\\/]+$/, '');
  const prefix = `${root}\\`.toLowerCase();
  const before: { segments: string[]; folder: boolean }[] = [];
  const after: { segments: string[]; folder: boolean }[] = [];
  for (const node of Object.values(nodes)) {
    const folder = node.kind === 'folder';
    after.push({ segments: relativeTarget(nodes, node.id), folder });
    const source = node.source?.path.replace(/\//g, '\\');
    if (source?.toLowerCase().startsWith(prefix))
      before.push({ segments: source.slice(prefix.length).split('\\').filter(Boolean), folder });
  }
  return { before: summarize(before), after: summarize(after) };
}
