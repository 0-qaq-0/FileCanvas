import type { CanvasNode, Workspace } from './types';
import { children } from './workspace';

// Rule-based "recipes" that propose a destination folder for each loose file.
// They read only the file name, extension and last-modified time; nothing is
// sent anywhere and nothing touches the disk until the plan is applied.
export type RecipeId = 'type' | 'month' | 'stale' | 'content-project';
export interface Placement {
  folder: string;
  reason: string;
}
export interface RecipeOptions {
  now?: number;
  staleDays?: number;
}
export const DEFAULT_STALE_DAYS = 180;
export const STALE_FOLDER = '久未修改';
export const RECIPE_INFO: Record<RecipeId, { title: string; description: string }> = {
  'content-project': {
    title: '内容项目',
    description: '策划资料 → 创作素材 → 交付成品 · 不确定的留待确认',
  },
  type: {
    title: '按文件类型',
    description: '图片、文档、PDF、表格、演示、视频、音频、压缩包、安装包等',
  },
  month: {
    title: '按修改月份',
    description: '按文件最后修改的年月分文件夹（如 2026-10），适合照片和下载',
  },
  stale: {
    title: '久未修改归档',
    description: `把超过 ${DEFAULT_STALE_DAYS} 天没改过的文件收进“${STALE_FOLDER}”，近期文件留在原处`,
  },
};
const TYPES: [string, string[]][] = [
  ['图片', 'jpg jpeg png gif webp bmp heic heif tif tiff svg ico raw cr2 nef arw dng'.split(' ')],
  ['PDF', ['pdf']],
  ['文档', 'doc docx txt md markdown rtf odt wps pages'.split(' ')],
  ['表格', 'xls xlsx csv tsv ods numbers'.split(' ')],
  ['演示', 'ppt pptx key odp'.split(' ')],
  ['电子书', 'epub mobi azw3 djvu'.split(' ')],
  ['视频', 'mp4 mov mkv avi webm wmv flv m4v'.split(' ')],
  ['音频', 'wav mp3 flac m4a ogg aac wma'.split(' ')],
  ['压缩包', 'zip rar 7z tar gz bz2 xz'.split(' ')],
  ['安装包', 'exe msi msix apk iso dmg pkg'.split(' ')],
  ['设计文件', 'psd ai fig sketch xd indd eps'.split(' ')],
  ['字体', 'ttf otf woff woff2'.split(' ')],
  [
    '代码与配置',
    'ts tsx js jsx mjs cjs py json html css scss yaml yml ps1 sh bat cmd sql xml toml ini java c cpp h cs go rs php rb'.split(
      ' ',
    ),
  ],
];
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
export function typeOf(name: string): string | undefined {
  const ext = extensionOf(name);
  return TYPES.find(([, list]) => list.includes(ext))?.[0];
}
// Name-only recipes, kept separate so callers without file metadata can still use them.
export function placeByName(name: string, recipe: 'type' | 'content-project'): Placement {
  const ext = extensionOf(name);
  const type = typeOf(name);
  if (recipe === 'content-project') {
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
function twoDigits(value: number) {
  return String(value).padStart(2, '0');
}
export function monthOf(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  return `${d.getFullYear()}-${twoDigits(d.getMonth() + 1)}`;
}
// Returns null when the recipe has nothing to say about this file (it stays put).
export function placeFile(
  node: CanvasNode,
  recipe: RecipeId,
  options: RecipeOptions = {},
): Placement | null {
  if (recipe === 'type' || recipe === 'content-project') return placeByName(node.name, recipe);
  const mtime = node.source?.mtimeMs;
  if (!mtime || !Number.isFinite(mtime)) return null;
  if (recipe === 'month') {
    const d = new Date(mtime);
    return {
      folder: monthOf(mtime),
      reason: `最后修改于 ${d.getFullYear()}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())}`,
    };
  }
  const days = Math.floor(((options.now ?? Date.now()) - mtime) / 86_400_000);
  const limit = options.staleDays ?? DEFAULT_STALE_DAYS;
  return days >= limit
    ? { folder: STALE_FOLDER, reason: `已 ${days} 天未修改（超过 ${limit} 天）` }
    : null;
}
export interface Suggestion {
  id: RecipeId;
  title: string;
  files: number;
  folders: number;
}
// What each recipe would do to the loose files of one canvas level. Cheap enough to
// recompute on every render, so the "next step" hints always reflect the current plan.
export function suggestRecipes(
  state: Workspace,
  parentId: string | null,
  options: RecipeOptions & { contentProject?: boolean } = {},
): { loose: number; items: Suggestion[] } {
  const files = children(state.project.nodes, parentId).filter((n) => n.kind === 'file');
  const order: RecipeId[] = options.contentProject
    ? ['content-project', 'type', 'month', 'stale']
    : ['type', 'month', 'stale'];
  const items: Suggestion[] = [];
  for (const id of order) {
    const folders = new Set<string>();
    let count = 0;
    for (const file of files) {
      const place = placeFile(file, id, options);
      if (!place) continue;
      count++;
      folders.add(place.folder);
    }
    if (count >= 2 && (id === 'stale' || folders.size >= 2))
      items.push({ id, title: RECIPE_INFO[id].title, files: count, folders: folders.size });
  }
  return { loose: files.length, items };
}
// A sensible default name when several files are gathered into a new folder.
export function suggestFolderName(nodes: CanvasNode[]): string {
  const files = nodes.filter((n) => n.kind === 'file');
  const types = new Set(files.map((n) => typeOf(n.name) ?? '其他'));
  return files.length === nodes.length && types.size === 1 ? [...types][0] : '新建文件夹';
}
