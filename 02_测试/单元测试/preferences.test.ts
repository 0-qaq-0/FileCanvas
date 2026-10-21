import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clampIconScale,
  DEFAULT_PREFERENCES,
  ICON_PRESETS,
  ICON_SCALE_MAX,
  ICON_SCALE_MIN,
  normalizePreferences,
  samePreferences,
} from '../../01_源码/src/domain/preferences';
import type { Preferences } from '../../01_源码/src/domain/preferences';
import { PREFERENCES_FILE, PreferencesStorage } from '../../01_源码/electron/preferences-storage';

describe('preference normalisation', () => {
  it('fills everything missing with the defaults and never throws', () => {
    for (const input of [undefined, null, 5, 'x', [], {}])
      expect(normalizePreferences(input)).toEqual(DEFAULT_PREFERENCES);
  });
  it('keeps valid values and drops unknown fields', () => {
    const chosen: Preferences = {
      viewMode: 'list',
      sortKey: 'size',
      sortDir: 'desc',
      groupBy: 'month',
      iconScale: 1.25,
      background: 'grid',
      showPreviews: false,
      showHints: false,
      showSuggestions: false,
      reduceMotion: true,
      snapToGrid: true,
    };
    expect(normalizePreferences({ ...chosen, surprise: 1 })).toEqual(chosen);
  });
  it('replaces invalid values one by one instead of rejecting the whole object', () => {
    expect(
      normalizePreferences({
        iconScale: 'big',
        background: 'stripes',
        showPreviews: 'yes',
        showHints: false,
      }),
    ).toEqual({ ...DEFAULT_PREFERENCES, showHints: false });
  });
  it('snaps the icon size to the slider step and keeps it in range', () => {
    expect(clampIconScale(1.07)).toBe(1.05);
    expect(clampIconScale(1.026)).toBe(1.05);
    expect(clampIconScale(0.1)).toBe(ICON_SCALE_MIN);
    expect(clampIconScale(99)).toBe(ICON_SCALE_MAX);
    expect(clampIconScale(NaN)).toBe(1);
    expect(clampIconScale(Infinity)).toBe(1);
    expect(clampIconScale('1.5')).toBe(1);
  });
  it('offers presets that are already valid sizes', () => {
    for (const preset of ICON_PRESETS) expect(clampIconScale(preset.scale)).toBe(preset.scale);
    expect(ICON_PRESETS.some((p) => p.scale === 1)).toBe(true);
  });
  it('accepts only the known views, sort keys and groupings', () => {
    expect(
      normalizePreferences({
        viewMode: 'cover-flow',
        sortKey: 'colour',
        sortDir: 'up',
        groupBy: 'size',
      }),
    ).toEqual(DEFAULT_PREFERENCES);
    expect(
      normalizePreferences({
        viewMode: 'groups',
        sortKey: 'modified',
        sortDir: 'desc',
        groupBy: 'status',
      }),
    ).toMatchObject({
      viewMode: 'groups',
      sortKey: 'modified',
      sortDir: 'desc',
      groupBy: 'status',
    });
  });
  it('compares preferences field by field', () => {
    expect(samePreferences(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES })).toBe(true);
    expect(samePreferences(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, iconScale: 1.5 })).toBe(
      false,
    );
  });
});

