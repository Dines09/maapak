// DXF R12 ASCII export (§12): LINE, CIRCLE, ARC, TEXT on layers OUTLINE / CENTER / DIM, 1:1 in mm.
// Drawing views use y-down (screen) coordinates; DXF is y-up, so y is negated.
import type { Vec } from '../../core/types';
import type { FractionDenominator, LengthUnit } from '../../core/units';
import type { DimSpec, Entity } from '../../render/types';
import type { RecordView } from '../drawing/model';
import { dimText, layoutDims } from '../drawing/svg';

class Dxf {
  private out: string[] = [];
  pair(code: number, v: string | number): void {
    this.out.push(String(code), typeof v === 'number' ? (Math.round(v * 1e6) / 1e6).toString() : v);
  }
  line(a: Vec, b: Vec, layer: string): void {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    this.pair(10, a[0]);
    this.pair(20, -a[1]);
    this.pair(30, 0);
    this.pair(11, b[0]);
    this.pair(21, -b[1]);
    this.pair(31, 0);
  }
  circle(c: Vec, r: number, layer: string): void {
    this.pair(0, 'CIRCLE');
    this.pair(8, layer);
    this.pair(10, c[0]);
    this.pair(20, -c[1]);
    this.pair(30, 0);
    this.pair(40, r);
  }
  /** Angles in screen degrees (y down); converted to DXF counter-clockwise from +x. */
  arc(c: Vec, r: number, a0: number, a1: number, layer: string): void {
    this.pair(0, 'ARC');
    this.pair(8, layer);
    this.pair(10, c[0]);
    this.pair(20, -c[1]);
    this.pair(30, 0);
    this.pair(40, r);
    this.pair(50, -a1);
    this.pair(51, -a0);
  }
  text(p: Vec, h: number, s: string, layer: string, rot = 0): void {
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.pair(10, p[0]);
    this.pair(20, -p[1]);
    this.pair(30, 0);
    this.pair(40, h);
    this.pair(1, s);
    if (rot) this.pair(50, rot);
    // centre-justified
    this.pair(72, 1);
    this.pair(11, p[0]);
    this.pair(21, -p[1]);
    this.pair(31, 0);
  }
  toString(): string {
    return this.out.join('\n');
  }
}

function entity(d: Dxf, e: Entity, dx: number): void {
  const layer = e.style === 'centre' ? 'CENTER' : 'OUTLINE';
  const sh = (p: Vec): Vec => [p[0] + dx, p[1]];
  switch (e.type) {
    case 'line':
      d.line(sh(e.a), sh(e.b), layer);
      break;
    case 'polyline':
      for (let i = 0; i < (e.closed ? e.points.length : e.points.length - 1); i++) {
        d.line(sh(e.points[i]), sh(e.points[(i + 1) % e.points.length]), layer);
      }
      break;
    case 'circle':
      d.circle(sh(e.center), e.r, layer);
      break;
    case 'arc':
      d.arc(sh(e.center), e.r, e.a0, e.a1, layer);
      break;
  }
}

