import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  checkPath,
  generatePreview,
  noLinks,
  readEntry,
  validateAuthorized,
  fileId,
} from './filesystem';
import { relativeTarget } from '../src/domain/workspace';
import type { Project, NodeMap } from '../src/domain/types';
interface FileMove {
  source: string;
  target: string;
  sha256: string;
  status: 'planned' | 'linked' | 'moved' | 'undone';
}
interface Journal {
  id: string;
  root: string;
  projectId: string;
  status: 'prepared' | 'applying' | 'applied' | 'rolled-back' | 'needs-attention' | 'undone';
  before: Project;
  moves: FileMove[];
  directories: string[];
  createdAt: string;
}
async function hashFile(filename: string) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(filename)) hash.update(block);
  return hash.digest('hex');
}
async function exists(filename: string) {
  try {
    return await fs.lstat(filename);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export class DiskOperations {
  private running = false;
  constructor(private directory: string) {}
  isBusy() {
    return this.running;
  }
  private async save(journal: Journal) {
    await fs.mkdir(this.directory, { recursive: true });
    await noLinks(this.directory, this.directory);
    const filename = path.join(this.directory, `${journal.projectId}.json`);
    await noLinks(this.directory, filename);
    await fs.writeFile(`${filename}.tmp`, JSON.stringify(journal, null, 2), 'utf8');
    await fs.rename(`${filename}.tmp`, filename);
  }
  private async load(root: string, projectId: string): Promise<Journal | null> {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(projectId)) throw new Error('项目 ID 无效。');
    const filename = path.join(this.directory, `${projectId}.json`);
    await noLinks(this.directory, filename);
    try {
      const journal: Journal = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (journal.root !== root || journal.projectId !== projectId)
        throw new Error('整理记录与当前项目不一致。');
      validateAuthorized(journal.before, root);
      for (const m of journal.moves) {
        checkPath(root, m.source);
        checkPath(root, m.target);
      }
      for (const d of journal.directories) checkPath(root, d);
      return journal;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async available(root: string, projectId: string) {
    const j = await this.load(root, projectId);
    return !!j && ['applied', 'needs-attention', 'prepared', 'applying'].includes(j.status);
  }
  private async restoreMoves(journal: Journal) {
    for (const move of journal.moves.filter(
      (m) => m.status !== 'planned' && m.status !== 'undone',
    )) {
      await noLinks(journal.root, move.source);
      await noLinks(journal.root, move.target);
      const source = await exists(move.source),
        target = await exists(move.target);
      if (!target || (await hashFile(move.target)) !== move.sha256)
        throw new Error(`无法撤销：目标文件已消失或被修改：${move.target}`);
      if (source && (source.ino !== target.ino || source.dev !== target.dev))
        throw new Error(`无法撤销：原位置已存在文件：${move.source}`);
    }
    for (const move of [...journal.moves].reverse()) {
      if (move.status === 'planned' || move.status === 'undone') continue;
      await noLinks(journal.root, move.source);
      await noLinks(journal.root, move.target);
      const source = await exists(move.source),
        target = await exists(move.target);
      if (!target) throw new Error(`无法撤销：目标文件已不在原位置：${move.target}`);
      if ((await hashFile(move.target)) !== move.sha256)
        throw new Error(`无法撤销：文件内容已被外部修改：${move.target}`);
      if (source) {
        // A failed unlink during apply can leave our two hard links. Only remove
        // the extra target when it still identifies the very same file.
        if (source.ino !== target.ino || source.dev !== target.dev)
          throw new Error(`无法撤销：原位置已存在文件：${move.source}`);
      } else await fs.link(move.target, move.source);
      await fs.unlink(move.target);
      move.status = 'undone';
      await this.save(journal);
    }
    for (const directory of [...journal.directories].reverse()) {
      await noLinks(journal.root, directory);
      try {
        await fs.rmdir(directory);
      } catch (e) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((e as NodeJS.ErrnoException).code ?? ''))
          throw e;
      }
    }
  }
  async apply(
    root: string,
    project: Project,
  ): Promise<{ project: Project; moved: number; message: string }> {
    if (this.running) throw new Error('正在执行文件操作，请稍候。');
    this.running = true;
    let journal: Journal | null = null;
    try {
      validateAuthorized(project, root);
      const previous = await this.load(root, project.id);
      if (previous && ['prepared', 'applying', 'needs-attention'].includes(previous.status))
        throw new Error('上次整理未完成，请先尝试撤销上次磁盘整理。');
      const preview = await generatePreview(root, project);
      if (!preview.changed) throw new Error('当前没有需要应用的路径变化。');
      if (preview.issues) throw new Error('存在源文件变化或目标冲突，请先处理预览中的问题。');
      if (
        preview.changes.some(
          (c) => c.source && project.nodes[c.id].kind === 'folder' && c.kind !== 'unchanged',
        )
      )
        throw new Error(
          '本次体验支持普通文件移动和新建分类文件夹；已有文件夹整体移动请先改为移动其内部文件。',
        );
      const moves = preview.changes.filter(
        (c) => c.source && project.nodes[c.id].kind === 'file' && c.kind !== 'unchanged',
      );
      if (moves.length > 100) throw new Error('每次最多应用 100 个文件，请分批整理。');
      journal = {
        id: randomUUID(),
        root,
        projectId: project.id,
        status: 'prepared',
        before: structuredClone(project),
        moves: [],
        directories: [],
        createdAt: new Date().toISOString(),
      };
      // Save the on-disk baseline for undo, preserving node coordinates and marks.
      const originalIds = new Map<string, string>();
      for (const node of Object.values(journal.before.nodes))
        if (node.source) originalIds.set(node.source.path.toLowerCase(), node.id);
      for (const node of Object.values(journal.before.nodes))
        if (node.source) {
          let directory = path.dirname(node.source.path);
          while (directory !== root) {
            if (!originalIds.has(directory.toLowerCase())) {
              const source = await readEntry(root, directory);
              originalIds.set(directory.toLowerCase(), source.id);
              journal.before.nodes[source.id] = {
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
      for (const node of Object.values(journal.before.nodes)) {
        if (!node.source) {
          delete journal.before.nodes[node.id];
          continue;
        }
        node.name = node.source.name;
        node.parentId = originalIds.get(path.dirname(node.source.path).toLowerCase()) ?? null;
      }
      for (const change of moves)
        journal.moves.push({
          source: change.source!,
          target: change.target,
          sha256: await hashFile(change.source!),
          status: 'planned',
        });
      await this.save(journal);
      journal.status = 'applying';
      await this.save(journal);
      const ensureDirectory = async (directory: string): Promise<void> => {
        checkPath(root, directory);
        await noLinks(root, directory);
        const stat = await exists(directory);
        if (stat) {
          if (!stat.isDirectory()) throw new Error('目标上级路径不是文件夹。');
          return;
        }
        await ensureDirectory(path.dirname(directory));
        await fs.mkdir(directory);
        journal!.directories.push(directory);
        await this.save(journal!);
      };
      for (const change of preview.changes.filter((c) => project.nodes[c.id].kind === 'folder'))
        await ensureDirectory(change.target);
      for (const move of journal.moves) {
        await noLinks(root, move.source);
        await noLinks(root, move.target);
        await ensureDirectory(path.dirname(move.target));
        if ((await hashFile(move.source)) !== move.sha256)
          throw new Error('文件在确认后发生变化，已停止整理。');
        // link() fails atomically if a target appears, unlike rename() which can
        // overwrite. Only regular files within this local project are supported.
        await fs.link(move.source, move.target);
        move.status = 'linked';
        await this.save(journal);
        if ((await hashFile(move.target)) !== move.sha256)
          throw new Error('移动过程中内容发生变化，已停止整理。');
        await fs.unlink(move.source);
        move.status = 'moved';
        await this.save(journal);
      }
      const nodes: NodeMap = {},
        mapping = new Map<string, string>();
      for (const node of Object.values(project.nodes))
        mapping.set(node.id, fileId(path.join(root, ...relativeTarget(project.nodes, node.id))));
      for (const node of Object.values(project.nodes)) {
        const filename = path.join(root, ...relativeTarget(project.nodes, node.id)),
          source = await readEntry(root, filename),
          id = mapping.get(node.id)!;
        nodes[id] = {
          ...node,
          id,
          source,
          name: source.name,
          parentId: node.parentId ? mapping.get(node.parentId)! : null,
        };
      }
      journal.status = 'applied';
      await this.save(journal);
      return {
        project: { ...project, nodes, updatedAt: new Date().toISOString() },
        moved: moves.length,
        message: `已实际移动 ${moves.length} 个文件；可撤销上次磁盘整理。原有空文件夹保留。`,
      };
    } catch (e) {
      if (journal) {
        try {
          await this.restoreMoves(journal);
          journal.status = 'rolled-back';
          await this.save(journal);
        } catch (rollback) {
          journal.status = 'needs-attention';
          await this.save(journal);
          throw new Error(
            `整理未完成，部分操作需要恢复。${(rollback as Error).message}。记录保存在 ${this.directory}`,
          );
        }
      }
      throw e;
    } finally {
      this.running = false;
    }
  }
  async undo(root: string, projectId: string): Promise<Project> {
    if (this.running) throw new Error('正在执行文件操作，请稍候。');
    this.running = true;
    try {
      const journal = await this.load(root, projectId);
      if (
        !journal ||
        !['applied', 'needs-attention', 'prepared', 'applying'].includes(journal.status)
      )
        throw new Error('没有可撤销的磁盘整理记录。');
      try {
        await this.restoreMoves(journal);
        journal.status = 'undone';
        await this.save(journal);
        const restored = structuredClone(journal.before);
        for (const node of Object.values(restored.nodes))
          if (node.source) node.source = await readEntry(root, node.source.path);
        return { ...restored, updatedAt: new Date().toISOString() };
      } catch (e) {
        journal.status = 'needs-attention';
        await this.save(journal);
        throw e;
      }
    } finally {
      this.running = false;
    }
  }
}
