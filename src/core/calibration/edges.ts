// Usable flat screen area (§5.1). Stored in natural portrait axes, CSS px.

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  cornerRadius: number;
  exclusions: { cx: number; cy: number; r: number }[];
  locked: boolean;
  /** Natural-portrait viewport size (CSS px) when the edges were set. */
  refW: number;
  refH: number;
}

export function defaultEdges(refW: number, refH: number, insetPx: number): EdgeInsets {
  return {
    top: insetPx,
    right: insetPx,
    bottom: insetPx,
    left: insetPx,
    cornerRadius: 0,
    exclusions: [],
    locked: false,
    refW,
    refH,
  };
}

export interface RectPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

function normAngle(a: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(a / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/**
 * Remap natural-portrait insets to the current orientation.
 * angle 90 (device turned counter-clockwise): current top = natural right, current left = natural top.
 */
export function edgesToCurrent(e: EdgeInsets, orientationAngle: number): EdgeInsets {
  const a = normAngle(orientationAngle);
  const { refW: W, refH: H } = e;
  const map = (cx: number, cy: number): [number, number] => {
    switch (a) {
      case 0:
        return [cx, cy];
      case 90:
        return [cy, W - cx];
      case 180:
        return [W - cx, H - cy];
      case 270:
        return [H - cy, cx];
    }
  };
  const ex = e.exclusions.map((z) => {
    const [cx, cy] = map(z.cx, z.cy);
    return { cx, cy, r: z.r };
  });
  switch (a) {
    case 0:
      return { ...e, exclusions: ex };
    case 90:
      return {
        ...e,
        top: e.right,
        right: e.bottom,
        bottom: e.left,
        left: e.top,
        refW: H,
        refH: W,
        exclusions: ex,
      };
    case 180:
      return { ...e, top: e.bottom, right: e.left, bottom: e.top, left: e.right, exclusions: ex };
    case 270:
      return {
        ...e,
        top: e.left,
        right: e.top,
        bottom: e.right,
        left: e.bottom,
        refW: H,
        refH: W,
        exclusions: ex,
      };
  }
}

/** Inverse of edgesToCurrent: insets measured in the current orientation → natural portrait. */
export function edgesToNatural(e: EdgeInsets, orientationAngle: number): EdgeInsets {
  const a = normAngle(orientationAngle);
  const inverse = a === 90 ? 270 : a === 270 ? 90 : a;
  return edgesToCurrent(e, inverse);
}

/** Usable rectangle (CSS px) in a viewport of the given size. */
export function usableRect(e: EdgeInsets, viewportW: number, viewportH: number): RectPx {
  const w = Math.max(0, viewportW - e.left - e.right);
  const h = Math.max(0, viewportH - e.top - e.bottom);
  return { x: e.left, y: e.top, w, h };
}
