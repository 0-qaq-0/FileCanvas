import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_NODES, relativeTarget, validateProject } from '../src/domain/workspace';
import type { Change, ImportEntry, Preview, Project, SourceEntry } from '../src/domain/types';

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
export async function listDirectory(root: string, directory: string): Promise<SourceEntry[]> {
  const resolved = checkPath(root, directory);
  await noLinks(root, resolved);
  const items = await fs.readdir(resolved, { withFileTypes: true });
  if (items.length > MAX_NODES)
    throw new Error('该文件夹超过 5000 个直接条目。请选择更小的整理目录。');
  const output: SourceEntry[] = [];
  for (const item of items) {
    const p = path.join(resolved, item.name);
    try {
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
  return output.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'folder' ? -1 : 1,
  );
}
export async function importPaths(root: string, paths: string[]): Promise<ImportEntry[]> {
  if (!Array.isArray(paths) || paths.length > MAX_NODES) throw new Error('导入数量超出限制。');
  const output: ImportEntry[] = [];
  const seen = new Set<string>();
  const visit = async (fullPath: string, parentSourceId: string | null) => {
    const entry = await readEntry(root, fullPath);
    if (path.resolve(fullPath).toLowerCase() === root.toLowerCase())
      throw new Error('项目根目录已作为画布根目录，不必再次加入。');
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    if (seen.size > MAX_NODES)
      throw new Error('一次整理最多支持 5000 个条目，请选择更小的文件夹。');
    output.push({ entry, parentSourceId });
    if (entry.kind === 'folder') {
      const children = await fs.readdir(entry.path);
      for (const name of children) await visit(path.join(entry.path, name), entry.id);
    }
  };
  const unique = [...new Set(paths.map((p) => checkPath(root, p)))];
  const roots = unique.filter((p) => !unique.some((other) => other !== p && inside(other, p)));
  for (const p of roots) await visit(p, null);
  return output;
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
  return {
    changes,
    changed: changes.filter((c) => c.kind !== 'unchanged').length,
    unchanged: changes.filter((c) => c.kind === 'unchanged').length,
    issues: changes.filter((c) => c.issues.length).length,
    checkedAt: new Date().toISOString(),
  };
}
export function readableError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return '文件或文件夹不存在。';
  if (code === 'EACCES' || code === 'EPERM') return '没有访问权限，或文件被其他程序限制访问。';
  if (code === 'ENOTDIR') return '路径中的某一级不是文件夹。';
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
