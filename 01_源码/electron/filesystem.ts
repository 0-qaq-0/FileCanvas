import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_APPLY_FILES,
  MAX_NODES,
  relativeTarget,
  validateProject,
} from '../src/domain/workspace';
import type {
  Change,
  ImportEntry,
  ImportSummary,
  Preview,
  Project,
  SourceEntry,
} from '../src/domain/types';

export function fileId(fullPath: string): string {
  return createHash('sha256').update(path.resolve(fullPath).toLowerCase()).digest('hex');
}
export function inside(root: string, fullPath: string): boolean {
  const rel = path.relative(root, fullPath);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}
export function checkPath(root: string, input: string): string {
  if (
    typeof input !== 'string' ||
    input.includes('\0') ||
    !path.isAbsolute(input) ||
    input.startsWith('\\\\') ||
    input.startsWith('\\?\\')
  )
    throw new Error('只支持授权目录内的本地绝对路径，暂不支持网络路径。');
  const resolved = path.resolve(input);
  if (!inside(root, resolved)) throw new Error('路径超出已选择的项目根目录。');
  if (process.platform === 'win32' && path.relative(root, resolved).includes(':'))
    throw new Error('不支持 NTFS 备用数据流路径。');
  return resolved;
}
export async function noLinks(root: string, fullPath: string): Promise<void> {
  const resolved = checkPath(root, fullPath);
  const rel = path.relative(root, resolved);
  let current = root;
  const paths = [root];
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    paths.push(current);
  }
  for (const p of paths) {
    try {
      if ((await fs.lstat(p)).isSymbolicLink())
        throw new Error('暂不支持符号链接或目录联接，避免越过授权边界。');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}
export async function readEntry(root: string, fullPath: string): Promise<SourceEntry> {
  const candidate = checkPath(root, fullPath);
  await noLinks(root, candidate);
  const resolved = checkPath(root, await fs.realpath(candidate));
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('暂不支持此类型的文件。');
  await fs.access(resolved, constants.R_OK);
  return {
    id: fileId(resolved),
    name: path.basename(resolved),
    path: resolved,
    kind: stat.isDirectory() ? 'folder' : 'file',
    size: stat.isFile() ? stat.size : 0,
    mtimeMs: stat.mtimeMs,
  };
}
// Files Windows or other programs keep for themselves, listed as unavailable and never imported.
// Windows' own per-folder files ('system') travel with a moved folder; an Office lock file or a
// download in progress ('busy') keeps its folder from moving until the program is done with it.
export function skippedKind(name: string): 'system' | 'office' | 'download' | null {
  const lower = name.toLowerCase();
  if (['desktop.ini', 'thumbs.db', 'ehthumbs.db'].includes(lower)) return 'system';
  if (lower.startsWith('~$')) return 'office';
  if (/\.(crdownload|part|download|opdownload)$/.test(lower)) return 'download';
  return null;
}
export function systemOrPartial(name: string): string | null {
  const kind = skippedKind(name);
  if (kind === 'system') return '系统文件，不参与整理。';
  if (kind === 'office') return 'Office 正在使用的临时文件，不参与整理。';
  if (kind === 'download') return '正在下载的文件，下载完成后再整理。';
  return null;
}
// FileCanvas' own working entries: the recovery area of an operation and the hard-link probe.
// They are never the user's files, so they never show up in a listing or on the canvas.
export function isInternalEntry(name: string): boolean {
  return /^\.filecanvas-(operation-[0-9a-f-]{36}|probe-[0-9a-f-]{36}-[ab])$/i.test(name);
}
// Folders nobody organizes file by file. They appear as one card, and their contents, often tens
// of thousands of files, are not read.
const SEALED = /^(node_modules|\.git|\.svn|\.hg|__pycache__|\.venv)$/i;
// Why a folder holding this skipped file cannot be moved yet, naming the file.
function blocksFolderMove(name: string, kind: 'office' | 'download'): string {
  return kind === 'office'
    ? `文件夹里的“${name}”是 Office 正在使用的临时文件，请先关闭对应文档再移动这个文件夹。`
    : `文件夹里的“${name}”还在下载，请等下载完成后再移动这个文件夹。`;
}
/**
 * Lists a folder. A folder too large to organize at once normally fails; with `cap` the listing
 * keeps the most recently changed entries, folders first, and ends with a note saying how many
 * are left out, so a huge 下载 can still be opened and worked through.
 */
export async function listDirectory(
  root: string,
  directory: string,
  options: { cap?: boolean } = {},
): Promise<SourceEntry[]> {
  const resolved = checkPath(root, directory);
  await noLinks(root, resolved);
  let items = (await fs.readdir(resolved, { withFileTypes: true })).filter(
    (item) => !isInternalEntry(item.name),
  );
  let leftOut = 0;
  if (items.length > MAX_NODES) {
    if (!options.cap) throw new Error('该文件夹超过 5000 个直接条目。请选择更小的整理目录。');
    leftOut = items.length - MAX_NODES;
    const changed = new Map<string, number>();
    for (const item of items) {
      const stat = await fs.lstat(path.join(resolved, item.name)).catch(() => null);
      changed.set(item.name, stat?.mtimeMs ?? 0);
    }
    items = items
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          changed.get(b.name)! - changed.get(a.name)!,
      )
      .slice(0, MAX_NODES);
  }
  const output: SourceEntry[] = [];
  for (const item of items) {
    const p = path.join(resolved, item.name);
    try {
      const skip = systemOrPartial(item.name);
      if (skip) throw new Error(skip);
      output.push(await readEntry(root, p));
    } catch (error) {
      output.push({
        id: fileId(p),
        name: item.name,
        path: p,
        kind: item.isDirectory() ? 'folder' : 'file',
        size: 0,
        mtimeMs: 0,
        blocked: readableError(error),
      });
    }
  }
  output.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'folder' ? -1 : 1,
  );
  if (leftOut) {
    const note = path.join(resolved, `还有 ${leftOut} 项未显示`);
    output.push({
      id: fileId(note),
      name: `还有 ${leftOut} 项未显示`,
      path: note,
      kind: 'file',
      size: 0,
      mtimeMs: 0,
      blocked: `这个文件夹超过 ${MAX_NODES} 项，只列出最近修改的部分。整理并应用后，用“刷新并核对”继续处理其余的。`,
      overflow: leftOut,
    });
  }
  return output;
}
/**
 * Reads the given items and what is inside their folders, breadth first, so everything near the
 * top is on the canvas even when a deep folder holds more than the project can take.
 *
 * An item asked for by name must be usable, otherwise this throws. One that merely sits inside a
 * chosen folder (a link, or something unreadable) is left out and counted: it must not cost the
 * user the rest of the folder. The preview still refuses to move a folder with such a leftover.
 *
 * `room` limits new entries; ones in `known` are already on the canvas and take up none.
 */
