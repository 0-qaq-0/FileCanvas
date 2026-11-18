import type { CanvasGroup, CanvasNode, ImportEntry, NodeMap, Project, Workspace } from './types';

export const MAX_NODES = 5000;
// One apply handles everything a project can hold, so a whole folder never has to be split up.
export const MAX_APPLY_FILES = MAX_NODES;
export function validateName(name: string): void {
  if (
    !name ||
    name.length > 200 ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error('名称不合法：请使用 1–200 个字符，避免 \\ / : * ? " < > |、末尾空格或句点。');
  }
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
    throw new Error('这是 Windows 保留名称，请换一个名称。');
}
export function isDescendant(nodes: NodeMap, candidate: string | null, ancestor: string): boolean {
  const visited = new Set<string>();
  while (candidate) {
    if (candidate === ancestor) return true;
    if (visited.has(candidate)) throw new Error('检测到循环文件夹。');
    visited.add(candidate);
    candidate = nodes[candidate]?.parentId ?? null;
  }
  return false;
}
export function validateNodes(nodes: NodeMap): void {
  if (
    !nodes ||
    typeof nodes !== 'object' ||
    Array.isArray(nodes) ||
    Object.keys(nodes).length > MAX_NODES
  )
    throw new Error('项目内容无效或超过 5000 个条目。');
  const siblings = new Set<string>();
  const sources = new Set<string>();
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || id !== node.id || !/^[a-zA-Z0-9-]{1,100}$/.test(id))
      throw new Error('条目标识无效。');
    validateName(node.name);
    if (
      !['file', 'folder'].includes(node.kind) ||
      (node.parentId !== null && typeof node.parentId !== 'string')
    )
      throw new Error('条目类型无效。');
    if (
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y) ||
      node.x < 0 ||
      node.y < 0 ||
      node.x > 50000 ||
      node.y > 50000
    )
      throw new Error('布局坐标无效。');
    if (node.parentId && nodes[node.parentId]?.kind !== 'folder')
      throw new Error('父文件夹不存在。');
    if (isDescendant(nodes, node.parentId, id))
      throw new Error('不能把文件夹放入自己或自己的子文件夹。');
    const key = `${node.parentId ?? ''}\0${node.name.toLowerCase()}`;
    if (siblings.has(key))
      throw new Error(`同一文件夹内已存在“${node.name}”（Windows 不区分大小写）。`);
    siblings.add(key);
    if (node.source) {
      if (
        typeof node.source.path !== 'string' ||
        node.source.id !== id ||
        node.source.kind !== node.kind ||
        node.source.blocked ||
        !Number.isFinite(node.source.size) ||
        !Number.isFinite(node.source.mtimeMs)
      )
        throw new Error('原始文件信息无效。');
      const sourceKey = node.source.path.toLowerCase();
      if (sources.has(sourceKey)) throw new Error('同一原始文件不能重复加入。');
      sources.add(sourceKey);
    } else if (node.kind !== 'folder') throw new Error('文件必须关联一个真实源文件。');
  }
}
export function validateProject(project: Project): void {
  if (
    !project ||
    project.version !== 1 ||
    typeof project.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(project.id) ||
    typeof project.rootPath !== 'string' ||
    typeof project.name !== 'string'
  )
    throw new Error('不是有效的 FileCanvas 项目。');
  validateNodes(project.nodes);
  validateCanvasGroups(project.canvasGroups);
  if (project.view) {
    const view = project.view;
    if (
      typeof view !== 'object' ||
      (view.expandedIds !== undefined &&
        (!Array.isArray(view.expandedIds) ||
          view.expandedIds.length > MAX_NODES ||
          view.expandedIds.some((id) => typeof id !== 'string'))) ||
      (view.parentId !== undefined &&
        view.parentId !== null &&
        typeof view.parentId !== 'string') ||
      (view.removedIds !== undefined &&
        (!Array.isArray(view.removedIds) ||
          view.removedIds.length > MAX_NODES ||
          view.removedIds.some((id) => typeof id !== 'string'))) ||
      (view.showBrowser !== undefined && typeof view.showBrowser !== 'boolean') ||
      (view.focused !== undefined && typeof view.focused !== 'boolean')
    )
      throw new Error('项目视图设置无效。');
  }
}
export function workspace(project: Project): Workspace {
  return { project, past: [], future: [] };
}
function validateCanvasGroups(groups: CanvasGroup[] | undefined) {
  if (groups === undefined) return;
  if (!Array.isArray(groups) || groups.length > MAX_NODES) throw new Error('文件集数量无效。');
  const ids = new Set<string>();
  let total = 0;
  for (const group of groups) {
    if (
      !group ||
      typeof group.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(group.id) ||
      ids.has(group.id) ||
      typeof group.name !== 'string' ||
      !Array.isArray(group.files)
    )
      throw new Error('文件集内容无效。');
    validateName(group.name);
    ids.add(group.id);
    total += group.files.length;
    if (total > MAX_NODES) throw new Error(`文件集最多保存 ${MAX_NODES} 个文件关联。`);
    const paths = new Set<string>();
    for (const file of group.files) {
      if (typeof file !== 'string' || !file || file.includes('\0') || paths.has(file.toLowerCase()))
        throw new Error('文件集的文件路径无效。');
      paths.add(file.toLowerCase());
    }
  }
}

