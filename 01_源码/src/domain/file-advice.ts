import type { FileAdvice, Workspace } from './types';
import { commit, validateName, children } from './workspace';
export function applyFileAdvice(state: Workspace, id: string, advice: FileAdvice): Workspace {
  return commit(state, '采用文件整理建议', (nodes) => {
    const node = nodes[id];
    if (node?.kind !== 'file') throw new Error('此文件已不在画布中。');
    if (advice.action === 'keep') {
      node.reviewDelete = false;
      return;
    }
    if (advice.action === 'review-delete') {
      node.reviewDelete = true;
      return;
    }
    let destination = advice.destinationId;
    if (advice.newFolder) {
      validateName(advice.newFolder);
      const existing = children(nodes, null).find(
        (n) => n.name.toLowerCase() === advice.newFolder!.toLowerCase(),
      );
      if (existing?.kind === 'file') throw new Error('项目根目录已有同名文件，请换一个推荐位置。');
      destination = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        const i = children(nodes, null).length;
        const columns = Math.max(5, Math.ceil((i + 1) / 300));
        nodes[destination] = {
          id: destination,
          name: advice.newFolder,
          kind: 'folder',
          source: null,
          parentId: null,
          x: 32 + (i % columns) * 156,
          y: 32 + Math.floor(i / columns) * 156,
        };
      }
    }
    if (destination && nodes[destination]?.kind !== 'folder')
      throw new Error('推荐文件夹已变化，请重新分析。');
    if (node.parentId === destination && !node.reviewDelete) return;
    const i = children(nodes, destination).length;
    const columns = Math.max(5, Math.ceil((i + 1) / 300));
    node.parentId = destination;
    node.reviewDelete = false;
    node.x = 32 + (i % columns) * 156;
    node.y = 32 + Math.floor(i / columns) * 156;
  });
}
