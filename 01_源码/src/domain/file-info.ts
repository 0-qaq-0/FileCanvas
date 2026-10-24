import type { NodeMap } from './types';
import { extensionOf, typeOf } from './recipes';

export function fileInfo(name: string) {
  const extension = extensionOf(name).toUpperCase();
  const label = typeOf(name) ?? '文件';
  const tone =
    (
      {
        图片: 'image',
        PDF: 'pdf',
        文档: 'document',
        表格: 'spreadsheet',
        演示: 'presentation',
        视频: 'video',
        音频: 'audio',
        压缩包: 'archive',
        安装包: 'application',
        设计文件: 'design',
        字体: 'font',
        电子书: 'document',
        代码与配置: 'code',
      } as Record<string, string>
    )[label] ?? 'generic';
  const displayLabel = label === '代码与配置' ? '代码' : label;
  const description =
    label === 'PDF' ? 'PDF 文档' : extension ? `${displayLabel} · ${extension}` : displayLabel;
  return { extension, label, tone, description };
}

export function formatSize(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return '大小未知';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = size / 1024,
    index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

export interface FolderSummary {
  files: number;
  folders: number;
  bytes: number;
  unknown: number;
  types: [string, number][];
}

/** Only the current plan's imported descendants. No disk scan or file-content reads. */
export function summarizeFolders(nodes: NodeMap): Map<string, FolderSummary> {
  const items = new Map<string, string[]>();
  for (const node of Object.values(nodes))
    if (node.parentId) {
      const list = items.get(node.parentId) ?? [];
      list.push(node.id);
      items.set(node.parentId, list);
    }
  const summaries = new Map<string, FolderSummary>();
  const visiting = new Set<string>();
  function visit(id: string): FolderSummary {
    const cached = summaries.get(id);
    if (cached) return cached;
    const result: FolderSummary = { files: 0, folders: 0, bytes: 0, unknown: 0, types: [] };
    if (visiting.has(id)) return result;
    visiting.add(id);
    const types = new Map<string, number>();
    for (const childId of items.get(id) ?? []) {
      const child = nodes[childId];
      if (child.kind === 'folder') {
        const summary = visit(child.id);
        result.files += summary.files;
        result.folders += summary.folders + 1;
        result.bytes += summary.bytes;
        result.unknown += summary.unknown;
        for (const [label, count] of summary.types)
          types.set(label, (types.get(label) ?? 0) + count);
      } else {
        result.files++;
        const size = child.source?.size;
        if (size == null || !Number.isFinite(size) || size < 0) result.unknown++;
        else result.bytes += size;
        const label = fileInfo(child.name).label;
        types.set(label, (types.get(label) ?? 0) + 1);
      }
    }
    result.types = [...types].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    visiting.delete(id);
    summaries.set(id, result);
    return result;
  }
  for (const node of Object.values(nodes)) if (node.kind === 'folder') visit(node.id);
  return summaries;
}

export function folderSize(summary: FolderSummary): string {
  return summary.unknown ? `${formatSize(summary.bytes)} + 未知` : formatSize(summary.bytes);
}

export function folderDescription(summary: FolderSummary): string {
  const types = summary.types.map(([label, count]) => `${label} ${count}`).join('、');
  return `画布内：${summary.files} 个文件，${summary.folders} 个文件夹，合计 ${folderSize(summary)}${types ? `；${types}` : ''}。仅统计已加入画布的内容。`;
}
