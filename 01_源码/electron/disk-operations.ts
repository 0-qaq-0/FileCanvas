import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkPath, generatePreview, noLinks, validateAuthorized, inside } from './filesystem';
import {
  digest,
  hashFile,
  identity,
  inventory,
  inventoryDigest,
  originalProject,
  rebase,
  statOrNull,
  writeAtomic,
} from './operation-plan';
import type { Inventory } from './operation-plan';
import type { Project, Preview, OperationStatus, OperationProgress } from '../src/domain/types';

interface FileMove {
  source: string;
  target: string;
  stage: string;
  sha256: string;
  identity: string;
}
interface Journal {
  version: 2;
  id: string;
  root: string;
  projectId: string;
  status:
    | 'prepared'
    | 'applying'
    | 'applied'
    | 'restoring'
    | 'rolled-back'
    | 'needs-attention'
    | 'undone';
  before: Project;
  planned: Project;
  committed?: Project;
  acknowledged: boolean;
  moves: FileMove[];
  createdDirectories: string[];
  removedDirectories: string[];
  baseline: Inventory;
  staging: string;
  createdAt: string;
  error?: string;
}
interface Prepared {
  id: string;
  projectDigest: string;
  baseline: Inventory;
  hashes: Record<string, string>;
}
const recoverable = ['prepared', 'applying', 'restoring', 'needs-attention'];
const byDepth = (a: string, b: string) => a.split(path.sep).length - b.split(path.sep).length;

