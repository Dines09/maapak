// Ruler skins (§4.5). Skins never reduce tick contrast (§8): ink is forced to ≥ 7:1 against the
// effective body colour, falling back to black or white.
import { blend, inkFor } from '../core/color';

export type SkinId = 'steel' | 'white' | 'acrylic' | 'yellow' | 'night';

export interface SkinSpec {
  id: SkinId;
  /** Base body colour. */
  body: string;
  /** Second gradient stop (brushed metal etc.). */
  body2?: string;
  /** Body opacity (acrylic is see-through). */
  alpha: number;
  preferredInk: string;
  /** Fine brushed-metal streaks. */
  brushed?: boolean;
}

export const SKINS: Record<SkinId, SkinSpec> = {
  steel: { id: 'steel', body: '#d2d6da', body2: '#a9b0b7', alpha: 1, preferredInk: '#101214', brushed: true },
  white: { id: 'white', body: '#f8f8f4', alpha: 1, preferredInk: '#111111' },
  acrylic: { id: 'acrylic', body: '#d8ecff', alpha: 0.35, preferredInk: '#0a1a33' },
  yellow: { id: 'yellow', body: '#f6c915', body2: '#e9b800', alpha: 1, preferredInk: '#111111' },
  night: { id: 'night', body: '#0b1016', alpha: 1, preferredInk: '#7dffb3' },
};

export const SKIN_IDS = Object.keys(SKINS) as SkinId[];

/** What the body actually looks like over the background (matters for acrylic). */
export function effectiveBody(skin: SkinSpec, bg: string): string {
  const mid = skin.body2 ? blend(skin.body, skin.body2, 0.5) : skin.body;
  return skin.alpha < 1 ? blend(mid, bg, skin.alpha) : mid;
}

/** Tick and label colour for a skin over a background. */
export function skinInk(skin: SkinSpec, bg: string): string {
  // Check against both gradient stops so the darker/lighter end also passes.
  const a = skin.alpha < 1 ? blend(skin.body, bg, skin.alpha) : skin.body;
  const b = skin.body2 ? (skin.alpha < 1 ? blend(skin.body2, bg, skin.alpha) : skin.body2) : a;
  const ink = inkFor(a, skin.preferredInk);
  return ink === inkFor(b, skin.preferredInk) ? ink : inkFor(effectiveBody(skin, bg));
}
