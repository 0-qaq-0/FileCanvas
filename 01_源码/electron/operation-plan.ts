import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { checkPath, noLinks, readEntry, fileId } from './filesystem';
import { relativeTarget } from '../src/domain/workspace';
import type { Project, NodeMap } from '../src/domain/types';

export interface Fingerprint {
  kind: 'file' | 'folder' | 'other';
  identity: string;
  size: string;
  modified: string;
}
export type Inventory = Record<string, Fingerprint>;
export async function statOrNull(filename: string) {
  try {
    return await fs.lstat(filename, { bigint: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export function identity(stat: { dev: bigint; ino: bigint }) {
  return `${stat.dev}:${stat.ino}`;
}
// Counts full-file reads so tests can keep the number of content passes bounded.
export const hashStats = { reads: 0 };
export async function hashFile(filename: string) {
  hashStats.reads++;
  const hash = createHash('sha256');
  for await (const block of createReadStream(filename)) hash.update(block);
  return hash.digest('hex');
}
export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function fingerprint(s: BigIntStats): Fingerprint {
  return {
    kind: s.isFile() ? 'file' : s.isDirectory() && !s.isSymbolicLink() ? 'folder' : 'other',
    identity: identity(s),
    size: s.size.toString(),
    modified: s.mtimeNs.toString(),
  };
}
// Whole-tree snapshot. Used by tests and legacy-journal import; applying and
// verifying a plan look only at the paths the plan touches (see scopedInventory).
export async function inventory(root: string, excluded?: string): Promise<Inventory> {
  await noLinks(root, root);
  const result: Inventory = {};
  let count = 0;
  async function visit(directory: string) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const filename = checkPath(root, path.join(directory, name));
      if (filename === excluded) continue;
      const s = await fs.lstat(filename, { bigint: true });
      if (++count > 10000) throw new Error('核对范围超过 10000 项，请选择更小的目录。');
      result[filename] = fingerprint(s);
      if (result[filename].kind === 'folder') await visit(filename);
    }
  }
  await visit(root);
  return result;
}
// Fingerprints only the named paths, reporting each under its real on-disk
// casing (NTFS is case-insensitive, so a case-only rename must be observable).
// Unrelated entries elsewhere in the root, however many, are never read.
export async function scopedInventory(
  root: string,
  paths: Iterable<string>,
  listed?: Map<string, string[]>,
): Promise<Inventory> {
  await noLinks(root, root);
  const realRoot = await fs.realpath(root);
  // The same physical folder can be named with different casing by a source and a
  // target path (a case-only folder rename). Group by the folder's real on-disk
  // name so every entry yields exactly one key.
  const canonical = async (parent: string): Promise<string | null> => {
    let real: string;
    try {
      real = await fs.realpath(parent);
    } catch (e) {
      if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
      throw e;
    }
    const rel = path.relative(realRoot, real);
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`))
      throw new Error('路径超出已选择的项目根目录。');
    return rel ? path.join(root, rel) : root;
  };
  const wanted = new Map<string, Set<string>>();
  const resolved = new Map<string, string | null>();
  for (const p of paths) {
    const filename = checkPath(root, p);
    if (filename === root) continue;
    const typed = path.dirname(filename);
    if (!resolved.has(typed)) {
      await noLinks(root, typed);
      resolved.set(typed, await canonical(typed));
    }
    const parent = resolved.get(typed);
    if (parent === null || parent === undefined) continue;
    if (!wanted.has(parent)) wanted.set(parent, new Set());
    wanted.get(parent)!.add(path.basename(filename).toLowerCase());
  }
  const result: Inventory = {};
  for (const [parent, names] of wanted) {
    let entries: string[];
    try {
      entries = await fs.readdir(parent);
    } catch (e) {
      if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) continue;
      throw e;
    }
    listed?.set(parent, entries);
    for (const name of entries) {
      if (!names.has(name.toLowerCase())) continue;
      const filename = path.join(parent, name);
      const s = await statOrNull(filename);
      if (s) result[filename] = fingerprint(s);
    }
  }
  return result;
}
export function inventoryDigest(entries: Inventory) {
  return digest(
    Object.entries(entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, s]) => [p, s.kind, s.kind === 'folder' ? null : s]),
  );
}
export async function writeAtomic(filename: string, value: unknown) {
  const temporary = `${filename}.tmp`;
  await noLinks(path.dirname(filename), filename);
  await noLinks(path.dirname(filename), temporary);
  const handle = await fs.open(temporary, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filename);
}
export async function originalProject(project: Project): Promise<Project> {
  const before = structuredClone(project);
  const ids = new Map(
    Object.values(before.nodes)
      .filter((n) => n.source)
      .map((n) => [n.source!.path.toLowerCase(), n.id]),
  );
  for (const node of Object.values(before.nodes)) {
    if (!node.source) {
      delete before.nodes[node.id];
      continue;
    }
    let directory = path.dirname(node.source.path);
    while (directory.toLowerCase() !== project.rootPath.toLowerCase()) {
      checkPath(project.rootPath, directory);
      if (!ids.has(directory.toLowerCase())) {
        const source = await readEntry(project.rootPath, directory);
        ids.set(directory.toLowerCase(), source.id);
        before.nodes[source.id] = {
          id: source.id,
          name: source.name,
          source,
          kind: 'folder',
          parentId: null,
          x: 32,
          y: 32,
        };
      }
      directory = path.dirname(directory);
    }
  }
  for (const node of Object.values(before.nodes)) {
    node.name = node.source!.name;
    node.parentId = ids.get(path.dirname(node.source!.path).toLowerCase()) ?? null;
  }
  return before;
}
export async function rebase(project: Project, original = false): Promise<Project> {
  const nodes: NodeMap = {};
  const paths = new Map(
    Object.values(project.nodes).map((n) => [
      n.id,
      original
        ? n.source!.path
        : path.join(project.rootPath, ...relativeTarget(project.nodes, n.id)),
    ]),
  );
  for (const node of Object.values(project.nodes)) {
    const source = await readEntry(project.rootPath, paths.get(node.id)!);
    const id = fileId(source.path);
    nodes[id] = {
      ...node,
      id,
      source,
      name: source.name,
      parentId: node.parentId ? fileId(paths.get(node.parentId)!) : null,
    };
  }
  return { ...project, nodes, updatedAt: new Date().toISOString() };
}