export class DiskOperations {
  private running = false;
  private prepared: Prepared | null = null;
  constructor(
    private directory: string,
    private progress: (p: OperationProgress) => void = () => {},
  ) {}
  isBusy() {
    return this.running;
  }
  private filename(projectId: string) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(projectId)) throw new Error('项目 ID 无效。');
    return path.join(this.directory, `${projectId}.json`);
  }
  private async save(j: Journal) {
    await fs.mkdir(this.directory, { recursive: true });
    await noLinks(this.directory, this.directory);
    await writeAtomic(this.filename(j.projectId), j);
  }
  private async load(root: string, projectId: string): Promise<Journal | null> {
    const filename = this.filename(projectId);
    await noLinks(this.directory, filename);
    let raw: any;
    try {
      if ((await fs.stat(filename)).size > 32 * 1024 * 1024) throw new Error('整理记录过大。');
      raw = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    if (raw.root !== root || raw.projectId !== projectId)
      throw new Error('整理记录与当前项目不一致。');
    validateAuthorized(raw.before, root);
    if (raw.version === undefined) return this.migrateLegacy(raw, filename);
    if (raw.version !== 2)
      throw new Error('整理记录来自不支持的版本，请保留文件并使用对应版本恢复。');
    validateAuthorized(raw.planned, root);
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(raw.id) ||
      raw.staging !== path.join(root, `.filecanvas-operation-${raw.id}`)
    )
      throw new Error('恢复区路径无效。');
    if (
      ![
        'prepared',
        'applying',
        'applied',
        'restoring',
        'rolled-back',
        'needs-attention',
        'undone',
      ].includes(raw.status)
    )
      throw new Error('整理记录状态无效。');
    for (const m of raw.moves) {
      checkPath(root, m.source);
      checkPath(root, m.target);
      checkPath(root, m.stage);
      if (
        path.dirname(m.stage) !== raw.staging ||
        !/^[a-f0-9]{64}$/.test(m.sha256) ||
        typeof m.identity !== 'string'
      )
        throw new Error('文件恢复记录无效。');
    }
    for (const d of [
      ...raw.createdDirectories,
      ...raw.removedDirectories,
      ...Object.keys(raw.baseline),
    ])
      checkPath(root, d);
    return raw as Journal;
  }
  private async migrateLegacy(raw: any, filename: string): Promise<Journal> {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(raw.id)) throw new Error('旧记录 ID 无效。');
    const staging = path.join(raw.root, `.filecanvas-operation-${raw.id}`);
    const baseline = await inventory(raw.root, staging);
    const moves: FileMove[] = [];
    for (const [index, m] of raw.moves.entries()) {
      checkPath(raw.root, m.source);
      checkPath(raw.root, m.target);
      await noLinks(raw.root, m.source);
      await noLinks(raw.root, m.target);
      const a = await statOrNull(m.source),
        b = await statOrNull(m.target),
        s = a ?? b;
      if (
        !s?.isFile() ||
        (a && b && identity(a) !== identity(b)) ||
        (await hashFile(a ? m.source : m.target)) !== m.sha256
      )
        throw new Error('旧记录中的文件发生变化，已保留记录，请先核对文件。');
      moves.push({
        source: m.source,
        target: m.target,
        sha256: m.sha256,
        identity: identity(s),
        stage: path.join(staging, `${index}`),
      });
      delete baseline[m.target];
      baseline[m.source] = {
        kind: 'file',
        identity: identity(s),
        size: s.size.toString(),
        modified: s.mtimeNs.toString(),
      };
    }
    for (const d of raw.directories) {
      checkPath(raw.root, d);
      delete baseline[d];
    }
    const j: Journal = {
      version: 2,
      id: raw.id,
      root: raw.root,
      projectId: raw.projectId,
      status: raw.status,
      before: raw.before,
      planned: raw.before,
      acknowledged: true,
      moves,
      createdDirectories: raw.directories,
      removedDirectories: [],
      baseline,
      staging,
      createdAt: raw.createdAt,
    };
    await fs.copyFile(filename, `${filename}.v1-backup`, fs.constants.COPYFILE_EXCL).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
    await this.save(j);
    return j;
  }
  private async pending(root: string): Promise<Journal | null> {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of await fs.readdir(this.directory)) {
      if (!/^[a-zA-Z0-9-]+\.json$/.test(name)) continue;
      await noLinks(this.directory, path.join(this.directory, name));
      const raw = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'));
      if (raw.root === root && recoverable.includes(raw.status))
        return this.load(root, name.slice(0, -5));
    }
    return null;
  }
  async status(root: string, projectId: string): Promise<OperationStatus | null> {
    const j = (await this.pending(root)) ?? (await this.load(root, projectId));
    if (!j) return null;
    return {
      id: j.id,
      projectId: j.projectId,
      status: j.status,
      needsRecovery: recoverable.includes(j.status),
      canUndo: j.status === 'applied' || recoverable.includes(j.status),
      createdAt: j.createdAt,
      message:
        j.error ??
        (recoverable.includes(j.status)
          ? '上次文件整理未完成，请先恢复文件位置。'
          : j.status === 'applied'
            ? '上次整理已应用并核验，可恢复文件位置。'
            : '文件位置已恢复。'),
    };
  }
  async available(root: string, projectId: string) {
    return !!(await this.status(root, projectId))?.canUndo;
  }
  async acknowledge(root: string, projectId: string) {
    const j = await this.load(root, projectId);
    if (j) {
      j.acknowledged = true;
      await this.save(j);
    }
  }
  async reconcile(project: Project): Promise<Project> {
    const j = await this.load(project.rootPath, project.id);
    if (j?.committed && !j.acknowledged && !recoverable.includes(j.status))
      return structuredClone(j.committed);
    return project;
  }
  async preview(root: string, project: Project): Promise<Preview> {
    this.prepared = null;
    const preview = await generatePreview(root, project);
    if (await this.pending(root)) {
      preview.changes.forEach((c) => c.issues.push('此目录有未完成整理，请先恢复。'));
      preview.issues = preview.changes.filter((c) => c.issues.length).length;
      return preview;
    }
    if (preview.issues || !preview.changed) return preview;
    const baseline = await inventory(root);
    const hashes: Record<string, string> = {};
    for (const c of preview.changes.filter(
      (c) => c.source && project.nodes[c.id].kind === 'file' && c.kind !== 'unchanged',
    ))
      hashes[c.source!] = await hashFile(c.source!);
    const id = randomUUID();
    this.prepared = { id, projectDigest: digest(project), baseline, hashes };
    return {
      ...preview,
      planId: id,
      preserved: Object.keys(baseline).filter(
        (p) => !Object.values(project.nodes).some((n) => n.source?.path === p),
      ).length,
    };
  }
  private emit(j: Journal, phase: string, completed: number, total: number) {
    this.progress({ operationId: j.id, phase, completed, total });
  }
  private async assertFile(j: Journal, filename: string, m: FileMove) {
    await noLinks(j.root, filename);
    const stat = await statOrNull(filename);
    if (!stat) return false;
    if (!stat.isFile() || identity(stat) !== m.identity || (await hashFile(filename)) !== m.sha256)
      throw new Error(`文件被修改或位置被占用，已停止且不覆盖：${filename}`);
    return true;
  }
  private async mkdir(j: Journal, directory: string): Promise<void> {
    checkPath(j.root, directory);
    await noLinks(j.root, directory);
    const stat = await statOrNull(directory);
    if (stat) {
      if (!stat.isDirectory()) throw new Error(`目标上级不是文件夹：${directory}`);
      return;
    }
    await this.mkdir(j, path.dirname(directory));
    await fs.mkdir(directory);
  }
  private async secure(j: Journal) {
    await this.mkdir(j, j.staging);
    // The persisted intent contains all endpoints. Physical identity, rather
    // than a possibly stale step counter, determines recovery after exit.
    for (const m of j.moves) {
      const stage = await this.assertFile(j, m.stage, m);
      const source = await this.assertFile(j, m.source, m);
      const target = await this.assertFile(j, m.target, m);
      if (!stage) {
        const available = source ? m.source : target ? m.target : null;
        if (!available) throw new Error(`无法恢复：文件已消失：${m.source}`);
        await fs.link(available, m.stage);
        await this.assertFile(j, m.stage, m);
      }
    }
  }
  private async evacuate(j: Journal) {
    for (const [i, m] of j.moves.entries()) {
      await this.assertFile(j, m.stage, m);
      const seen = new Set<string>();
      for (const filename of [m.source, m.target]) {
        if (seen.has(filename.toLowerCase())) continue;
        seen.add(filename.toLowerCase());
        if (await this.assertFile(j, filename, m)) await fs.unlink(filename);
      }
      this.emit(j, '调整文件位置', i + 1, j.moves.length);
    }
  }
  private async removeEmpty(j: Journal, directories: string[], keepNonempty = false) {
    for (const d of [...directories].sort((a, b) => byDepth(b, a))) {
      await noLinks(j.root, d);
      try {
        await fs.rmdir(d);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || (keepNonempty && (code === 'ENOTEMPTY' || code === 'EEXIST')))
          continue;
        throw new Error(`目录不为空或无法调整，已停止：${d}`);
      }
    }
  }
  private async place(j: Journal, restore: boolean) {
    await this.secure(j);
    await this.evacuate(j);
    await this.removeEmpty(j, restore ? j.createdDirectories : j.removedDirectories, restore);
    const directories = restore
      ? Object.keys(j.baseline).filter((p) => j.baseline[p].kind === 'folder')
      : j.createdDirectories;
    for (const d of [...directories].sort(byDepth)) await this.mkdir(j, d);
    for (const [i, m] of j.moves.entries()) {
      const destination = restore ? m.source : m.target;
      await this.mkdir(j, path.dirname(destination));
      await this.assertFile(j, m.stage, m);
      await fs.link(m.stage, destination);
      await this.assertFile(j, destination, m);
      this.emit(j, restore ? '恢复原位置' : '写入最终位置', i + 1, j.moves.length);
    }
  }
  private expected(j: Journal, restore: boolean): Inventory {
    const result = structuredClone(j.baseline);
    if (!restore) {
      for (const m of j.moves) delete result[m.source];
      for (const d of j.removedDirectories) delete result[d];
      for (const m of j.moves) result[m.target] = j.baseline[m.source];
      for (const d of j.createdDirectories)
        result[d] = { kind: 'folder', identity: '', size: '', modified: '' };
    }
    return result;
  }
  private async verify(j: Journal, restore: boolean) {
    this.emit(j, '核对真实目录与内容', 0, j.moves.length);
    const current = await inventory(j.root, j.staging),
      expected = this.expected(j, restore);
    if (inventoryDigest(current) !== inventoryDigest(expected))
      throw new Error('真实目录与确认计划不一致，或未参与文件被外部改变；请查看恢复任务。');
    for (const m of j.moves) {
      const destination = restore ? m.source : m.target;
      if (!(await this.assertFile(j, destination, m)))
        throw new Error(`核验缺少文件：${destination}`);
    }
  }
  private async cleanup(j: Journal) {
    for (const m of j.moves) {
      if (await this.assertFile(j, m.stage, m)) await fs.unlink(m.stage);
    }
    await this.removeEmpty(j, [j.staging]);
  }
  private async restore(j: Journal, status: 'undone' | 'rolled-back') {
    // Preserve later changes to unrelated files. Only this operation's paths
    // and empty directories belong to recovery, not the whole historical tree.
    const preserved = await inventory(j.root, j.staging);
    const endpoints = new Set(
      j.moves.flatMap((m) => [m.source.toLowerCase(), m.target.toLowerCase()]),
    );
    for (const p of Object.keys(preserved)) if (endpoints.has(p.toLowerCase())) delete preserved[p];
    for (const d of [...j.createdDirectories].sort((a, b) => byDepth(b, a))) {
      if (!Object.keys(preserved).some((p) => p !== d && inside(d, p))) delete preserved[d];
    }
    for (const d of j.removedDirectories)
      preserved[d] = j.baseline[d] ?? { kind: 'folder', identity: '', size: '', modified: '' };
    for (const m of j.moves) {
      preserved[m.source] = j.baseline[m.source];
      let d = path.dirname(m.source);
      while (d !== j.root) {
        preserved[d] ??= j.baseline[d] ?? { kind: 'folder', identity: '', size: '', modified: '' };
        d = path.dirname(d);
      }
    }
    j.baseline = preserved;
    j.status = 'restoring';
    j.acknowledged = false;
    await this.save(j);
    if (inventoryDigest(await inventory(j.root, j.staging)) !== inventoryDigest(j.baseline))
      await this.place(j, true);
    await this.verify(j, true);
    j.committed = await rebase(j.before, true);
    await this.cleanup(j);
    j.status = status;
    j.error = undefined;
    await this.save(j);
    return j.committed;
  }
  async apply(
    root: string,
    project: Project,
    planId?: string,
  ): Promise<{ project: Project; moved: number; message: string }> {
    if (this.running) throw new Error('正在执行文件操作，请稍候。');
    this.running = true;
    let j: Journal | null = null;
    try {
      validateAuthorized(project, root);
      if (await this.pending(root)) throw new Error('上次整理未完成，请先恢复上次文件操作。');
      if (!planId) {
        const p = await this.preview(root, project);
        if (p.issues) throw new Error('存在源文件变化、目标冲突或不支持的操作，请处理预览问题。');
        planId = p.planId;
      }
      const prepared = this.prepared;
      if (
        !prepared ||
        !planId ||
        prepared.id !== planId ||
        prepared.projectDigest !== digest(project)
      )
        throw new Error('整理计划已变化或过期，请重新预览后确认。');
      if (inventoryDigest(await inventory(root)) !== inventoryDigest(prepared.baseline))
        throw new Error('文件在预览后发生变化，请刷新核对并重新预览。');
      for (const [filename, hash] of Object.entries(prepared.hashes))
        if ((await hashFile(filename)) !== hash)
          throw new Error('文件在预览后被修改，请重新核对。');
      const preview = await generatePreview(root, project);
      if (preview.issues)
        throw new Error('存在源文件变化、目标冲突或不支持的操作，请先处理预览问题。');
      if (!preview.changed) throw new Error('当前没有需要应用的路径变化。');
      const previous = await this.load(root, project.id);
      if (previous) {
        const history = path.join(this.directory, 'history');
        await fs.mkdir(history, { recursive: true });
        await noLinks(this.directory, history);
        await writeAtomic(path.join(history, `${previous.id}.json`), previous);
      }
      const id = randomUUID(),
        staging = path.join(root, `.filecanvas-operation-${id}`);
      if (await statOrNull(staging)) throw new Error('恢复区已存在，请重新预览。');
      const files = preview.changes.filter(
        (c) => c.source && project.nodes[c.id].kind === 'file' && c.kind !== 'unchanged',
      );
      const removedDirectories = preview.changes
        .filter((c) => c.source && project.nodes[c.id].kind === 'folder' && c.kind !== 'unchanged')
        .map((c) => c.source!);
      const desiredDirs = new Set(
        preview.changes.filter((c) => project.nodes[c.id].kind === 'folder').map((c) => c.target),
      );
      for (const c of preview.changes) {
        let d = path.dirname(c.target);
        while (d !== root) {
          desiredDirs.add(d);
          d = path.dirname(d);
        }
      }
      const createdDirectories = [...desiredDirs].filter(
        (d) => !prepared.baseline[d] || removedDirectories.includes(d),
      );
      const candidate: Journal = {
        version: 2,
        id,
        root,
        projectId: project.id,
        before: await originalProject(project),
        planned: structuredClone(project),
        acknowledged: false,
        status: 'prepared',
        moves: files.map((c, i) => ({
          source: c.source!,
          target: c.target,
          stage: path.join(staging, `${i}`),
          sha256: prepared.hashes[c.source!],
          identity: prepared.baseline[c.source!].identity,
        })),
        baseline: prepared.baseline,
        removedDirectories,
        createdDirectories,
        staging,
        createdAt: new Date().toISOString(),
      };
      await this.save(candidate);
      j = candidate;
      this.prepared = null;
      j.status = 'applying';
      await this.save(j);
      await this.place(j, false);
      await this.verify(j, false);
      j.committed = await rebase(project);
      await this.cleanup(j);
      j.status = 'applied';
      await this.save(j);
      return {
        project: j.committed,
        moved: j.moves.length,
        message: `已应用并核验：${j.moves.length} 个文件，${removedDirectories.length} 个文件夹调整。可恢复上次文件移动。`,
      };
    } catch (e) {
      if (j) {
        try {
          await this.restore(j, 'rolled-back');
        } catch (rollback) {
          j.status = 'needs-attention';
          j.error = (rollback as Error).message;
          await this.save(j);
          throw new Error(`整理未完成，需要恢复。${j.error}`);
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
      const j = await this.load(root, projectId);
      if (!j || !(j.status === 'applied' || recoverable.includes(j.status)))
        throw new Error('没有可恢复的磁盘整理记录。');
      try {
        return await this.restore(j, 'undone');
      } catch (e) {
        j.status = 'needs-attention';
        j.error = (e as Error).message;
        await this.save(j);
        throw e;
      }
    } finally {
      this.running = false;
    }
  }
}
