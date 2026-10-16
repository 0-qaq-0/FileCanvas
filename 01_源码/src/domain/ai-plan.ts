import type { AiGroup, Workspace } from './types';
import { commit, validateName } from './workspace';

export function adoptAiPlan(
  state: Workspace,
  parentId: string | null,
  groups: AiGroup[],
  scope: string[],
): Workspace {
  if (!groups.length) throw new Error('AI 没有给出可采用的分类。');
  const allowed = new Set(scope);
  const seen = new Set<string>();
  return commit(state, '采用 AI 整理草案', (nodes) => {
    for (const group of groups) {
      validateName(group.folder);
      if (!group.ids.length) throw new Error('AI 分类为空。');
      const existing = Object.values(nodes).find(
        (n) => n.parentId === parentId && n.name.toLowerCase() === group.folder.toLowerCase(),
      );
      if (existing && existing.kind !== 'folder')
        throw new Error(`已有同名文件“${group.folder}”，请调整方案。`);
      const folderId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        const i = Object.values(nodes).filter((n) => n.parentId === parentId).length;
        nodes[folderId] = {
          id: folderId,
          name: group.folder,
          kind: 'folder',
          parentId,
          source: null,
          x: 32 + (i % 5) * 156,
          y: 32 + Math.floor(i / 5) * 156,
        };
      }
      for (const id of group.ids) {
        const node = nodes[id];
        if (!allowed.has(id) || seen.has(id) || node?.kind !== 'file' || node.parentId !== parentId)
          throw new Error('文件或所在目录已变化，请重新生成 AI 草案。');
        seen.add(id);
        const i = Object.values(nodes).filter((n) => n.parentId === folderId).length;
        node.parentId = folderId;
        node.x = 32 + (i % 5) * 156;
        node.y = 32 + Math.floor(i / 5) * 156;
      }
    }
  });
}