function dim(d: Dxf, s: DimSpec, dx: number, unit: LengthUnit, den: FractionDenominator): void {
  const t = dimText(s, unit, den).replace('Ø', '%%c').replace('°', '%%d');
  const sh = (p: Vec): Vec => [p[0] + dx, p[1]];
  if (s.type === 'linear' && s.a && s.b) {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
    const u: Vec = [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
    const nl: Vec = [u[1], -u[0]];
    const off = s.offset ?? -8;
    const sg = Math.sign(off) || -1;
    const A: Vec = [s.a[0] + nl[0] * off, s.a[1] + nl[1] * off];
    const B: Vec = [s.b[0] + nl[0] * off, s.b[1] + nl[1] * off];
    d.line(
      sh([s.a[0] + nl[0] * sg, s.a[1] + nl[1] * sg]),
      sh([A[0] + nl[0] * sg * 2, A[1] + nl[1] * sg * 2]),
      'DIM',
    );
    d.line(
      sh([s.b[0] + nl[0] * sg, s.b[1] + nl[1] * sg]),
      sh([B[0] + nl[0] * sg * 2, B[1] + nl[1] * sg * 2]),
      'DIM',
    );
    d.line(sh(A), sh(B), 'DIM');
    const mid: Vec = [(A[0] + B[0]) / 2 + nl[0] * sg * 2, (A[1] + B[1]) / 2 + nl[1] * sg * 2];
    let rot = (-Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (rot > 90 || rot <= -90) rot += 180;
    d.text(sh(mid), 3.5, t, 'DIM', rot);
  } else if ((s.type === 'diameter' || s.type === 'radius') && s.center && s.r) {
    const a = ((s.dirDeg ?? 35) * Math.PI) / 180;
    const u: Vec = [Math.cos(a), -Math.sin(a)];
    const start: Vec =
      s.type === 'diameter' ? [s.center[0] - u[0] * s.r, s.center[1] - u[1] * s.r] : s.center;
    const lead: Vec = [s.center[0] + u[0] * (s.r + 8), s.center[1] + u[1] * (s.r + 8)];
    d.line(sh(start), sh(lead), 'DIM');
    d.text(sh([lead[0] + (u[0] >= 0 ? 8 : -8), lead[1] - 1.5]), 3.5, t, 'DIM');
  } else if (s.type === 'angle' && s.vertex) {
    const r = s.rArc ?? 15;
    d.arc(sh(s.vertex), r, Math.min(s.a1 ?? 0, s.a2 ?? 0), Math.max(s.a1 ?? 0, s.a2 ?? 0), 'DIM');
    const m = (((s.a1 ?? 0) + (s.a2 ?? 0)) / 2) * (Math.PI / 180);
    d.text(sh([s.vertex[0] + Math.cos(m) * (r + 5), s.vertex[1] + Math.sin(m) * (r + 5)]), 3.5, t, 'DIM');
  }
}

/** All views side by side, 1 drawing unit = 1 mm. */
export function recordDxf(views: RecordView[], unit: LengthUnit, den: FractionDenominator): string {
  const d = new Dxf();
  d.pair(0, 'SECTION');
  d.pair(2, 'HEADER');
  d.pair(9, '$ACADVER');
  d.pair(1, 'AC1009');
  d.pair(9, '$INSUNITS');
  d.pair(70, 4);
  d.pair(0, 'ENDSEC');
  d.pair(0, 'SECTION');
  d.pair(2, 'TABLES');
  d.pair(0, 'TABLE');
  d.pair(2, 'LAYER');
  d.pair(70, 3);
  for (const [name, color, lt] of [
    ['OUTLINE', 7, 'CONTINUOUS'],
    ['CENTER', 1, 'CONTINUOUS'],
    ['DIM', 3, 'CONTINUOUS'],
  ] as const) {
    d.pair(0, 'LAYER');
    d.pair(2, name);
    d.pair(70, 0);
    d.pair(62, color);
    d.pair(6, lt);
  }
  d.pair(0, 'ENDTAB');
  d.pair(0, 'ENDSEC');
  d.pair(0, 'SECTION');
  d.pair(2, 'ENTITIES');
  let x = 0;
  for (const v of views) {
    const xs = v.view.outline.flatMap((e) =>
      e.type === 'line'
        ? [e.a[0], e.b[0]]
        : e.type === 'polyline'
          ? e.points.map((p) => p[0])
          : [e.center[0] - e.r, e.center[0] + e.r],
    );
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 0);
    const dx = x - minX + 20;
    for (const e of v.view.outline) entity(d, e, dx);
    for (const s of layoutDims(v.view.dims, 7.7)) dim(d, s, dx, unit, den);
    x = dx + maxX + 30;
  }
  d.pair(0, 'ENDSEC');
  d.pair(0, 'EOF');
  return d.toString() + '\n';
}

/** Minimal parser used by tests: group-code / value pairs and entity counts. */
export function parseDxf(text: string): { pairs: [number, string][]; entities: Record<string, number> } {
  const lines = text.trim().split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`bad group code at line ${i + 1}`);
    pairs.push([code, lines[i + 1]]);
  }
  const entities: Record<string, number> = {};
  let inEnt = false;
  for (const [c, v] of pairs) {
    if (c === 2 && v === 'ENTITIES') inEnt = true;
    else if (c === 0 && v === 'ENDSEC') inEnt = false;
    else if (inEnt && c === 0) entities[v] = (entities[v] ?? 0) + 1;
  }
  return { pairs, entities };
}
