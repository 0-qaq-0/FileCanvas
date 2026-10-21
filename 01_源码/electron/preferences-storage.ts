import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePreferences } from '../src/domain/preferences';
import type { Preferences, PreferencesLoad } from '../src/domain/preferences';
import { writeAtomic } from './operation-plan';
import { noLinks } from './filesystem';

// Display preferences live in the app data directory next to rules.json, for the same reason:
// the dev and packaged builds are different origins, so localStorage would not be shared.
// One JSON file, written atomically: `{ "version": 1, "preferences": { ... } }`.
export const PREFERENCES_FILE = 'preferences.json';
export const PREFERENCES_VERSION = 1;
const MAX_BYTES = 64 * 1024;

class NewerVersion extends Error {}
type Inspected =
  | { state: 'missing' }
  | { state: 'ok'; preferences: Preferences }
  | { state: 'damaged'; reason: string };

export class PreferencesStorage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  get file(): string {
    return path.join(this.directory, PREFERENCES_FILE);
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => {}).then(task);
    this.queue = pending;
    return pending;
  }
  // A file written by a newer FileCanvas is neither read nor replaced (NewerVersion), so going
  // back to an older build can't destroy the choices made in the newer one.
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
    const data = parsed as { version?: unknown; preferences?: unknown } | null;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { state: 'damaged', reason: '格式不正确' };
    if (typeof data.version === 'number' && data.version > PREFERENCES_VERSION)
      throw new NewerVersion(
        `显示设置文件来自更新版本的 FileCanvas（版本 ${data.version}），当前版本不会读取或覆盖它。`,
      );
    if (data.version !== PREFERENCES_VERSION) return { state: 'damaged', reason: '版本号无效' };
    return { state: 'ok', preferences: normalizePreferences(data.preferences) };
  }
  // A damaged file is kept under another name instead of being overwritten.
  private async setAside(): Promise<string> {
    const name = `preferences.damaged-${Date.now()}.json`;
    await fs.rename(this.file, path.join(this.directory, name));
    return name;
  }
  load(): Promise<PreferencesLoad> {
    return this.enqueue(async () => {
      let found: Inspected;
      try {
        found = await this.inspect();
      } catch (error) {
        if (error instanceof NewerVersion)
          return { preferences: normalizePreferences(null), notice: error.message };
        throw error;
      }
      if (found.state === 'ok') return { preferences: found.preferences };
      if (found.state === 'missing') return { preferences: normalizePreferences(null) };
      const kept = await this.setAside();
      return {
        preferences: normalizePreferences(null),
        notice: `显示设置文件无法使用（${found.reason}），已改名为 ${kept} 保留，现在使用默认设置。`,
      };
    });
  }
  // `input` comes from the renderer, so it is normalised again here.
  async save(input: unknown): Promise<Preferences> {
    const preferences = normalizePreferences(input);
    return this.enqueue(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      await noLinks(this.directory, this.directory);
      const found = await this.inspect();
      if (found.state === 'damaged') await this.setAside();
      await writeAtomic(this.file, { version: PREFERENCES_VERSION, preferences });
      return preferences;
    });
  }
  async flush(): Promise<void> {
    await this.queue.catch(() => {});
  }
}
