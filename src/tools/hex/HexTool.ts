// Hex overlay (§6.6.1): regular hexagon (or square nut) with a squeeze handle on every flat and a rotation
// handle. Readouts AF, AC (= AF × 2/√3) or diagonal (= AF × √2), and the nearest spanner sizes.
import type { Vec } from '../../core/types';
import { add, dirOf, dist, dot, fitShift, normAngle, rad2deg, rotateAbout, scale, snapAngle, sub, type RectMm } from '../../core/geometry';
import { acrossCorners, pointInPolygon, squareDiagonal } from '../../core/geometry/fit';
import { suggestWrenches, metricOrInch } from '../../core/standards/hex';
import { roundUpOneSig } from '../../core/uncertainty';
import { formatNumber } from '../../core/units';
import i18n from '../../i18n';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { drawCross, drawKnob, drawOutline, drawTag, line } from '../../render/draw';
import { fmtLength } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export interface HexState {
  v: 1;
  id: string;
  tool: 'hex';
  n: number;
  placed: boolean;
  mode: 'hex' | 'square';
  c: Vec;
  /** Direction of flat 0's outward normal (deg). */
  angle: number;
  af: number;
  last: number;
}

const KO = 6;

export function defaultHexState(n = 1, mode: 'hex' | 'square' = 'hex'): HexState {
  return { v: 1, id: newId('hex'), tool: 'hex', n, placed: false, mode, c: [0, 0], angle: 0, af: 24, last: 0 };
}

