import type { NodeMap } from './types';
import { isDescendant, topLevelSelection } from './workspace';

export interface FilterResult {
  // Every node at this level (or below) whose name matches.
  matches: Set<string>;
  // Folders that do not match themselves but contain matches, with how many.
  inside: Map<string, number>;
}
// All space-separated words must appear in the name, ignoring case.
export function matchesQuery(name: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = name.toLowerCase();
  return words.length > 0 && words.every((word) => lower.includes(word));
}
export function filterLayer(
  nodes: NodeMap,
  parentId: string | null,
  query: string,
): FilterResult | null {
  if (!query.trim()) return null;
  const matches = new Set<string>();
  const inside = new Map<string, number>();
  for (const node of Object.values(nodes)) {
    if (parentId && !isDescendant(nodes, node.parentId, parentId)) continue;
    if (!matchesQuery(node.name, query)) continue;
    matches.add(node.id);
    for (let id = node.parentId; id && id !== parentId; id = nodes[id]?.parentId ?? null)
      inside.set(id, (inside.get(id) ?? 0) + 1);
  }
  return { matches, inside };
}
// What "select the matches" should pick: matching folders count once, without
// also selecting the matching files inside them.
export function selectableMatches(nodes: NodeMap, result: FilterResult): string[] {
  return topLevelSelection(nodes, [...result.matches]);
}