let dir: string;
let store: PreferencesStorage;
const file = () => path.join(dir, PREFERENCES_FILE);
const damaged = async () =>
  (await fs.readdir(dir)).filter((n) => n.startsWith('preferences.damaged-'));
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-prefs-'));
  store = new PreferencesStorage(dir);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('preferences storage', () => {
  it('uses the defaults when there is no file and creates nothing by reading', async () => {
    expect(await store.load()).toEqual({ preferences: DEFAULT_PREFERENCES });
    expect(await fs.readdir(dir)).toEqual([]);
  });
  it('creates the data directory on first save', async () => {
    const nested = new PreferencesStorage(path.join(dir, 'not', 'yet'));
    await nested.save({ ...DEFAULT_PREFERENCES, iconScale: 1.5 });
    expect((await nested.load()).preferences.iconScale).toBe(1.5);
  });
  it('round-trips with a version, atomically', async () => {
    const chosen = { ...DEFAULT_PREFERENCES, iconScale: 0.8, background: 'plain' as const };
    expect(await store.save(chosen)).toEqual(chosen);
    expect(await store.load()).toEqual({ preferences: chosen });
    const onDisk = JSON.parse(await fs.readFile(file(), 'utf8'));
    expect(onDisk.version).toBe(1);
    expect(onDisk.preferences).toEqual(chosen);
    expect(await fs.readdir(dir)).toEqual([PREFERENCES_FILE]);
  });
  it('stores the canonical form of whatever the renderer sends', async () => {
    const saved = await store.save({ iconScale: 9, background: 'x', reduceMotion: true, extra: 1 });
    expect(saved).toEqual({
      ...DEFAULT_PREFERENCES,
      iconScale: ICON_SCALE_MAX,
      reduceMotion: true,
    });
    expect(JSON.parse(await fs.readFile(file(), 'utf8')).preferences).toEqual(saved);
  });
  it('reads a hand-edited file safely: bad fields fall back, good ones stay', async () => {
    await fs.writeFile(
      file(),
      JSON.stringify({ version: 1, preferences: { iconScale: -4, showHints: false } }),
    );
    expect((await store.load()).preferences).toEqual({
      ...DEFAULT_PREFERENCES,
      iconScale: ICON_SCALE_MIN,
      showHints: false,
    });
    expect(await damaged()).toEqual([]);
  });
  it('moves a file with broken JSON aside and uses the defaults', async () => {
    await fs.writeFile(file(), '{ not json', 'utf8');
    const loaded = await store.load();
    expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(loaded.notice).toContain('JSON');
    const kept = await damaged();
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, kept[0]), 'utf8')).toBe('{ not json');
    expect(await fs.readdir(dir)).not.toContain(PREFERENCES_FILE);
  });
  it.each([
    ['a missing version', { preferences: {} }],
    ['version 0', { version: 0, preferences: {} }],
    ['an array', []],
    ['null', null],
  ])('moves aside a file with %s', async (_label, content) => {
    await fs.writeFile(file(), JSON.stringify(content), 'utf8');
    const loaded = await store.load();
    expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(loaded.notice).toBeTruthy();
    expect(await damaged()).toHaveLength(1);
  });
  it('moves aside an oversized file without reading it', async () => {
    await fs.writeFile(
      file(),
      JSON.stringify({ version: 1, preferences: {}, pad: 'x'.repeat(70_000) }),
    );
    expect((await store.load()).notice).toContain('过大');
    expect(await damaged()).toHaveLength(1);
  });
  it('keeps a damaged file when saving over it', async () => {
    await fs.writeFile(file(), 'garbage', 'utf8');
    await store.save({ ...DEFAULT_PREFERENCES, iconScale: 1.25 });
    expect((await store.load()).preferences.iconScale).toBe(1.25);
    const kept = await damaged();
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, kept[0]), 'utf8')).toBe('garbage');
  });
  it('shows defaults for a newer file, and never replaces it', async () => {
    const future = JSON.stringify({ version: 2, preferences: { iconScale: 2 } });
    await fs.writeFile(file(), future, 'utf8');
    const loaded = await store.load();
    expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(loaded.notice).toContain('更新版本');
    await expect(store.save(DEFAULT_PREFERENCES)).rejects.toThrow('更新版本');
    expect(await fs.readFile(file(), 'utf8')).toBe(future);
    expect(await fs.readdir(dir)).toEqual([PREFERENCES_FILE]);
  });
  it('applies overlapping saves in the order they were made', async () => {
    const sizes = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];
    await Promise.all(sizes.map((iconScale) => store.save({ ...DEFAULT_PREFERENCES, iconScale })));
    expect((await store.load()).preferences.iconScale).toBe(1.4);
    expect(await fs.readdir(dir)).toEqual([PREFERENCES_FILE]);
  });
});
