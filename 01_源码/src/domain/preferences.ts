// Display preferences: how the canvas looks, never what it does. Nothing here may change the
// plan or touch files. Shared by the renderer and the main process, which both normalise, so
// a hand-edited or newer file can never feed an out-of-range value to the UI.
export type CanvasBackground = 'dots' | 'grid' | 'plain';
/** canvas: free layout; tiles: uniform grid; list: details table; groups: tiles in sections. */
export type ViewMode = 'canvas' | 'tiles' | 'list' | 'groups';
export type SortKey = 'name' | 'type' | 'size' | 'modified';
export type SortDir = 'asc' | 'desc';
export type GroupBy = 'type' | 'month' | 'status';

export interface Preferences {
  viewMode: ViewMode;
  /** Order of tiles, groups and list rows; the free canvas keeps its own positions. */
  sortKey: SortKey;
  sortDir: SortDir;
  groupBy: GroupBy;
  /** Size of the cards on the canvas as a fraction of the standard size. */
  iconScale: number;
  background: CanvasBackground;
  /** Thumbnails and text excerpts on cards; off shows plain icons only. */
  showPreviews: boolean;
  /** The one-line shortcut hints under the canvas. */
  showHints: boolean;
  /** The "this folder has N loose files, try a one-click draft" strip. */
  showSuggestions: boolean;
  reduceMotion: boolean;
  /** Dropped cards snap onto the tidy grid; holding Alt while dragging does the opposite. */
  snapToGrid: boolean;
}

export const ICON_SCALE_MIN = 0.7;
export const ICON_SCALE_MAX = 1.6;
export const ICON_SCALE_STEP = 0.05;
export const ICON_PRESETS: { label: string; scale: number }[] = [
  { label: '小', scale: 0.8 },
  { label: '标准', scale: 1 },
  { label: '大', scale: 1.25 },
  { label: '特大', scale: 1.5 },
];

export const VIEW_MODES: ViewMode[] = ['canvas', 'tiles', 'list', 'groups'];
export const SORT_KEYS: SortKey[] = ['name', 'type', 'size', 'modified'];
export const GROUP_BYS: GroupBy[] = ['type', 'month', 'status'];
export const DEFAULT_PREFERENCES: Preferences = {
  viewMode: 'canvas',
  sortKey: 'name',
  sortDir: 'asc',
  groupBy: 'type',
  iconScale: 1,
  background: 'dots',
  showPreviews: true,
  showHints: true,
  showSuggestions: true,
  reduceMotion: false,
  snapToGrid: false,
};

const BACKGROUNDS: CanvasBackground[] = ['dots', 'grid', 'plain'];

/** Snaps to the slider step and keeps the value inside the supported range. */
export function clampIconScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PREFERENCES.iconScale;
  const snapped = Math.round(value / ICON_SCALE_STEP) * ICON_SCALE_STEP;
  const bounded = Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, snapped));
  return Math.round(bounded * 100) / 100;
}

/**
 * Lenient on purpose: a missing or invalid field falls back to its default and unknown fields
 * are dropped, so older and newer files keep working. It never throws.
 */
export function normalizePreferences(input: unknown): Preferences {
  const data =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const flag = (
    key: 'showPreviews' | 'showHints' | 'showSuggestions' | 'reduceMotion' | 'snapToGrid',
  ) => (typeof data[key] === 'boolean' ? (data[key] as boolean) : DEFAULT_PREFERENCES[key]);
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    viewMode: pick(data.viewMode, VIEW_MODES, DEFAULT_PREFERENCES.viewMode),
    sortKey: pick(data.sortKey, SORT_KEYS, DEFAULT_PREFERENCES.sortKey),
    sortDir: pick(data.sortDir, ['asc', 'desc'] as const, DEFAULT_PREFERENCES.sortDir),
    groupBy: pick(data.groupBy, GROUP_BYS, DEFAULT_PREFERENCES.groupBy),
    iconScale: clampIconScale(data.iconScale ?? DEFAULT_PREFERENCES.iconScale),
    background: BACKGROUNDS.includes(data.background as CanvasBackground)
      ? (data.background as CanvasBackground)
      : DEFAULT_PREFERENCES.background,
    showPreviews: flag('showPreviews'),
    showHints: flag('showHints'),
    showSuggestions: flag('showSuggestions'),
    reduceMotion: flag('reduceMotion'),
    snapToGrid: flag('snapToGrid'),
  };
}

export function samePreferences(a: Preferences, b: Preferences): boolean {
  return (Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]).every((k) => a[k] === b[k]);
}

export interface PreferencesLoad {
  preferences: Preferences;
  /** Set when a damaged file was set aside and defaults are used instead. */
  notice?: string;
}
