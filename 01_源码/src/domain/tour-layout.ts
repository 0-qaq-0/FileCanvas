// Geometry for the new-user tour: where the spotlight sits and where the explanation card
// goes. Pure functions so the placement rules can be unit-tested without a browser.
export type Box = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type CardSize = { width: number; height: number };
export type Placement = 'below' | 'above' | 'right' | 'left' | 'inside' | 'center';
export type CardPlacement = { left: number; top: number; placement: Placement };

export const SPOT_PADDING = 6;
const GAP = 14;
const MARGIN = 16;
// A target that fills this much of the window is "the stage": the card sits on top of it
// instead of looking for free space around it.
const STAGE_RATIO = 0.4;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/** Padded, window-clamped highlight box; null when the target is missing or has no size. */
export function spotlightBox(target: Box | null, viewport: Viewport): Box | null {
  if (!target || target.width < 1 || target.height < 1) return null;
  const left = Math.max(0, target.x - SPOT_PADDING);
  const top = Math.max(0, target.y - SPOT_PADDING);
  const right = Math.min(viewport.width, target.x + target.width + SPOT_PADDING);
  const bottom = Math.min(viewport.height, target.y + target.height + SPOT_PADDING);
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function placeCard(spot: Box | null, card: CardSize, viewport: Viewport): CardPlacement {
  const maxLeft = viewport.width - card.width - MARGIN;
  const maxTop = viewport.height - card.height - MARGIN;
  const centered = (placement: Placement): CardPlacement => ({
    left: clamp((viewport.width - card.width) / 2, MARGIN, maxLeft),
    top: clamp((viewport.height - card.height) / 2, MARGIN, maxTop),
    placement,
  });
  if (!spot) return centered('center');
  const middleX = spot.x + spot.width / 2 - card.width / 2;
  const middleY = spot.y + spot.height / 2 - card.height / 2;
  if ((spot.width * spot.height) / (viewport.width * viewport.height) >= STAGE_RATIO)
    return {
      left: clamp(middleX, MARGIN, maxLeft),
      top: clamp(middleY, MARGIN, maxTop),
      placement: 'inside',
    };
  const below = spot.y + spot.height + GAP;
  if (below <= maxTop)
    return { left: clamp(middleX, MARGIN, maxLeft), top: below, placement: 'below' };
  const above = spot.y - GAP - card.height;
  if (above >= MARGIN)
    return { left: clamp(middleX, MARGIN, maxLeft), top: above, placement: 'above' };
  const right = spot.x + spot.width + GAP;
  if (right <= maxLeft)
    return { left: right, top: clamp(middleY, MARGIN, maxTop), placement: 'right' };
  const left = spot.x - GAP - card.width;
  if (left >= MARGIN) return { left, top: clamp(middleY, MARGIN, maxTop), placement: 'left' };
  return centered('center');
}
