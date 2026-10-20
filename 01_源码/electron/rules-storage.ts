import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRules } from '../src/domain/rules';
import type { OrganizeRule, RulesLoad } from '../src/domain/types';
import { writeAtomic } from './operation-plan';
import { noLinks } from './filesystem';

// The user's saved rules live in the app data directory (not in the renderer's
// localStorage: the dev and packaged builds are different origins and would not share
// them). One JSON file, written atomically, `{ "version": 1, "rules": [...] }`.
export const RULES_FILE = 'rules.json';
export const RULES_VERSION = 1;
const MAX_BYTES = 1024 * 1024;

class NewerVersion extends Error {}
type Inspected =
  | { state: 'missing' }
  | { state: 'ok'; rules: OrganizeRule[] }
  | { state: 'damaged'; reason: string };

export class RulesStorage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  get file(): string {
    return path.join(this.directory, RULES_FILE);
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => {}).then(task);
    this.queue = pending;
    return pending;
  }
  // Reads and validates the file. A file written by a newer FileCanvas is neither read
  // nor ever replaced (NewerVersion), so going back to an older build can't destroy it.
  private async inspect(): Promise<Inspected> {
    await noLinks(this.directory, this.file);
    let text: string;
    try {
      if ((await fs.stat(this.file)).size > MAX_BYTES)
        return { state: 'damaged', reason: '文件过大' };
      text = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { state: 'damaged', reason: '不是有效的 JSON' };
    }
    const data = parsed as { version?: unknown; rules?: unknown } | null;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { state: 'damaged', reason: '格式不正确' };
    if (typeof data.version === 'number' && data.version > RULES_VERSION)
      throw new NewerVersion(
        `规则文件来自更新版本的 FileCanvas（版本 ${data.version}），当前版本不会读取或覆盖它。`,
      );
    if (data.version !== RULES_VERSION) return { state: 'damaged', reason: '版本号无效' };
    try {
      return { state: 'ok', rules: normalizeRules(data.rules) };
    } catch (error) {
      return { state: 'damaged', reason: (error as Error).message };
    }
  }
  // A damaged file is kept under another name instead of being overwritten.
  private async setAside(): Promise<string> {
    const name = `rules.damaged-${Date.now()}.json`;
    await fs.rename(this.file, path.join(this.directory, name));
    return name;
  }
  load(): Promise<RulesLoad> {
    return this.enqueue(async () => {
      const found = await this.inspect();
      if (found.state === 'ok') return { rules: found.rules };
      if (found.state === 'missing') return { rules: [] };
      const kept = await this.setAside();
      return {
        rules: [],
        notice: `规则文件无法使用（${found.reason}），已改名为 ${kept} 保留，现在从空列表开始。`,
      };
    });
  }
  // `input` comes from the renderer, so it is validated again here in full.
  async save(input: unknown): Promise<OrganizeRule[]> {
    const rules = normalizeRules(input);
    return this.enqueue(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      await noLinks(this.directory, this.directory);
      const found = await this.inspect();
      if (found.state === 'damaged') await this.setAside();
      await writeAtomic(this.file, { version: RULES_VERSION, rules });
      return rules;
    });
  }
  async flush(): Promise<void> {
    await this.queue.catch(() => {});
  }
}
