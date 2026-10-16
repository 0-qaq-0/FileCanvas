import type { CanvasNode, ImportEntry, NodeMap, Project, Workspace } from './types';

export const MAX_NODES = 5000;
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
}
export function workspace(project: Project): Workspace {
  return { project, past: [], future: [] };
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
  return {
    project: { ...state.project, nodes, updatedAt: new Date().toISOString() },
    past: [...state.past.slice(-79), { nodes: state.project.nodes, label }],
    future: [],
  };
}
export function undo(state: Workspace): Workspace {
  const last = state.past.at(-1);
  if (!last) return state;
  return {
    project: { ...state.project, nodes: last.nodes, updatedAt: new Date().toISOString() },
    past: state.past.slice(0, -1),
    future: [...state.future, { nodes: state.project.nodes, label: last.label }],
  };
}
export function redo(state: Workspace): Workspace {
  const last = state.future.at(-1);
  if (!last) return state;
  return {
    project: { ...state.project, nodes: last.nodes, updatedAt: new Date().toISOString() },
    past: [...state.past, { nodes: state.project.nodes, label: last.label }],
    future: state.future.slice(0, -1),
  };
}
export function children(nodes: NodeMap, parentId: string | null): CanvasNode[] {
  return Object.values(nodes).filter((n) => n.parentId === parentId);
}
function vacantPosition(
  nodes: NodeMap,
  parentId: string | null,
  start: number,
  position = { x: 32, y: 32 },
): { x: number; y: number } {
  const occupied = children(nodes, parentId);
  for (let index = start; index < MAX_NODES * 2; index++) {
    const block = Math.floor(index / 1000);
    const x = Math.min(position.x, 45000) + ((index % 5) + block * 5) * 156;
    const y = Math.min(position.y, 45000) + Math.floor((index % 1000) / 5) * 156;
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
export function moveNodes(state: Workspace, ids: string[], parentId: string | null): Workspace {
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
      const position = vacantPosition(nodes, parentId, children(nodes, parentId).length);
      nodes[id].parentId = parentId;
      nodes[id].x = position.x;
      nodes[id].y = position.y;
    });
  });
}
export function addFolder(state: Workspace, name: string, parentId: string | null): Workspace {
  return commit(state, '新建虚拟文件夹', (nodes) => {
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