function canvasSnapshot(project: Project, label: string) {
  return { nodes: project.nodes, canvasGroups: project.canvasGroups, label };
}

function commitCanvas(state: Workspace, label: string, changes: Partial<Project>): Workspace {
  return {
    project: { ...state.project, ...changes, updatedAt: new Date().toISOString() },
    past: [...state.past.slice(-79), canvasSnapshot(state.project, label)],
    future: [],
  };
}

export function editCanvasGroups(
  state: Workspace,
  label: string,
  update: (groups: CanvasGroup[]) => CanvasGroup[],
): Workspace {
  const previous = state.project.canvasGroups ?? [];
  const canvasGroups = update(previous);
  if (JSON.stringify(canvasGroups) === JSON.stringify(previous)) return state;
  validateCanvasGroups(canvasGroups);
  return commitCanvas(state, label, { canvasGroups });
}

export function uniqueGroupFiles(files: string[]): string[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = file.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Lower-cased file path → names of the sets that hold it. */
export function groupMembership(groups: CanvasGroup[] | undefined): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const group of groups ?? [])
    for (const file of group.files) {
      const key = file.toLowerCase();
      result.set(key, [...(result.get(key) ?? []), group.name]);
    }
  return result;
}

export function remapCanvasGroups(groups: CanvasGroup[] | undefined, paths: Map<string, string>) {
  return groups?.map((group) => ({
    ...group,
    files: uniqueGroupFiles(group.files.map((file) => paths.get(file.toLowerCase()) ?? file)),
  }));
}

export function commit(
  state: Workspace,
  label: string,
  update: (nodes: NodeMap) => void,
): Workspace {
  const nodes: NodeMap = structuredClone(state.project.nodes);
  update(nodes);
  validateNodes(nodes);
  if (JSON.stringify(nodes) === JSON.stringify(state.project.nodes)) return state;
  return commitCanvas(state, label, { nodes });
}
export function undo(state: Workspace): Workspace {
  const last = state.past.at(-1);
  if (!last) return state;
  return {
    project: {
      ...state.project,
      nodes: last.nodes,
      canvasGroups: last.canvasGroups,
      updatedAt: new Date().toISOString(),
    },
    past: state.past.slice(0, -1),
    future: [...state.future, canvasSnapshot(state.project, last.label)],
  };
}
export function redo(state: Workspace): Workspace {
  const last = state.future.at(-1);
  if (!last) return state;
  return {
    project: {
      ...state.project,
      nodes: last.nodes,
      canvasGroups: last.canvasGroups,
      updatedAt: new Date().toISOString(),
    },
    past: [...state.past, canvasSnapshot(state.project, last.label)],
    future: state.future.slice(0, -1),
  };
}
/**
 * Items the plan still has to change on disk: new folders and anything placed or named differently.
 * The comparison is exact, like the preview's, because a case-only rename is a real change.
 */
export function pendingNodes(project: Project): CanvasNode[] {
  const root = project.rootPath.replace(/[\\/]+$/, '');
  return Object.values(project.nodes).filter(
    (node) =>
      !node.source ||
      `${root}\\${relativeTarget(project.nodes, node.id).join('\\')}` !== node.source.path,
  );
}
/** True while the canvas plan differs from the disk. */
export function hasPendingPlan(project: Project): boolean {
  return pendingNodes(project).length > 0;
}
export function children(nodes: NodeMap, parentId: string | null): CanvasNode[] {
  return Object.values(nodes).filter((n) => n.parentId === parentId);
}
// How many cards fit across the visible canvas; the canvas reports it whenever its width
// changes, so new cards fill the window instead of a fixed five columns. Already placed cards
// are never moved by this.
let gridColumns = 5;
export function setGridColumns(columns: number) {
  gridColumns = Math.min(12, Math.max(4, Math.floor(columns) || 5));
}
export function preferredColumns(): number {
  return gridColumns;
}
function vacantPosition(
  nodes: NodeMap,
  parentId: string | null,
  start: number,
  position = { x: 32, y: 32 },
): { x: number; y: number } {
  const occupied = children(nodes, parentId);
  const columns = gridColumns;
  for (let index = start; index < MAX_NODES * 2; index++) {
    const block = Math.floor(index / 1000);
    const x = Math.min(position.x, 45000) + ((index % columns) + block * columns) * 156;
    const y = Math.min(position.y, 45000) + Math.floor((index % 1000) / columns) * 156;
    if (x > 49000 || y > 49000) continue;
    if (!occupied.some((n) => x < n.x + 148 && x + 148 > n.x && y < n.y + 150 && y + 150 > n.y))
      return { x, y };
  }
  throw new Error('附近没有可用布局空间，请先排列现有卡片。');
}
export function topLevelSelection(nodes: NodeMap, ids: string[]): string[] {
  return ids.filter(
    (id) =>
      nodes[id] &&
      !ids.some((other) => other !== id && isDescendant(nodes, nodes[id].parentId, other)),
  );
}
/** Why dropping `ids` into `parentId` would be refused, or null when it can go there. */
export function moveConflict(
  nodes: NodeMap,
  ids: string[],
  parentId: string | null,
): string | null {
  const moving = topLevelSelection(nodes, ids).filter((id) => nodes[id].parentId !== parentId);
  if (moving.some((id) => isDescendant(nodes, parentId, id))) return '不能放进自己或自己的子文件夹';
  const names = new Set(
    children(nodes, parentId)
      .filter((child) => !moving.includes(child.id))
      .map((child) => child.name.toLowerCase()),
  );
  const seen = new Set<string>();
  for (const id of moving) {
    const key = nodes[id].name.toLowerCase();
    if (names.has(key) || seen.has(key)) return `已有同名的“${nodes[id].name}”`;
    seen.add(key);
  }
  return null;
}
/**
 * `positions` are the spots the user released the items on; without one an item takes the next
 * free slot of its new folder. Items already in `parentId` are simply placed again.
 */
