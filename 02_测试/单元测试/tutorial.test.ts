import { describe, expect, it } from 'vitest';
import { placeCard, spotlightBox, SPOT_PADDING } from '../../01_源码/src/domain/tour-layout';
import {
  readTutorialDone,
  TUTORIAL_KEY,
  writeTutorialDone,
} from '../../01_源码/src/domain/tutorial';

const viewport = { width: 1280, height: 800 };
const card = { width: 344, height: 240 };

describe('tour spotlight', () => {
  it('pads the target and clamps it to the window', () => {
    expect(spotlightBox({ x: 100, y: 50, width: 80, height: 30 }, viewport)).toEqual({
      x: 100 - SPOT_PADDING,
      y: 50 - SPOT_PADDING,
      width: 80 + SPOT_PADDING * 2,
      height: 30 + SPOT_PADDING * 2,
    });
    const edge = spotlightBox({ x: 0, y: 0, width: 2000, height: 900 }, viewport)!;
    expect(edge).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it('has no spotlight for a missing, empty or off-screen target', () => {
    expect(spotlightBox(null, viewport)).toBeNull();
    expect(spotlightBox({ x: 10, y: 10, width: 0, height: 40 }, viewport)).toBeNull();
    expect(spotlightBox({ x: 4000, y: 10, width: 50, height: 40 }, viewport)).toBeNull();
  });
});

describe('tour card placement', () => {
  const fits = (p: { left: number; top: number }) =>
    p.left >= 16 &&
    p.top >= 16 &&
    p.left + card.width <= viewport.width - 16 &&
    p.top + card.height <= viewport.height - 16;

  it('centres the card when there is nothing to point at', () => {
    const p = placeCard(null, card, viewport);
    expect(p.placement).toBe('center');
    expect(p.left).toBe((viewport.width - card.width) / 2);
    expect(fits(p)).toBe(true);
  });

  it('puts the card below a control near the top and never lets it leave the window', () => {
    const button = spotlightBox({ x: 1190, y: 12, width: 70, height: 34 }, viewport);
    const p = placeCard(button, card, viewport);
    expect(p.placement).toBe('below');
    expect(p.top).toBeGreaterThan(button!.y + button!.height);
    expect(fits(p)).toBe(true);
  });

  it('flips above, then beside, when there is no room below', () => {
    const low = placeCard({ x: 600, y: 690, width: 80, height: 40 }, card, viewport);
    expect(low.placement).toBe('above');
    expect(fits(low)).toBe(true);
    const tall = placeCard({ x: 20, y: 20, width: 200, height: 760 }, card, viewport);
    expect(tall.placement).toBe('right');
    expect(fits(tall)).toBe(true);
  });

  it('sits on top of a target that fills most of the window', () => {
    const stage = spotlightBox({ x: 0, y: 220, width: 1280, height: 520 }, viewport);
    const p = placeCard(stage, card, viewport);
    expect(p.placement).toBe('inside');
    expect(fits(p)).toBe(true);
  });

  it('still fits a window narrower than the card margin allows', () => {
    const small = { width: 380, height: 300 };
    const p = placeCard({ x: 10, y: 10, width: 60, height: 30 }, card, small);
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.top).toBeGreaterThanOrEqual(16);
  });
});

describe('tutorial flag', () => {
  function memory(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }

  it('is unseen until it is written, then remembered', () => {
    const store = memory();
    expect(readTutorialDone(store)).toBe(false);
    writeTutorialDone(store);
    expect(store.data[TUTORIAL_KEY]).toBe('done');
    expect(readTutorialDone(store)).toBe(true);
  });

  it('survives blocked or missing storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readTutorialDone(blocked)).toBe(false);
    expect(() => writeTutorialDone(blocked)).not.toThrow();
    expect(readTutorialDone(null)).toBe(false);
    expect(() => writeTutorialDone(null)).not.toThrow();
  });
});
