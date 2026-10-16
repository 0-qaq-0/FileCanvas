import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProject } from '../src/domain/workspace';
import type { Project, ProjectRecord } from '../src/domain/types';

export class ProjectStorage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  private filename(id: string): string {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('项目 ID 无效。');
    return path.join(this.directory, `${id}.json`);
  }
  async save(project: Project): Promise<string> {
    validateProject(project);
    const snapshot = JSON.stringify(project, null, 2);
    const filename = this.filename(project.id);
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true });
        await fs.writeFile(`${filename}.tmp`, snapshot, 'utf8');
        await fs.rename(`${filename}.tmp`, filename);
        await fs.writeFile(path.join(this.directory, 'last-project'), project.id, 'utf8');
        return filename;
      });
    this.queue = pending;
    return pending;
  }
  async load(id: string): Promise<Project> {
    const file = this.filename(id);
    const stat = await fs.stat(file);
    if (stat.size > 12 * 1024 * 1024) throw new Error('项目文件过大。');
    const project = JSON.parse(await fs.readFile(file, 'utf8')) as Project;
    validateProject(project);
    if (project.id !== id) throw new Error('项目文件标识不匹配。');
    return project;
  }
  async list(): Promise<ProjectRecord[]> {
    await fs.mkdir(this.directory, { recursive: true });
    const records: ProjectRecord[] = [];
    for (const filename of await fs.readdir(this.directory)) {
      if (!filename.endsWith('.json')) continue;
      try {
        const p = await this.load(filename.slice(0, -5));
        records.push({ id: p.id, name: p.name, rootPath: p.rootPath, updatedAt: p.updatedAt });
      } catch {
        /* damaged projects remain untouched */
      }
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async last(): Promise<Project | null> {
    try {
      return await this.load(
        (await fs.readFile(path.join(this.directory, 'last-project'), 'utf8')).trim(),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async flush(): Promise<void> {
    await this.queue;
  }
}