export function moveNodes(
  state: Workspace,
  ids: string[],
  parentId: string | null,
  positions?: Record<string, { x: number; y: number }>,
): Workspace {
  return commit(state, '移动到文件夹', (nodes) => {
    if (parentId && nodes[parentId]?.kind !== 'folder') throw new Error('目标文件夹不存在。');
    const moving = topLevelSelection(nodes, ids);
    for (const id of moving) {
      if (isDescendant(nodes, parentId, id))
        throw new Error('不能把文件夹放入自己或自己的子文件夹。');
    }
    moving.forEach((id) => {
      if (isDescendant(nodes, parentId, id))
        throw new Error('不能把文件夹放入自己或自己的子文件夹。');
      const given = positions?.[id];
      const position = given
        ? {
            x: Math.round(Math.max(0, Math.min(49000, given.x))),
            y: Math.round(Math.max(0, Math.min(49000, given.y))),
          }
        : vacantPosition(nodes, parentId, children(nodes, parentId).length);
      nodes[id].parentId = parentId;
      nodes[id].x = position.x;
      nodes[id].y = position.y;
    });
  });
}
// Finder-style "new folder with selection": one undo step creates the folder where
// the selection lives (or at the current level when it is spread over several
// folders) and moves the selected items into it.
export function moveToNewFolder(
  state: Workspace,
  ids: string[],
  name: string,
  parentId: string | null,
  folderId: string = crypto.randomUUID(),
): Workspace {
  return commit(state, '移入新文件夹', (nodes) => {
    const moving = topLevelSelection(nodes, ids);
    if (!moving.length) throw new Error('请先选择要移动的条目。');
    const parents = new Set(moving.map((id) => nodes[id].parentId));
    const where = parents.size === 1 ? [...parents][0] : parentId;
    if (children(nodes, where).some((n) => n.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`这里已有“${name}”，请换一个名称，或使用“移动到…”。`);
    if (moving.some((id) => isDescendant(nodes, where, id)))
      throw new Error('不能把文件夹放入自己或自己的子文件夹。');
    nodes[folderId] = {
      id: folderId,
      name,
      kind: 'folder',
      parentId: where,
      source: null,
      ...vacantPosition(nodes, where, children(nodes, where).length),
    };
    moving.forEach((id, index) => {
      const position = vacantPosition(nodes, folderId, index);
      nodes[id].parentId = folderId;
      nodes[id].x = position.x;
      nodes[id].y = position.y;
    });
  });
}
export function addFolder(state: Workspace, name: string, parentId: string | null): Workspace {
  return commit(state, '新建文件夹', (nodes) => {
    const id = crypto.randomUUID();
    const index = children(nodes, parentId).length;
    nodes[id] = {
      id,
      name,
      kind: 'folder',
      parentId,
      source: null,
      ...vacantPosition(nodes, parentId, index),
    };
  });
}
export function renameNode(state: Workspace, id: string, name: string): Workspace {
  return commit(state, '重命名', (nodes) => {
    if (!nodes[id]) throw new Error('条目不存在。');
    nodes[id].name = name;
  });
}
export function importEntries(
  state: Workspace,
  entries: ImportEntry[],
  parentId: string | null,
  position?: { x: number; y: number },
): Workspace {
  return commit(state, '加入整理画布', (nodes) => {
    for (const { entry, parentSourceId } of entries) {
      if (nodes[entry.id]) continue;
      const parent = parentSourceId ?? parentId;
      const offset = children(nodes, parent).length;
      nodes[entry.id] = {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        parentId: parent,
        source: entry,
        ...vacantPosition(
          nodes,
          parent,
          position && !parentSourceId ? 0 : offset,
          !parentSourceId ? position : undefined,
        ),
      };
    }
  });
}
export function relativeTarget(nodes: NodeMap, id: string): string[] {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current: CanvasNode | undefined = nodes[id];
  while (current) {
    if (visited.has(current.id)) throw new Error('检测到循环层级。');
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return parts;
}
