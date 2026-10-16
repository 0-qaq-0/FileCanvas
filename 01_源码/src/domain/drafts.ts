import type { Workspace } from './types';
import { addFolder, children, commit, moveNodes, relativeTarget } from './workspace';

export type DraftMode = 'type' | 'content-project';
export interface DraftRow {
  id: string;
  name: string;
  folder: string;
  reason: string;
  from: string;
  to: string;
}
export interface ClassificationDraft {
  mode: DraftMode;
  rows: DraftRow[];
  folders: string[];
  issues: string[];
  next: Workspace | null;
}
const extensions: Record<string, string[]> = {
  图片: ['jpg', 'jpeg', 'png', 'svg', 'gif', 'webp', 'bmp', 'heic', 'tiff'],
  文档: ['md', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'rtf'],
  视频: ['mp4', 'mov', 'mkv', 'avi', 'webm'],
  音频: ['wav', 'mp3', 'flac', 'm4a', 'ogg'],
  压缩包: ['zip', 'rar', '7z', 'tar', 'gz'],
  代码与配置: ['ts', 'tsx', 'js', 'py', 'json', 'html', 'css', 'yaml', 'yml', 'ps1'],
};
export function classify(name: string, mode: DraftMode): { folder: string; reason: string } {
  const ext = name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
  const type = Object.entries(extensions).find(([, values]) => values.includes(ext))?.[0];
  if (mode === 'content-project') {
    if (/定稿|交付|最终|成品/.test(name))
      return { folder: '03_交付成品', reason: '文件名含“定稿 / 交付 / 最终 / 成品”' };
    if (/选题|脚本|预算|说明|复盘|任务/.test(name))
      return { folder: '01_策划资料', reason: '文件名含策划资料关键词' };
    if (type && ['图片', '音频', '视频'].includes(type))
      return { folder: '02_创作素材', reason: `${ext.toUpperCase()} 属于${type}素材` };
    return { folder: '99_待确认', reason: '用途无法由文件名确定，留给你确认' };
  }
  return {
    folder: type ?? '其他',
    reason: type ? `.${ext} → ${type}` : '未识别扩展名，归入“其他”',
  };
}
export function buildClassificationDraft(
  state: Workspace,
  parentId: string | null,
  mode: DraftMode,
): ClassificationDraft {
  const files = children(state.project.nodes, parentId).filter((n) => n.kind === 'file');
  const prefix = parentId ? relativeTarget(state.project.nodes, parentId) : [];
  const rows = files.map((node) => {
    const result = classify(node.name, mode);
    return {
      id: node.id,
      name: node.name,
      ...result,
      from: relativeTarget(state.project.nodes, node.id).join('/'),
      to: [...prefix, result.folder, node.name].join('/'),
    };
  });
  const folders = [...new Set(rows.map((row) => row.folder))];
  let candidate = state;
  try {
    for (const folder of folders) {
      let target = children(candidate.project.nodes, parentId).find(
        (n) => n.name.toLowerCase() === folder.toLowerCase(),
      );
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
    if (files.length)
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
    const next = files.length
      ? {
          project: candidate.project,
          past: [...state.past.slice(-79), { nodes: state.project.nodes, label: '采用分类草案' }],
          future: [],
        }
      : state;
    return { mode, rows, folders, issues: [], next };
  } catch (error) {
    return { mode, rows, folders, issues: [(error as Error).message], next: null };
  }
}
