// Vernier caliper (§6.2): beam with main scale, sliding jaw with a vernier plate rendered from the jaw
// position, outside jaws (OD / length / width) and inside knife jaws (ID). No depth rod (2D screen).
import type { FeatureKind, Vec } from '../../core/types';
import {
  add,
  dist,
  fitShift,
  inRect,
  normAngle,
  rad2deg,
  rotateAbout,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { MM_PER_INCH } from '../../core/units';
import type { Handle, LearnInfo, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { SKINS, skinInk } from '../../render/skins';
import { drawKnob, drawMarkerLine, drawScale, drawText, polygonPx } from '../../render/draw';
import { fmtLength, unitLabel } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { at, frameN, frameU, toLocal } from '../frame';

export type CaliperFeature = 'OD' | 'ID' | 'W' | 'L';
export type CaliperSkin = 'vernier' | 'dial' | 'digital';
export type LeastCount = 0.1 | 0.05 | 0.02 | 'in';

export interface CaliperState {
  v: 1;
  id: string;
  tool: 'caliper';
  n: number;
  placed: boolean;
  origin: Vec;
  angle: number;
  /** Beam length (mm, from the zero face). */
  length: number;
  /** Jaw opening (mm). */
  s: number;
  feature: CaliperFeature;
  skin: CaliperSkin;
  lc: LeastCount;
  learn: boolean;
}

const BEAM = 18; // beam height
const SCALE_BASE = 7; // main-scale baseline (offset); vernier plate below it
const JAW = 30; // outside jaw length
const KNIFE = 12; // inside jaw length above the beam
const BACK = 9; // beam / fixed jaw behind the zero face
const PLATE_START = -4; // vernier plate starts this far before the jaw face
const MIN_LEN = 60;
const GRIP: Vec = [15, -24]; // grip knob relative to (s, 0)

const FEATURE_KIND: Record<CaliperFeature, FeatureKind> = {
  OD: 'outerDiameter',
  ID: 'innerDiameter',
  W: 'width',
  L: 'length',
};

/** Vernier geometry per least count: divisions N, division length d (in main units), label step. */
export function vernierSpec(lc: LeastCount): {
  N: number;
  d: number;
  labelEvery: number;
  unitMm: number;
  lcUnit: number;
} {
  switch (lc) {
    case 0.1:
      return { N: 10, d: 0.9, labelEvery: 5, unitMm: 1, lcUnit: 0.1 };
    case 0.05:
      return { N: 20, d: 1.95, labelEvery: 2, unitMm: 1, lcUnit: 0.05 };
    case 0.02:
      return { N: 50, d: 0.98, labelEvery: 5, unitMm: 1, lcUnit: 0.02 };
    case 'in':
      // 25 vernier divisions over 0.600″ against a 0.025″ main scale → 0.001″.
      return { N: 25, d: 0.024, labelEvery: 5, unitMm: MM_PER_INCH, lcUnit: 0.001 };
  }
}

/** What a careful reader sees on the vernier for opening s (mm) (§6.2 Learn mode). */
export function vernierReading(sMm: number, lc: LeastCount): LearnInfo {
  const sp = vernierSpec(lc);
  const isIn = lc === 'in';
  const v = isIn ? sMm / MM_PER_INCH : sMm;
  const mainStep = isIn ? 0.025 : 1;
  let main = Math.floor(v / mainStep + 1e-9) * mainStep;
  let line = Math.round((v - main) / sp.lcUnit);
  if (line >= sp.N) {
    main += mainStep;
    line = 0;
  }
  const reading = Number((main + line * sp.lcUnit).toFixed(isIn ? 4 : 3));
  return { main: Number(main.toFixed(4)), line, leastCount: sp.lcUnit, reading, unit: isIn ? 'in' : 'mm' };
}

export function defaultCaliperState(n = 1): CaliperState {
  return {
    v: 1,
    id: newId('cal'),
    tool: 'caliper',
    n,
    placed: false,
    origin: [0, 0],
    angle: 0,
    length: 140,
    s: 20,
    feature: 'OD',
    skin: 'vernier',
    lc: 0.1,
    learn: false,
  };
}

export class CaliperTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'caliper' as const;
  s: CaliperState;
  private drag: {
    id: string;
    p0: Vec;
    s0: CaliperState;
    c0: Vec;
    a0: number;
    snapped: number | null;
  } | null = null;

  constructor(state: CaliperState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `${this.s.feature}${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  private A(t: number, o: number): Vec {
    return at(this.s.origin, this.s.angle, t, o);
  }
  private inside(): boolean {
    return this.s.feature === 'ID';
  }
  angle(): number {
    return this.s.angle;
  }
  center(): Vec {
    return this.A(this.s.length / 2, 0);
  }

  outline(): Vec[] {
    const L = this.s.length;
    return [
      this.A(-BACK, -JAW - 1),
      this.A(L, -JAW - 1),
      this.A(L, BEAM + KNIFE + 1),
      this.A(-BACK, BEAM + KNIFE + 1),
    ];
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const s = this.s;
    const across = BEAM + KNIFE + JAW + 2;
    if (b.h > b.w * 1.3 && b.w >= across) {
      // Portrait phone: lay the beam along the long axis for a useful opening (n points right).
      s.angle = 90;
      s.length = clamp(b.h - BACK - 3, MIN_LEN, 160);
      s.origin = [b.x + JAW + 1 + Math.max(0, (b.w - across) / 2), b.y + BACK + 1];
    } else {
      s.angle = 0;
      s.length = clamp(b.w - BACK - 3, MIN_LEN, 160);
      const top = b.y + 2 + BEAM + KNIFE;
      const ideal = b.y + b.h / 2 + (BEAM + KNIFE - JAW) / 2;
      s.origin = [b.x + BACK + 1, Math.max(top, Math.min(ideal, b.y + b.h - JAW - 2))];
    }
    s.s = Math.min(20, this.maxOpen());
    s.placed = true;
  }

  fit(b: RectMm): void {
    for (let i = 0; i < 30; i++) {
      this.s.origin = add(this.s.origin, fitShift(this.outline(), b));
      if (this.outline().every((p) => inRect(p, b, 0.01)) || this.s.length <= MIN_LEN) break;
      this.s.length = Math.max(MIN_LEN, this.s.length * 0.92);
      this.s.s = Math.min(this.s.s, this.maxOpen());
    }
  }

  /** Slider length beyond the jaw face: the vernier needs its full length (39 mm for 0.05, 49 mm for 0.02). */
  plateEnd(st = this.s): number {
    if (st.skin === 'dial') return 36;
    if (st.skin === 'digital') return 42;
    const sp = vernierSpec(st.lc);
    return Math.max(16, sp.N * sp.d * sp.unitMm + 6);
  }

  private maxOpen(): number {
    return Math.max(0, this.s.length - this.plateEnd());
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.origin = rotateAbout(this.s.origin, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  snapTargets(): Vec[] {
    return [this.A(0, 0), this.A(this.s.s, 0)];
  }

  focusOf(id: string): Vec | null {
    if (id !== 'jaw') return id === 'rot' ? this.A(this.s.length, 0) : null;
    return this.inside() ? this.A(this.s.s, BEAM + KNIFE * 0.6) : this.A(this.s.s, -JAW * 0.5);
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    const grip = this.A(s.s + GRIP[0], GRIP[1]);
    if (dist(p, grip) <= tol) return { id: 'jaw', kind: 'edge', posMm: grip };
    const [t, o] = toLocal(s.origin, s.angle, p);
    // Sliding jaw / vernier plate also drags the jaw.
    if (
      t >= s.s + PLATE_START &&
      t <= s.s + this.plateEnd() &&
      o >= -JAW &&
      o <= SCALE_BASE &&
      !(t < s.s && o < PLATE_START)
    ) {
      return { id: 'jaw', kind: 'edge', posMm: p };
    }
    if (t >= s.length - 8 && t <= s.length && o >= 0 && o <= BEAM) {
      return { id: 'rot', kind: 'rotate', posMm: this.A(s.length - 4, BEAM / 2) };
    }
    const inBeam = t >= -BACK && t <= s.length && o >= 0 && o <= BEAM;
    const inFixedJaw = t >= -BACK && t <= 0 && o >= -JAW && o <= 0;
    const inKnife = t >= 0 && t <= 3 && o >= BEAM && o <= BEAM + KNIFE;
    if (inBeam || inFixedJaw || inKnife) return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    const c0 = this.center();
    this.drag = {
      id: h.id,
      p0: p,
      s0: structuredClone(this.s),
      c0,
      a0: rad2deg(Math.atan2(p[1] - c0[1], p[0] - c0[0])),
      snapped: null,
    };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const delta = sub(p, d.p0);
    const u = frameU(d.s0.angle);
    if (h.id === 'jaw') {
      s.s = clamp(d.s0.s + delta[0] * u[0] + delta[1] * u[1], 0, this.maxOpen());
    } else if (h.id === 'rot') {
      let a = normAngle(d.s0.angle + normAngle(rad2deg(Math.atan2(p[1] - d.c0[1], p[0] - d.c0[0])) - d.a0));
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 15, 2);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = normAngle(sa);
        } else d.snapped = null;
      }
      s.origin = rotateAbout(d.s0.origin, d.c0, a - d.s0.angle);
      s.angle = a;
    } else {
      s.origin = add(d.s0.origin, delta);
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    this.s.s = clamp(this.s.s + stepMm, 0, this.maxOpen());
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    if (handleId !== 'jaw' || valueMm < 0 || valueMm > this.maxOpen()) return false;
    this.s.s = valueMm;
    return true;
  }

  actions(): ToolAction[] {
    const s = this.s;
    const cycle = <T>(list: readonly T[], v: T): T => list[(list.indexOf(v) + 1) % list.length];
    return [
      {
        id: 'feature',
        labelKey: `caliper.feature.${s.feature}`,
        run: () => (s.feature = cycle(['OD', 'ID', 'W', 'L'] as const, s.feature)),
      },
      {
        id: 'lc',
        labelKey: `caliper.lc.${String(s.lc).replace('.', '_')}`,
        run: () => {
          s.lc = cycle([0.1, 0.05, 0.02, 'in'] as const, s.lc);
          s.s = Math.min(s.s, this.maxOpen());
        },
      },
      {
        id: 'skin',
        labelKey: `caliper.skin.${s.skin}`,
        run: () => {
          s.skin = cycle(['vernier', 'dial', 'digital'] as const, s.skin);
          s.s = Math.min(s.s, this.maxOpen());
        },
      },
      { id: 'learn', labelKey: 'caliper.learn', active: s.learn, run: () => (s.learn = !s.learn) },
      { id: 'rot90', labelKey: 'action.rotate90', run: () => this.rotateBy(90, this.center()) },
    ];
  }

  readouts(): Readout[] {
    const s = this.s;
    const U = this.env.uncertainty(s.s, frameU(s.angle), 2);
    const kind = FEATURE_KIND[s.feature];
    const r: Readout = {
      label: this.label,
      kind,
      value: s.s,
      uncertainty: U,
      primary: true,
      unit: 'length',
      nameKey: `kind.${kind}`,
    };
    if (s.learn && s.skin === 'vernier') r.learn = vernierReading(s.s, s.lc);
    return [r];
  }

  toMeasurements(): ToolMeasurement[] {
    const [r] = this.readouts();
    return [
      {
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      },
    ];
  }

  serialize(): CaliperState {
    return structuredClone(this.s);
  }

  // ---------- rendering ----------

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const L = s.length;
    const skin = SKINS[rc.theme.skin];
    const ink = skinInk(skin, rc.theme.bg);
    const u = frameU(s.angle);
    const n = frameN(s.angle);
    const P = (pts: [number, number][]) => pts.map(([t, o]) => rc.mmToPx(this.A(t, o)));
    const fill = (pts: Vec[], alpha = 1) => {
      polygonPx(ctx, pts);
      if (skin.body2) {
        const g = ctx.createLinearGradient(
          pts[0][0],
          pts[0][1],
          pts[pts.length - 1][0],
          pts[pts.length - 1][1],
        );
        g.addColorStop(0, skin.body);
        g.addColorStop(0.5, skin.body2);
        g.addColorStop(1, skin.body);
        ctx.fillStyle = g;
      } else ctx.fillStyle = skin.body;
      ctx.globalAlpha = skin.alpha * alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
    };
    const ins = this.inside();
    const sj = s.s;

    ctx.save();
    // Beam and fixed jaws.
    fill(
      P([
        [-BACK, 0],
        [L, 0],
        [L, BEAM],
        [-BACK, BEAM],
      ]),
    );
    fill(
      P([
        [-BACK, 0],
        [0, 0],
        [0, -JAW],
        [-2.5, -JAW],
        [-BACK, -JAW * 0.45],
      ]),
    );
    fill(
      P([
        [0, BEAM],
        [0, BEAM + KNIFE],
        [3, BEAM + KNIFE * 0.75],
        [3, BEAM],
      ]),
    );
    // Main scale on the beam.
    ctx.save();
    polygonPx(
      ctx,
      P([
        [-BACK, 0],
        [L, 0],
        [L, BEAM],
        [-BACK, BEAM],
      ]),
    );
    ctx.clip();
    if (s.lc === 'in') this.drawInchMain(rc, ink);
    else
      drawScale(rc, {
        zero: this.A(0, SCALE_BASE),
        dir: u,
        normal: n,
        from: 0,
        to: L,
        kind: 'cm',
        ink,
        textUp: n,
      });
    ctx.restore();

    // Sliding jaw: outside jaw, knife, vernier plate.
    fill(
      P([
        [sj, PLATE_START],
        [sj + 9, PLATE_START],
        [sj + 9, -JAW * 0.45],
        [sj + 2.5, -JAW],
        [sj, -JAW],
      ]),
    );
    fill(
      P([
        [sj, BEAM],
        [sj, BEAM + KNIFE],
        [sj - 3, BEAM + KNIFE * 0.75],
        [sj - 3, BEAM + 2],
        [sj + 10, BEAM + 2],
        [sj + 10, BEAM],
      ]),
    );
    const pe = this.plateEnd();
    const plate = P([
      [sj + PLATE_START, PLATE_START],
      [sj + pe, PLATE_START],
      [sj + pe, SCALE_BASE],
      [sj + PLATE_START, SCALE_BASE],
    ]);
    fill(plate);
    if (s.skin === 'vernier') this.drawVernier(rc, ink);
    ctx.restore();

    // Measuring faces with sighting lines (§7.8).
    const sight = 60;
    const col = [rc.theme.accent, rc.theme.accent2];
    [0, sj].forEach((t, i) => {
      if (ins)
        drawMarkerLine(rc, this.A(t, BEAM), this.A(t, BEAM + KNIFE), this.A(t, BEAM + KNIFE + sight), col[i]);
      else drawMarkerLine(rc, this.A(t, 0), this.A(t, -JAW), this.A(t, -JAW - sight), col[i]);
    });

    if (s.skin === 'dial') this.drawDial(rc);
    if (s.skin === 'digital') this.drawLcd(rc);

    if (!rc.inLoupe) {
      drawKnob(rc, this.A(sj + GRIP[0], GRIP[1]), rc.theme.accent2, {
        active: rc.activeHandleId === 'jaw',
        glyph: 'extend',
      });
      if (rc.selected)
        drawKnob(rc, this.A(L - 4, BEAM / 2), '#334155', {
          glyph: 'rotate',
          active: rc.activeHandleId === 'rot',
        });
      drawText(rc, ins ? 'ID' : s.feature, this.A(-BACK / 2, BEAM / 2), n, {
        sizeMm: 2.6,
        color: ink,
        weight: 800,
      });
    }
  }

  /** Vernier plate ticks from the jaw position; coinciding line highlighted. */
  private drawVernier(rc: RenderContext, ink: string): void {
    const { ctx } = rc;
    const s = this.s;
    const sp = vernierSpec(s.lc);
    const startMm = s.s;
    const read = vernierReading(s.s, s.lc);
    ctx.save();
    for (let k = 0; k <= sp.N; k++) {
      const t = startMm + k * sp.d * sp.unitMm;
      const long = k % sp.labelEvery === 0;
      const len = long ? 3.6 : 2.2;
      const a = rc.mmToPx(this.A(t, SCALE_BASE));
      const b = rc.mmToPx(this.A(t, SCALE_BASE - len));
      const hit = k === read.line;
      ctx.strokeStyle = hit ? rc.theme.accent : ink;
      ctx.lineWidth = hit ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      if (long && !rc.inLoupe) {
        const lbl = s.lc === 'in' ? String(k / 5) : s.lc === 0.1 ? String(k) : String(k / sp.labelEvery);
        drawText(rc, lbl, this.A(t, SCALE_BASE - len - 1.6), frameN(s.angle), {
          sizeMm: 1.8,
          color: hit ? rc.theme.accent : ink,
        });
      }
    }
    ctx.restore();
  }

  /** Inch main scale: 0.025″ divisions, 0.1″ numbered 1–9, inches numbered. */
  private drawInchMain(rc: RenderContext, ink: string): void {
    const { ctx } = rc;
    const s = this.s;
    const nMax = Math.floor(s.length / MM_PER_INCH / 0.025);
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.beginPath();
    for (let k = 0; k <= nMax; k++) {
      const t = k * 0.025 * MM_PER_INCH;
      const len = k % 40 === 0 ? 6 : k % 4 === 0 ? 4.5 : k % 2 === 0 ? 3 : 2;
      const a = rc.mmToPx(this.A(t, SCALE_BASE));
      const b = rc.mmToPx(this.A(t, SCALE_BASE + len));
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let k = 0; k <= nMax; k += 4) {
      const t = k * 0.025 * MM_PER_INCH;
      const label = k % 40 === 0 ? String(k / 40) : String((k / 4) % 10);
      drawText(rc, label, this.A(t, SCALE_BASE + 7.6), frameN(s.angle), {
        sizeMm: k % 40 === 0 ? 2.4 : 1.7,
        color: ink,
      });
    }
    ctx.restore();
  }

  private drawDial(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const c = rc.mmToPx(this.A(s.s + 26, -13));
    const R = 8 * rc.pxPerMm;
    const base = Math.atan2(
      rc.mmToPx(this.A(0, 1))[1] - rc.mmToPx(this.A(0, 0))[1],
      rc.mmToPx(this.A(0, 1))[0] - rc.mmToPx(this.A(0, 0))[0],
    );
    ctx.save();
    ctx.beginPath();
    ctx.arc(c[0], c[1], R, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 2 * rc.dpr;
    ctx.strokeStyle = '#334155';
    ctx.stroke();
    // 1 revolution = 1 mm (or 0.1″), 100 divisions.
    for (let k = 0; k < 100; k++) {
      const a = base + (k / 100) * Math.PI * 2;
      const r0 = R * (k % 10 === 0 ? 0.78 : k % 5 === 0 ? 0.84 : 0.9);
      ctx.beginPath();
      ctx.moveTo(c[0] + Math.cos(a) * r0, c[1] + Math.sin(a) * r0);
      ctx.lineTo(c[0] + Math.cos(a) * R * 0.97, c[1] + Math.sin(a) * R * 0.97);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    }
    const per = s.lc === 'in' ? 0.1 * MM_PER_INCH : 1;
    const frac = (s.s % per) / per;
    const a = base + frac * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    ctx.lineTo(c[0] + Math.cos(a) * R * 0.85, c[1] + Math.sin(a) * R * 0.85);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2 * rc.dpr;
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(c[0], c[1], 2 * rc.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Digital skin: LCD with honest decimals (§6.2: digital readout follows §7.6). */
  private drawLcd(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const [r] = this.readouts();
    const unit = s.lc === 'in' ? 'in' : rc.unit === 'in-frac' ? 'in' : rc.unit;
    const text = fmtLength(r.value, r.uncertainty, unit, rc.fractionDen);
    const quad = [
      this.A(s.s + 11, -4),
      this.A(s.s + 40, -4),
      this.A(s.s + 40, -15),
      this.A(s.s + 11, -15),
    ].map((p) => rc.mmToPx(p));
    ctx.save();
    polygonPx(ctx, quad);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    const inner = [
      this.A(s.s + 13, -5.5),
      this.A(s.s + 38, -5.5),
      this.A(s.s + 38, -11.5),
      this.A(s.s + 13, -11.5),
    ].map((p) => rc.mmToPx(p));
    polygonPx(ctx, inner);
    ctx.fillStyle = '#c5d6a5';
    ctx.fill();
    ctx.restore();
    drawText(rc, text, this.A(s.s + 36.5, -8.5), frameN(s.angle), {
      sizeMm: 4,
      color: '#111827',
      align: 'right',
      weight: 700,
    });
    drawText(
      rc,
      `${unitLabel(unit)}   ON/ZERO · HOLD · ABS/INC`,
      this.A(s.s + 25.5, -13.3),
      frameN(s.angle),
      {
        sizeMm: 1.4,
        color: '#cbd5e1',
      },
    );
  }
}

export function isCaliperState(x: unknown): x is CaliperState {
  const o = x as CaliperState;
  return !!o && o.tool === 'caliper' && typeof o.s === 'number';
}