export class HexTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'hex' as const;
  s: HexState;
  private drag: { id: string; p0: Vec; s0: HexState; a0: number; snapped: number | null } | null = null;

  constructor(state: HexState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `AF${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  private sides(): number {
    return this.s.mode === 'hex' ? 6 : 4;
  }
  private step(): number {
    return 360 / this.sides();
  }
  /** Outward normal of flat k. */
  flatDir(k: number, st = this.s): Vec {
    return dirOf(st.angle + k * (360 / (st.mode === 'hex' ? 6 : 4)));
  }
  corners(st = this.s): Vec[] {
    const n = st.mode === 'hex' ? 6 : 4;
    const R = st.mode === 'hex' ? acrossCorners(st.af) / 2 : squareDiagonal(st.af) / 2;
    return Array.from({ length: n }, (_, k) => add(st.c, scale(dirOf(st.angle + (k + 0.5) * (360 / n)), R)));
  }
  angle(): number {
    return this.s.angle;
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    this.s.c = [b.x + b.w / 2, b.y + b.h / 2];
    this.s.af = clamp(Math.min(b.w, b.h) * 0.45, 8, 40);
    this.s.angle = -90;
    this.s.placed = true;
  }

  outline(): Vec[] {
    const s = this.s;
    const knobs = Array.from({ length: this.sides() }, (_, k) => add(s.c, scale(this.flatDir(k), s.af / 2 + KO)));
    return [...this.corners(), ...knobs, this.rotKnob()];
  }

  private rotKnob(): Vec {
    const c0 = this.corners()[0];
    return add(c0, scale(dirOf(this.s.angle + 0.5 * this.step()), KO));
  }

  fit(b: RectMm): void {
    const s = this.s;
    s.af = Math.min(s.af, Math.min(b.w, b.h) * 0.75);
    s.c = add(s.c, fitShift(this.outline(), b));
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.c = rotateAbout(this.s.c, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  snapTargets(): Vec[] {
    return [this.s.c, ...this.corners()];
  }

  focusOf(id: string): Vec | null {
    const m = /^f(\d)$/.exec(id);
    if (m) return add(this.s.c, scale(this.flatDir(Number(m[1])), this.s.af / 2));
    if (id === 'rot') return this.corners()[0];
    return null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    let best: Handle | null = null;
    let bd = Infinity;
    const consider = (id: string, q: Vec, kind: Handle['kind']) => {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind, posMm: q };
      }
    };
    for (let k = 0; k < this.sides(); k++) consider(`f${k}`, add(s.c, scale(this.flatDir(k), s.af / 2 + KO)), 'edge');
    consider('rot', this.rotKnob(), 'rotate');
    if (best) return best;
    if (pointInPolygon(p, this.corners())) return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    const m = /^f(\d)$/.exec(h.id);
    if (m) this.s.last = Number(m[1]);
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), a0: rad2deg(Math.atan2(p[1] - this.s.c[1], p[0] - this.s.c[0])), snapped: null };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const m = /^f(\d)$/.exec(h.id);
    if (m) {
      // Squeeze one flat; the opposite flat stays put and the centre follows.
      const dir = this.flatDir(Number(m[1]), s0);
      const proj = dot(delta, dir);
      const af = Math.max(1, s0.af + proj);
      s.af = af;
      s.c = add(s0.c, scale(dir, (af - s0.af) / 2));
      return;
    }
    if (h.id === 'rot') {
      let a = normAngle(s0.angle + normAngle(rad2deg(Math.atan2(p[1] - s0.c[1], p[0] - s0.c[0])) - d.a0));
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 15, 2);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = normAngle(sa);
        } else d.snapped = null;
      }
      s.angle = a;
      return;
    }
    s.c = add(s0.c, delta);
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    this.s.af = Math.max(1, this.s.af + stepMm);
  }

  setExactValue(_handleId: string, valueMm: number): boolean {
    if (!(valueMm > 0)) return false;
    this.s.af = valueMm;
    return true;
  }

  actions(): ToolAction[] {
    const s = this.s;
    return [
      { id: 'mode', labelKey: s.mode === 'hex' ? 'hex.toSquare' : 'hex.toHex', run: () => (s.mode = s.mode === 'hex' ? 'square' : 'hex') },
      { id: 'rot30', labelKey: s.mode === 'hex' ? 'hex.rotate30' : 'hex.rotate45', run: () => this.rotateBy(this.step() / 2, s.c) },
    ];
  }

  readouts(): Readout[] {
    const s = this.s;
    const U = this.env.uncertainty(s.af, this.flatDir(s.last), 2);
    const t = i18n.t.bind(i18n);
    const sugg = suggestWrenches(s.af, U, 1);
    const notes = sugg.map((c) => {
      const sign = c.deltaMm >= 0 ? '+' : '−';
      const mark = c.confidence === 'match' ? '✓' : c.confidence === 'close' ? '≈' : '?';
      const fits = c.fits.length ? ` (${c.fits.join(', ')})` : '';
      return `${mark} ${c.label}${fits} Δ ${sign}${formatNumber(Math.abs(c.deltaMm), 2)} mm`;
    });
    const verdict = metricOrInch(s.af, U);
    notes.push(t(`hex.verdict.${verdict}`));
    if (sugg.some((c) => !c.verified)) notes.push(t('hex.unverified'));
    const second =
      s.mode === 'hex'
        ? { label: `AC${s.n}`, kind: 'acrossCorners' as const, value: acrossCorners(s.af), uncertainty: roundUpOneSig((U * 2) / Math.sqrt(3)), nameKey: 'kind.acrossCorners' }
        : { label: `D${s.n}`, kind: 'length' as const, value: squareDiagonal(s.af), uncertainty: roundUpOneSig(U * Math.SQRT2), nameKey: 'readout.diagonal' };
    return [
      { label: `AF${s.n}`, kind: 'acrossFlats', value: s.af, uncertainty: U, primary: true, unit: 'length', nameKey: 'kind.acrossFlats', notes },
      { ...second, unit: 'length' },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts().map((r) => ({ tool: this.tool, kind: r.kind, label: r.label, value: r.value, uncertainty: r.uncertainty, toolState: this.serialize() }));
  }

  serialize(): HexState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const { ctx } = rc;
    const cs = this.corners();
    drawOutline(rc, cs, true, rc.theme.accent, 'rgba(14,165,233,0.08)');
    drawCross(rc, s.c, rc.theme.ink);
    // Across-flats dimension (flat 0 ↔ flat 3 or 2).
    const opp = this.sides() / 2;
    const a = add(s.c, scale(this.flatDir(0), s.af / 2));
    const b = add(s.c, scale(this.flatDir(opp), s.af / 2));
    ctx.save();
    ctx.strokeStyle = rc.theme.ink;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3 * rc.dpr, 3 * rc.dpr]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    line(ctx, rc.mmToPx(a), rc.mmToPx(b));
    ctx.stroke();
    ctx.restore();
    if (rc.inLoupe) return;
    const [r] = this.readouts();
    const perp = dirOf(s.angle + 90);
    drawTag(rc, `${r.label} ${fmtLength(r.value, r.uncertainty, rc.unit, rc.fractionDen)}`, add(s.c, scale(perp, Math.min(s.af * 0.18, 6))), [0, -1], rc.theme.ink, rc.theme.bg);
    for (let k = 0; k < this.sides(); k++) {
      const f = add(s.c, scale(this.flatDir(k), s.af / 2));
      const q = add(s.c, scale(this.flatDir(k), s.af / 2 + KO));
      ctx.save();
      ctx.strokeStyle = rc.theme.accent;
      ctx.lineWidth = 1.5 * rc.dpr;
      ctx.beginPath();
      line(ctx, rc.mmToPx(f), rc.mmToPx(q));
      ctx.stroke();
      ctx.restore();
      drawKnob(rc, q, rc.theme.accent, { active: rc.activeHandleId === `f${k}` });
    }
    drawKnob(rc, this.rotKnob(), '#334155', { glyph: 'rotate', active: rc.activeHandleId === 'rot' });
  }
}

export function isHexState(x: unknown): x is HexState {
  const o = x as HexState;
  return !!o && o.tool === 'hex' && typeof o.af === 'number';
}
