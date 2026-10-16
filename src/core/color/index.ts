// Colour science for backgrounds and tick contrast (§8): WCAG luminance + OKLab ΔE.

export type RGB = [number, number, number]; // 0–255

export function parseHex(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Bad colour: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export const srgbToLinear = (c255: number): number => {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Alpha-blend fg over bg. */
export function blend(fg: string, bg: string, alpha: number): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  return toHex([0, 1, 2].map((i) => f[i] * alpha + b[i] * (1 - alpha)) as RGB);
}

export type Lab = [number, number, number];

/** sRGB hex → OKLab (Björn Ottosson). */
export function toOklab(hex: string): Lab {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual difference ΔE in OKLab (Euclidean). */
export function deltaE(a: string, b: string): number {
  const x = toOklab(a);
  const y = toOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The candidate background with the largest perceptual difference from the object colour. */
export function bestBackgroundFor(objectHex: string, candidates: readonly string[]): string {
  let best = candidates[0];
  let bestD = -1;
  for (const c of candidates) {
    const d = deltaE(objectHex, c);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Ink colour for ticks/labels: the preferred colour if it reaches `min` contrast (default 7:1),
 * otherwise whichever of near-black / white contrasts more.
 */
export function inkFor(bgHex: string, preferred?: string, min = 7): string {
  if (preferred && contrastRatio(preferred, bgHex) >= min) return preferred;
  const black = '#000000';
  const white = '#ffffff';
  return contrastRatio(black, bgHex) >= contrastRatio(white, bgHex) ? black : white;
}

/** Pick the palette entry with the best contrast against the background. */
export function mostContrasting(bgHex: string, palette: readonly string[]): string {
  let best = palette[0];
  let bestC = 0;
  for (const p of palette) {
    const c = contrastRatio(p, bgHex);
    if (c > bestC) {
      bestC = c;
      best = p;
    }
  }
  return best;
}

/** HSV (h 0–360, s,v 0–1) → hex. */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return toHex([f(5) * 255, f(3) * 255, f(1) * 255]);
}