export async function importSummary(
  root: string,
  paths: string[],
  options: { room?: number; known?: Set<string> } = {},
): Promise<ImportSummary> {
  if (!Array.isArray(paths) || paths.length > MAX_NODES) throw new Error('导入数量超出限制。');
  const entries: ImportEntry[] = [];
  const seen = new Set<string>();
  let room = Math.max(0, options.room ?? MAX_NODES);
  let limited = false;
  let skipped = 0;
  const folders: SourceEntry[] = [];
  const add = (entry: SourceEntry, parentSourceId: string | null) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    if (!options.known?.has(entry.id)) {
      if (room <= 0) {
        limited = true;
        return;
      }
      room--;
    }
    entries.push({ entry, parentSourceId });
    if (entry.kind === 'folder') folders.push(entry);
  };
  // An item inside another requested folder comes in with that folder. Walking up from each path
  // keeps this fast for the thousands of paths a large folder sends.
  const unique = [...new Set(paths.map((p) => checkPath(root, p)))];
  const lowered = new Set(unique.map((p) => p.toLowerCase()));
  const requested = unique.filter((p) => {
    for (let up = path.dirname(p), last = p; up !== last; last = up, up = path.dirname(up))
      if (lowered.has(up.toLowerCase())) return false;
    return true;
  });
  for (const p of requested) {
    const entry = await readEntry(root, p);
    if (path.resolve(p).toLowerCase() === root.toLowerCase())
      throw new Error('项目根目录已作为画布根目录，不必再次加入。');
    add(entry, null);
  }
  for (let next = 0; next < folders.length && !limited; next++) {
    const folder = folders[next];
    if (SEALED.test(folder.name)) continue;
    let names: string[];
    try {
      names = await fs.readdir(folder.path);
    } catch {
      skipped++;
      continue;
    }
    for (const name of names) {
      if (limited) break;
      if (systemOrPartial(name) || isInternalEntry(name)) continue;
      try {
        add(await readEntry(root, path.join(folder.path, name)), folder.id);
      } catch {
        skipped++;
      }
    }
  }
  return { entries, limited, skipped };
}
export async function importPaths(root: string, paths: string[]): Promise<ImportEntry[]> {
  const summary = await importSummary(root, paths);
  if (summary.limited) throw new Error('一次整理最多支持 5000 个条目，请选择更小的文件夹。');
  return summary.entries;
}
export async function searchFiles(
  root: string,
  query: string,
): Promise<{ entries: SourceEntry[]; truncated: boolean }> {
  if (typeof query !== 'string' || query.length > 200) throw new Error('搜索内容无效。');
  const entries: SourceEntry[] = [];
  const queue = [root];
  let visited = 0;
  let truncated = false;
  while (queue.length) {
    const folder = queue.shift()!;
    let items: SourceEntry[];
    try {
      items = await listDirectory(root, folder);
    } catch {
      truncated = true;
      continue;
    }
    for (const entry of items) {
      if (++visited > 10000 || entries.length >= 300) return { entries, truncated: true };
      if (entry.name.toLowerCase().includes(query.toLowerCase())) entries.push(entry);
      if (entry.kind === 'folder' && !entry.blocked) queue.push(entry.path);
    }
  }
  return { entries, truncated };
}
export function createProject(rootPath: string): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: randomUUID(),
    rootPath,
    name: path.basename(rootPath) || rootPath,
    nodes: {},
    createdAt: now,
    updatedAt: now,
  };
}
export function validateAuthorized(project: Project, root: string): void {
  validateProject(project);
  checkPath(root, root);
  if (project.rootPath !== root) throw new Error('项目根目录未经授权。请重新打开项目。');
  for (const group of project.canvasGroups ?? []) {
    for (const file of group.files) checkPath(root, file);
  }
  for (const node of Object.values(project.nodes)) {
    if (node.source) {
      const source = checkPath(root, node.source.path);
      if (node.id !== fileId(source)) throw new Error('原始文件标识与路径不一致。');
    }
  }
}
export async function generatePreview(root: string, project: Project): Promise<Preview> {
  validateAuthorized(project, root);
  const changes: Change[] = [];
  let rootIssue = '';
  try {
    await noLinks(root, root);
    if (!(await fs.stat(root)).isDirectory()) rootIssue = '项目根目录已不是文件夹。';
    await fs.access(root, constants.R_OK);
  } catch (error) {
    rootIssue = `项目根目录不可用：${readableError(error)}`;
  }
  for (const node of Object.values(project.nodes)) {
    const target = checkPath(root, path.join(root, ...relativeTarget(project.nodes, node.id)));
    const source = node.source?.path ?? null;
    const same = source === target;
    const sameParent =
      source && path.dirname(source).toLowerCase() === path.dirname(target).toLowerCase();
    const sameName = source && path.basename(source) === path.basename(target);
    const kind: Change['kind'] = !source
      ? 'create'
      : same
        ? 'unchanged'
        : sameParent
          ? 'rename'
          : sameName
            ? 'move'
            : 'move-rename';
    const issues: string[] = rootIssue ? [rootIssue] : [];
    if (target.length > 240) issues.push('目标路径超过 MVP 的 240 字符安全限制。');
    try {
      await noLinks(root, target);
    } catch (error) {
      issues.push(readableError(error));
    }
    if (source) {
      try {
        const current = await readEntry(root, source);
        if (
          current.kind !== node.kind ||
          (node.kind === 'file' &&
            (current.size !== node.source!.size ||
              Math.abs(current.mtimeMs - node.source!.mtimeMs) > 1))
        )
          issues.push('源文件在加入画布后发生变化，请重新核对或新建项目。');
      } catch (error) {
        issues.push(`源文件不可用：${readableError(error)}`);
      }
    }
    if (!same) {
      try {
        await fs.lstat(target);
        // Case-only rename is still shown, but is not a collision with itself.
        if (!source || source.toLowerCase() !== target.toLowerCase())
          issues.push('目标已存在：请先处理同名文件，再执行移动。');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          issues.push(`目标检查失败：${readableError(error)}`);
      }
    }
    // An existing file in any ancestor blocks a proposed directory hierarchy.
    let ancestor = path.dirname(target);
    while (ancestor !== root && inside(root, ancestor)) {
      try {
        if (!(await fs.lstat(ancestor)).isDirectory()) {
          issues.push('目标的上级路径是一个文件。');
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          issues.push(readableError(error));
          break;
        }
      }
      ancestor = path.dirname(ancestor);
    }
    changes.push({
      id: node.id,
      name: node.name,
      kind,
      source,
      target,
      issues: [...new Set(issues)],
    });
  }
  const movedFolders = changes.filter(
    (c) => c.source && project.nodes[c.id].kind === 'folder' && c.kind !== 'unchanged',
  );
  const sources = new Set(
    Object.values(project.nodes)
      .filter((n) => n.source)
      .map((n) => n.source!.path.toLowerCase()),
  );
  // Folders are emptied file by file and then removed, so a system file left behind would stop
  // the removal: each one moves next to its folder's new place, as part of the plan.
  const folderTargets = new Map(
    changes
      .filter((c) => c.source && project.nodes[c.id].kind === 'folder')
      .map((c) => [c.source!.toLowerCase(), c.target]),
  );
  const companions = new Map<string, { source: string; target: string }>();
  for (const folder of movedFolders) {
    try {
      const queue = [folder.source!];
      let visited = 0;
      while (queue.length) {
        const directory = queue.pop()!;
        for (const child of await listDirectory(root, directory)) {
          if (++visited > MAX_NODES) throw new Error('文件夹超过 5000 项，请缩小范围。');
          const skipped = skippedKind(child.name);
          const parentTarget = folderTargets.get(directory.toLowerCase());
          if (skipped === 'system' && parentTarget && (await fs.lstat(child.path)).isFile()) {
            companions.set(child.path.toLowerCase(), {
              source: child.path,
              target: path.join(parentTarget, child.name),
            });
            continue;
          }
          if (skipped === 'office' || skipped === 'download')
            throw new Error(blocksFolderMove(path.relative(folder.source!, child.path), skipped));
          if (child.blocked || !sources.has(child.path.toLowerCase()))
            throw new Error(
              `文件夹里的“${path.relative(folder.source!, child.path)}”未加入画布（可能无法读取、是链接，或内容太多），这个文件夹暂时不能整体移动。`,
            );
          if (child.kind === 'folder') queue.push(child.path);
        }
      }
    } catch (e) {
      folder.issues.push(readableError(e));
    }
  }
  const moving =
    changes.filter((c) => c.source && project.nodes[c.id].kind === 'file' && c.kind !== 'unchanged')
      .length + companions.size;
  if (moving > MAX_APPLY_FILES) {
    for (const c of changes.filter((c) => c.kind !== 'unchanged'))
      c.issues.push(`每次最多应用 ${MAX_APPLY_FILES} 个文件，请分批整理。`);
  }
  return {
    changes,
    companions: [...companions.values()],
    changed: changes.filter((c) => c.kind !== 'unchanged').length,
    unchanged: changes.filter((c) => c.kind === 'unchanged').length,
    issues: changes.filter((c) => c.issues.length).length,
    checkedAt: new Date().toISOString(),
  };
}
/** Puts a file system error in the user's words, naming the file when the error says which. */
export function readableError(error: unknown): string {
  const failure = error as NodeJS.ErrnoException;
  const name = failure?.path ? path.basename(failure.path) : '';
  const about = name ? `：${name}` : '';
  switch (failure?.code) {
    case 'ENOENT':
      return name ? `文件或文件夹不存在${about}` : '文件或文件夹不存在。';
    case 'EACCES':
    case 'EPERM':
      return name
        ? `没有访问权限，或文件被其他程序限制访问${about}`
        : '没有访问权限，或文件被其他程序限制访问。';
    case 'EBUSY':
      return `文件正被其他程序占用，请关闭后重试${about}`;
    case 'ENOTDIR':
      return '路径中的某一级不是文件夹。';
    case 'EEXIST':
      return `目标已存在，不会覆盖${about}`;
    case 'ENOTEMPTY':
      return `文件夹里还有其他内容，无法调整${about}`;
    case 'ENOSPC':
      return '磁盘空间不足，请清理后重试。';
    case 'EROFS':
      return '这个磁盘是只读的，无法修改。';
    case 'ENAMETOOLONG':
      return '路径太长，请缩短文件夹或文件名。';
    case 'EMFILE':
    case 'ENFILE':
      return '同时打开的文件太多，请稍后重试。';
    case 'EIO':
      return `读写磁盘时出错，请检查磁盘或连接${about}`;
    default:
      return error instanceof Error ? error.message : '操作失败，请重试。';
  }
}
