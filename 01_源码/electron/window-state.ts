export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}
export const DEFAULT_SIZE = { width: 1380, height: 900 };
export const MIN_SIZE = { width: 1000, height: 680 };

/**
 * Where to open the window, from what was saved last time and the screens there are now. A
 * damaged value or an unplugged monitor falls back to a sensible size the system places itself,
 * so the window can never come up out of reach.
 */
export function fitWindow(saved: unknown, screens: Rect[]): WindowState {
  const main = screens[0] ?? { x: 0, y: 0, ...DEFAULT_SIZE };
  const fallback: WindowState = {
    width: Math.min(DEFAULT_SIZE.width, main.width),
    height: Math.min(DEFAULT_SIZE.height, main.height),
    maximized: false,
  };
  const s = saved as Partial<WindowState> | null;
  if (!s || typeof s !== 'object') return fallback;
  if (![s.width, s.height].every((v) => typeof v === 'number' && Number.isFinite(v)))
    return fallback;
  const placed = [s.x, s.y].every((v) => typeof v === 'number' && Number.isFinite(v));
  const width = Math.max(MIN_SIZE.width, Math.round(s.width!));
  const height = Math.max(MIN_SIZE.height, Math.round(s.height!));
  const maximized = s.maximized === true;
  // At least 120×80 of the window, its title bar included, has to land on a current screen.
  const screen = placed
    ? screens.find(
        (r) =>
          s.x! + width >= r.x + 120 &&
          s.x! <= r.x + r.width - 120 &&
          s.y! >= r.y &&
          s.y! <= r.y + r.height - 80,
      )
    : undefined;
  if (!screen)
    return {
      width: Math.min(width, main.width),
      height: Math.min(height, main.height),
      maximized,
    };
  return {
    x: Math.round(s.x!),
    y: Math.round(s.y!),
    width: Math.min(width, screen.width),
    height: Math.min(height, screen.height),
    maximized,
  };
}
