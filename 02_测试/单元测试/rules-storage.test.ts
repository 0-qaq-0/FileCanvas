import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RULES_FILE, RulesStorage } from '../../01_源码/electron/rules-storage';
import type { OrganizeRule } from '../../01_源码/src/domain/types';

let dir: string;
let store: RulesStorage;
const file = () => path.join(dir, RULES_FILE);
const rule = (id: string, over: Partial<OrganizeRule> = {}): OrganizeRule => ({
  id,
  name: `规则 ${id}`,
  folder: '财务/发票',
  match: { keywords: ['发票'], extensions: ['pdf'] },
  ...over,
});
const damaged = async () => (await fs.readdir(dir)).filter((n) => n.startsWith('rules.damaged-'));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-rules-'));
  store = new RulesStorage(dir);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('rules storage', () => {
  it('starts empty when there is no file, and creates nothing by reading', async () => {
    expect(await store.load()).toEqual({ rules: [] });
    expect(await fs.readdir(dir)).toEqual([]);
  });
  it('creates the data directory on first save', async () => {
    const nested = new RulesStorage(path.join(dir, 'not', 'yet'));
    await nested.save([rule('a')]);
    expect((await nested.load()).rules).toHaveLength(1);
  });
  it('round-trips rules in order, with a version, atomically', async () => {
    const rules = [
      rule('a'),
      rule('b', { name: '大文件', folder: '归档', match: { minSizeMB: 100, olderThanDays: 90 } }),
    ];
    expect(await store.save(rules)).toEqual(rules);
    expect(await store.load()).toEqual({ rules });
    const onDisk = JSON.parse(await fs.readFile(file(), 'utf8'));
    expect(onDisk.version).toBe(1);
    expect(onDisk.rules.map((r: OrganizeRule) => r.id)).toEqual(['a', 'b']);
    expect(await fs.readdir(dir)).toEqual([RULES_FILE]);
  });
  it('stores the canonical form of what it is given', async () => {
    const saved = await store.save([
      rule('a', { name: ' 发票 ', folder: ' 财务\\发票/ ', match: { extensions: ['.PDF'] } }),
    ]);
    expect(saved[0]).toEqual(rule('a', { name: '发票', match: { extensions: ['pdf'] } }));
    expect((await store.load()).rules).toEqual(saved);
  });
  it('refuses to save invalid rules and leaves the old file untouched', async () => {
    await store.save([rule('a')]);
    const before = await fs.readFile(file(), 'utf8');
    for (const bad of [
      [rule('a', { folder: 'a/../b' })],
      [rule('a', { match: {} })],
      [rule('a'), rule('a')],
      Array.from({ length: 51 }, (_, i) => rule(`r${i}`)),
      'nope',
      [null],
    ])
      await expect(store.save(bad)).rejects.toThrow();
    expect(await fs.readFile(file(), 'utf8')).toBe(before);
    expect(await damaged()).toEqual([]);
  });
  it('moves a file with broken JSON aside and starts empty', async () => {
    await fs.writeFile(file(), '{ not json', 'utf8');
    const loaded = await store.load();
    expect(loaded.rules).toEqual([]);
    expect(loaded.notice).toContain('JSON');
    const kept = await damaged();
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, kept[0]), 'utf8')).toBe('{ not json');
    expect(await fs.readdir(dir)).not.toContain(RULES_FILE);
    expect(await store.load()).toEqual({ rules: [] });
  });
  it.each([
    ['a missing version', { rules: [] }],
    ['version 0', { version: 0, rules: [] }],
    ['a non-array list', { version: 1, rules: {} }],
    ['an invalid rule', { version: 1, rules: [rule('a'), rule('b', { folder: 'con' })] }],
    ['a rule without conditions', { version: 1, rules: [rule('a', { match: {} })] }],
    ['duplicate ids', { version: 1, rules: [rule('a'), rule('a')] }],
    ['an array', []],
    ['null', null],
  ])('moves aside a file with %s', async (_label, content) => {
    await fs.writeFile(file(), JSON.stringify(content), 'utf8');
    const loaded = await store.load();
    expect(loaded.rules).toEqual([]);
    expect(loaded.notice).toBeTruthy();
    expect(await damaged()).toHaveLength(1);
  });
  it('moves aside an oversized file without reading it', async () => {
    await fs.writeFile(
      file(),
      JSON.stringify({ version: 1, rules: [], pad: 'x'.repeat(1_100_000) }),
    );
    const loaded = await store.load();
    expect(loaded.notice).toContain('过大');
    expect(await damaged()).toHaveLength(1);
  });
  it('keeps a damaged file when saving over it', async () => {
    await fs.writeFile(file(), 'garbage', 'utf8');
    await store.save([rule('a')]);
    expect((await store.load()).rules).toHaveLength(1);
    const kept = await damaged();
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, kept[0]), 'utf8')).toBe('garbage');
  });
  it('neither reads nor replaces a file from a newer version', async () => {
    const future = JSON.stringify({ version: 2, rules: [{ anything: true }] });
    await fs.writeFile(file(), future, 'utf8');
    await expect(store.load()).rejects.toThrow('更新版本');
    await expect(store.save([rule('a')])).rejects.toThrow('更新版本');
    expect(await fs.readFile(file(), 'utf8')).toBe(future);
    expect(await fs.readdir(dir)).toEqual([RULES_FILE]);
  });
  it('applies overlapping saves in the order they were made', async () => {
    const saves = Array.from({ length: 8 }, (_, i) => store.save([rule(`r${i}`)]));
    await Promise.all(saves);
    expect((await store.load()).rules.map((r) => r.id)).toEqual(['r7']);
    expect(await fs.readdir(dir)).toEqual([RULES_FILE]);
  });
  it('keeps working after a failed save', async () => {
    await expect(store.save([rule('a', { folder: '' })])).rejects.toThrow();
    await store.save([rule('b')]);
    expect((await store.load()).rules.map((r) => r.id)).toEqual(['b']);
  });
});
