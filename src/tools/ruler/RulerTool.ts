// Ruler (§6.1) as two measuring lines: everything between the lines stays bright, the rest is dimmed, and
// the tick marks run along the bright region (zero at line A), so the number at line B is the length.
// Lines move by their grips or by dragging anywhere in the dimmed area on that side. The leapfrog chain
// opens edge to edge for parts longer than the screen.
import type { Vec } from '../../core/types';
import {
  add,
  clipLineToRect,
  dirOf,
  dist,
  dot,
  normAngle,
  projectT,
  rad2deg,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { clipPolygonToRect } from '../../core/geometry/fit';
import { combineRss, roundUpOneSig } from '../../core/uncertainty';
import { formatNumber } from '../../core/units';
import { matchPitch, tpiFromPitch } from '../../core/standards/threads';
import { awgFromDiameter, nearestCable, nearestSwg, wireArea } from '../../core/standards/misc';
import i18n from '../../i18n';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { drawKnob, drawMarkerLine, drawScale, drawText, type ScaleKind } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { diameter, ghostFrom, spanDrawing } from '../drawing';
import type { DrawingEntities, GhostShape } from '../../render/types';

/** Line-based tools share this engine: ruler, leapfrog chain, wire gauge (§6.8.3), thread pitch gauge (§6.8.1). */
export type RulerKind = 'ruler' | 'leapfrog' | 'wireGauge' | 'threadGauge';

export interface RulerState {
  v: 2;
  id: string;
  tool: RulerKind;
  n: number;
  placed: boolean;
  slot: number;
  /** Reference point; the lines are perpendicular to dirOf(angle) through origin + u·t. */
  origin: Vec;
  angle: number;
  a: number;
  b: number;
  segments: number[];
  segU: number[];
  /** Thread gauge: crest-count method (N pitches between the lines) or virtual comb. */
  threadMode?: 'count' | 'comb';
  crests?: number;
  /** Comb pitch (mm) and whether the presets are TPI. */
  combPitch?: number;
  combInch?: boolean;
}

/** Comb presets: common metric pitches (§18) and threads per inch (§18 UNC/UNF). */
export const COMB_MM = [0.5, 0.7, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
export const COMB_TPI = [40, 32, 24, 20, 18, 16, 14, 13, 12, 11, 10, 8];
const COMB_LEN = 36;

export const TICK_SCALE = 0.7;
/** Grip inset from the edge of the usable area (mm). */
const GRIP_IN = 7;

export function defaultRulerState(tool: RulerKind, n = 1, slot = 0): RulerState {
  return {
    v: 2,
    id: newId(tool),
    tool,
    n,
    placed: false,
    slot,
    origin: [0, 0],
    angle: 0,
    a: 10,
    b: 50,
    segments: [],
    segU: [],
    ...(tool === 'threadGauge'
      ? { threadMode: 'count' as const, crests: 10, combPitch: 1.25, combInch: false }
      : {}),
  };
}

type LineKey = 'a' | 'b';

export class RulerTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool: RulerKind;
  s: RulerState;
  private drag: { id: string; p0: Vec; s0: RulerState; snapped: number | null; c0: Vec; a0: number } | null =
    null;
  private last: LineKey = 'b';

  constructor(state: RulerState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
    this.tool = state.tool;
  }

  get label(): string {
    return `L${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  // ---------- geometry ----------

  u(st = this.s): Vec {
    return dirOf(st.angle);
  }
  /** Along the lines ("up" for a horizontal measurement). */
  nrm(st = this.s): Vec {
    const u = this.u(st);
    return [u[1], -u[0]];
  }
  P(t: number, st = this.s): Vec {
    return add(st.origin, scale(this.u(st), t));
  }
  Q(t: number, o: number, st = this.s): Vec {
    return add(this.P(t, st), scale(this.nrm(st), o));
  }
  angle(): number {
    return this.s.angle;
  }
  private tRange(): [number, number] {
    return [Math.min(this.s.a, this.s.b), Math.max(this.s.a, this.s.b)];
  }

  /** o-extent of a rect relative to the lines (min, max). */
  private oRange(r: RectMm): [number, number] {
    const n = this.nrm();
    const os = (
      [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x, r.y + r.h],
        [r.x + r.w, r.y + r.h],
      ] as Vec[]
    ).map((c) => dot(sub(c, this.s.origin), n));
    return [Math.min(...os), Math.max(...os)];
  }
  /** t-extent of the usable area (lines must stay on screen). */
  private tLimits(): [number, number] {
    const b = this.env.bounds();
    const u = this.u();
    const ts = (
      [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x, b.y + b.h],
        [b.x + b.w, b.y + b.h],
      ] as Vec[]
    ).map((c) => dot(sub(c, this.s.origin), u));
    return [Math.min(...ts) + 0.5, Math.max(...ts) - 0.5];
  }
  /** Rails along which the ticks run: just inside the placement area (clear of the bars). */
  private rails(): [number, number] {
    const [lo, hi] = this.oRange(this.env.placeBounds());
    return [lo + 1, hi - 1];
  }
  private grips(k: LineKey): Vec[] {
    const [lo, hi] = this.rails();
    return [this.Q(this.s[k], hi - GRIP_IN), this.Q(this.s[k], lo + GRIP_IN)];
  }
  private rotGrip(): Vec {
    const [lo] = this.rails();
    const [t0, t1] = this.tRange();
    return this.Q((t0 + t1) / 2, lo + GRIP_IN);
  }

  outline(): Vec[] {
    return [...this.grips('a'), ...this.grips('b')];
  }

  snapTargets(): Vec[] {
    const [lo, hi] = this.rails();
    const mid = (lo + hi) / 2;
    return [this.Q(this.s.a, mid), this.Q(this.s.b, mid)];
  }

  focusOf(id: string): Vec | null {
    const k = id.replace('ind:', '');
    if (k !== 'a' && k !== 'b') return null;
    const [lo, hi] = this.rails();
    return this.Q(this.s[k], (lo + hi) / 2);
  }

  spotlight(): Vec[][] | null {
    if (this.isComb()) {
      const [lo, hi] = this.rails();
      const mid = (lo + hi) / 2;
      const a = this.s.a;
      return [
        [
          this.Q(a, mid - 6),
          this.Q(a + COMB_LEN, mid - 6),
          this.Q(a + COMB_LEN, mid + 6),
          this.Q(a, mid + 6),
        ],
      ];
    }
    const [t0, t1] = this.tRange();
    const strip = [this.Q(t0, -2000), this.Q(t1, -2000), this.Q(t1, 2000), this.Q(t0, 2000)];
    const c = clipPolygonToRect(strip, this.env.bounds());
    return c.length ? [c] : null;
  }

  // ---------- placement & constraints ----------

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (!this.s.placed) this.place(env.placeBounds());
  }

  private place(b: RectMm): void {
    const s = this.s;
    s.angle = 0;
    s.origin = [b.x, b.y + b.h / 2];
    if (s.tool === 'wireGauge') {
      // A conductor is a few mm thick: two lines close together in the middle.
      s.a = b.w / 2 - 1.5;
      s.b = b.w / 2 + 1.5;
    } else if (s.tool === 'leapfrog') {
      // Edge to edge: the part is longer than the screen anyway.
      const lb = this.env.bounds();
      s.a = lb.x - b.x + 1.5;
      s.b = lb.x + lb.w - b.x - 1.5;
    } else {
      s.a = Math.min(10, b.w * 0.15);
      s.b = Math.min(s.a + 40, b.w - 4);
    }
    s.placed = true;
  }

  /** Two fingers held on the glass: lines exactly at the two fingers (§4.7). */
  placeAt(p1: Vec, p2: Vec, b: RectMm): void {
    const s = this.s;
    const vertical = Math.abs(p1[1] - p2[1]) > Math.abs(p1[0] - p2[0]);
    s.angle = vertical ? 90 : 0;
    s.origin = vertical ? [b.x + b.w / 2, b.y] : [b.x, b.y + b.h / 2];
    const t = (p: Vec) => (vertical ? p[1] - b.y : p[0] - b.x);
    s.a = Math.min(t(p1), t(p2));
    s.b = Math.max(t(p1), t(p2));
    s.placed = true;
  }

  fit(): void {
    const [lo, hi] = this.tLimits();
    this.s.a = clamp(this.s.a, lo, hi);
    this.s.b = clamp(this.s.b, lo, hi);
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.origin = rotateAbout(this.s.origin, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  private center(): Vec {
    const [t0, t1] = this.tRange();
    const [lo, hi] = this.rails();
    return this.Q((t0 + t1) / 2, (lo + hi) / 2);
  }

  // ---------- hit testing & dragging ----------

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    const consider = (id: string, q: Vec, kind: Handle['kind']) => {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind, posMm: q };
      }
    };
    for (const k of ['a', 'b'] as const) for (const g of this.grips(k)) consider(k, g, 'edge');
    if (this.s.tool !== 'leapfrog') consider('rot', this.rotGrip(), 'rotate');
    return best;
  }

  /** Touch in the dimmed area left/right of the lines drives the nearer line; inside is the part. */
  indirect(p: Vec): Handle | null {
    const t = projectT(p, this.s.origin, this.u());
    const [t0, t1] = this.tRange();
    if (t >= t0 && t <= t1) return null;
    const lowKey: LineKey = this.s.a <= this.s.b ? 'a' : 'b';
    const k: LineKey = t < t0 ? lowKey : lowKey === 'a' ? 'b' : 'a';
    return { id: `ind:${k}`, kind: 'point', posMm: p };
  }

  onDragStart(h: Handle, p: Vec): void {
    const k = h.id.replace('ind:', '');
    if (k === 'a' || k === 'b') this.last = k;
    const c0 = this.center();
    this.drag = {
      id: h.id,
      p0: p,
      s0: structuredClone(this.s),
      snapped: null,
      c0,
      a0: rad2deg(Math.atan2(p[1] - c0[1], p[0] - c0[0])),
    };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    if (h.id === 'rot') {
      let a = normAngle(s0.angle + normAngle(rad2deg(Math.atan2(p[1] - d.c0[1], p[0] - d.c0[0])) - d.a0));
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 15, 3);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = normAngle(sa);
        } else d.snapped = null;
      }
      s.origin = rotateAbout(s0.origin, d.c0, a - s0.angle);
      s.angle = a;
      return;
    }
    const k = h.id.replace('ind:', '');
    if (k !== 'a' && k !== 'b') return;
    const [lo, hi] = this.tLimits();
    s[k] = this.snapT(clamp(s0[k] + dot(delta, this.u(s0)), lo, hi), k);
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const k = this.last;
    const other = k === 'a' ? this.s.b : this.s.a;
    const dir = this.s[k] >= other ? 1 : -1;
    const [lo, hi] = this.tLimits();
    this.s[k] = clamp(this.s[k] + dir * stepMm, lo, hi);
  }

  private snapT(t: number, k: LineKey): number {
    const s = this.s;
    const d = this.drag;
    const other = k === 'a' ? s.b : s.a;
    let target: number | null = null;
    const step = this.env.tickSnapMm();
    if (step > 0) {
      const ts = other + Math.round((t - other) / step) * step;
      if (Math.abs(ts - t) <= Math.min(step * 0.3, 0.35)) target = ts;
    }
    if (target === null) {
      for (const q of this.env.snapPoints(this.id)) {
        const tq = projectT(q, s.origin, this.u());
        if (Math.abs(tq - t) <= 0.8) {
          target = tq;
          break;
        }
      }
    }
    if (target !== null && d && d.snapped !== target) this.snapHaptic();
    if (d) d.snapped = target;
    return target ?? t;
  }

  // ---------- handle menu ----------

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm >= 0)) return false;
    const k: LineKey = handleId.replace('ind:', '') === 'a' ? 'a' : 'b';
    const other = k === 'a' ? s.b : s.a;
    const dir = s[k] >= other ? 1 : -1;
    const v = other + dir * valueMm;
    const [lo, hi] = this.tLimits();
    if (v < lo || v > hi) return false;
    s[k] = v;
    return true;
  }

  // ---------- actions ----------

  private isComb(): boolean {
    return this.s.tool === 'threadGauge' && this.s.threadMode === 'comb';
  }

  /** Thread gauge pitch: span / N (crest count) or the selected comb pitch. */
  pitch(): number {
    const s = this.s;
    if (this.isComb()) return s.combPitch ?? 1.25;
    return Math.abs(s.b - s.a) / Math.max(1, s.crests ?? 10);
  }

  presets(): import('../../render/types').ToolPreset[] {
    const s = this.s;
    if (s.tool !== 'threadGauge') return [];
    if (s.threadMode !== 'comb') {
      return [5, 10, 15, 20, 25].map((n) => ({
        id: `n${n}`,
        label: `N ${n}`,
        active: s.crests === n,
        run: () => (s.crests = n),
      }));
    }
    const list = s.combInch
      ? COMB_TPI.map((t) => [25.4 / t, `${t}`] as const)
      : COMB_MM.map((p) => [p, `${p}`] as const);
    return list.map(([p, label]) => ({
      id: `p${label}`,
      label,
      active: Math.abs((s.combPitch ?? 0) - p) < 1e-6,
      run: () => (s.combPitch = p),
    }));
  }

  actions(): ToolAction[] {
    const s = this.s;
    if (s.tool === 'leapfrog') return [];
    if (s.tool === 'threadGauge') {
      return [
        {
          id: 'mode',
          labelKey: s.threadMode === 'comb' ? 'thread.toCount' : 'thread.toComb',
          run: () => (s.threadMode = s.threadMode === 'comb' ? 'count' : 'comb'),
        },
        ...(s.threadMode === 'comb'
          ? [
              {
                id: 'units',
                labelKey: s.combInch ? 'thread.mmPitch' : 'thread.tpi',
                run: () => (s.combInch = !s.combInch),
              },
            ]
          : [
              {
                id: 'nMinus',
                labelKey: 'thread.nMinus',
                run: () => (s.crests = Math.max(1, (s.crests ?? 10) - 1)),
              },
              { id: 'nPlus', labelKey: 'thread.nPlus', run: () => (s.crests = (s.crests ?? 10) + 1) },
            ]),
        { id: 'rot90', labelKey: 'action.rotate90', run: () => this.rotateBy(90, this.center()) },
      ];
    }
    return [
      {
        id: 'rot90',
        labelKey: 'action.rotate90',
        run: () => {
          this.rotateBy(90, this.center());
          this.fit();
        },
      },
      {
        id: 'flip',
        labelKey: 'action.flip',
        run: () => {
          [s.a, s.b] = [s.b, s.a];
        },
      },
    ];
  }

  /** Leapfrog: keep the current span as a finished segment. */
  mark(): void {
    const L = Math.abs(this.s.b - this.s.a);
    if (L <= 0) return;
    this.s.segments.push(L);
    this.s.segU.push(this.env.uncertainty(L, this.u(), 2));
  }

  undoMark(): void {
    this.s.segments.pop();
    this.s.segU.pop();
  }

  resetChain(): void {
    this.s.segments = [];
    this.s.segU = [];
  }

  // ---------- readouts ----------

  readouts(): Readout[] {
    const s = this.s;
    const L = Math.abs(s.b - s.a);
    const U = this.env.uncertainty(L, this.u(), 2);
    if (s.tool === 'wireGauge') return this.wireReadouts(L, U);
    if (s.tool === 'threadGauge') return this.threadReadouts(L, U);
    if (s.tool !== 'leapfrog') {
      return [
        {
          label: `L${s.n}`,
          kind: 'length',
          value: L,
          uncertainty: U,
          primary: true,
          unit: 'length',
          nameKey: 'readout.length',
        },
      ];
    }
    const total = s.segments.reduce((x, y) => x + y, 0) + L;
    return [
      {
        label: `L${s.n}`,
        kind: 'length',
        value: total,
        uncertainty: combineRss([...s.segU, U]),
        primary: true,
        unit: 'length',
        nameKey: 'readout.total',
      },
      {
        label: `#${s.segments.length + 1}`,
        kind: 'length',
        value: L,
        uncertainty: U,
        unit: 'length',
        nameKey: 'readout.segment',
      },
      {
        label: 'N',
        kind: 'length',
        value: s.segments.length + 1,
        uncertainty: 0,
        unit: 'count',
        nameKey: 'readout.segments',
      },
    ];
  }

  private wireReadouts(d: number, U: number): Readout[] {
    const t = i18n.t.bind(i18n);
    const awg = awgFromDiameter(d);
    const swg = nearestSwg(d);
    const area = wireArea(d);
    const cab = nearestCable(area);
    return [
      {
        label: `Ø${this.s.n}`,
        kind: 'diameter',
        value: d,
        uncertainty: U,
        primary: true,
        unit: 'length',
        nameKey: 'wire.conductor',
        notes: [
          `AWG ${awg.toFixed(1)} (${t('wire.nearest')} ${Math.round(awg)})`,
          `SWG ${swg.swg} (Δ ${formatNumber(swg.deltaMm, 2)} mm)`,
          `${formatNumber(area, 2)} mm² → ${cab.mm2} mm² ${t('wire.cable')}`,
          t('wire.hint'),
        ],
      },
      {
        label: 'A',
        kind: 'area',
        value: area,
        uncertainty: (Math.PI / 2) * d * U,
        unit: 'area',
        nameKey: 'wire.area',
      },
    ];
  }

  private threadReadouts(L: number, U: number): Readout[] {
    const s = this.s;
    const t = i18n.t.bind(i18n);
    const n = this.isComb() ? 1 : Math.max(1, s.crests ?? 10);
    const p = this.pitch();
    const uP = this.isComb()
      ? Math.max(0.01, this.env.uncertainty(COMB_LEN, this.u(), 2) / (COMB_LEN / p))
      : U / n;
    const m = matchPitch(p, uP);
    const notes = [
      `${formatNumber(tpiFromPitch(p), 1)} TPI`,
      `${t('thread.metricBest')}: ${m.metric[0].label} (${m.metric[0].sizes.slice(0, 3).join(', ')}) Δ ${formatNumber(m.metric[0].deltaPct, 1)} %`,
      `${t('thread.inchBest')}: ${m.inch[0].label} (${m.inch[0].sizes.slice(0, 2).join(', ')}) Δ ${formatNumber(m.inch[0].deltaPct, 1)} %`,
      t(`thread.verdict.${m.verdict}`),
    ];
    if (!this.isComb()) notes.unshift(t('thread.countHint', { n }));
    return [
      {
        label: `P${s.n}`,
        kind: 'pitch',
        value: p,
        uncertainty: roundUpOneSig(uP),
        primary: true,
        unit: 'length',
        nameKey: 'kind.pitch',
        notes,
      },
      ...(this.isComb()
        ? []
        : [
            {
              label: 'L',
              kind: 'length' as const,
              value: L,
              uncertainty: U,
              unit: 'length' as const,
              nameKey: 'thread.span',
            },
          ]),
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .filter((r) => r.primary)
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  toDrawing(): DrawingEntities {
    const [r] = this.readoutsStatic();
    if (this.s.tool === 'wireGauge') {
      const d = r.value;
      return {
        views: {
          top: {
            outline: [{ type: 'circle', center: [0, 0], r: d / 2 }],
            dims: [diameter('diameter', `Ø${this.s.n}`, d, 0, [0, 0])],
          },
        },
      };
    }
    return spanDrawing(this.s.tool === 'threadGauge' ? 'pitch' : 'length', r.label, r.value, r.uncertainty);
  }

  toGhost(): GhostShape | null {
    if (this.s.tool === 'leapfrog') return null;
    const L = Math.abs(this.s.b - this.s.a);
    const h = Math.max(20, L * 0.6);
    return ghostFrom([
      {
        kind: 'polyline',
        points: [
          [-L / 2, -h / 2],
          [-L / 2, h / 2],
        ],
      },
      {
        kind: 'polyline',
        points: [
          [L / 2, -h / 2],
          [L / 2, h / 2],
        ],
      },
    ]);
  }

  /** Readouts without the stage (records rebuild tools from saved state). */
  private readoutsStatic(): { label: string; value: number; uncertainty: number }[] {
    const s = this.s;
    const L = Math.abs(s.b - s.a);
    if (s.tool === 'threadGauge') return [{ label: `P${s.n}`, value: this.pitch(), uncertainty: 0 }];
    const total = s.tool === 'leapfrog' ? s.segments.reduce((x, y) => x + y, 0) + L : L;
    return [{ label: s.tool === 'wireGauge' ? `Ø${s.n}` : `L${s.n}`, value: total, uncertainty: 0 }];
  }

  serialize(): RulerState {
    return structuredClone(this.s);
  }

  // ---------- rendering ----------

  /** Virtual saw-tooth comb (§6.8.1): slide it over the threads, change pitch until teeth sit in every root. */
  private renderComb(rc: RenderContext): void {
    const s = this.s;
    const { ctx } = rc;
    const [lo, hi] = this.rails();
    const mid = (lo + hi) / 2;
    const p = this.pitch();
    const teeth = Math.floor(COMB_LEN / p);
    const pts: Vec[] = [this.Q(s.a, mid + 6), this.Q(s.a, mid)];
    for (let i = 0; i < teeth; i++) {
      pts.push(this.Q(s.a + (i + 0.5) * p, mid - 1.6 * Math.min(1, p)));
      pts.push(this.Q(s.a + (i + 1) * p, mid));
    }
    pts.push(this.Q(s.a + teeth * p, mid + 6));
    ctx.save();
    ctx.beginPath();
    pts.forEach((q, i) => {
      const r = rc.mmToPx(q);
      if (i === 0) ctx.moveTo(r[0], r[1]);
      else ctx.lineTo(r[0], r[1]);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rc.theme.ink;
    ctx.stroke();
    ctx.restore();
    const label = s.combInch ? `${Math.round(25.4 / p)} TPI` : `P ${p}`;
    drawText(rc, label, this.Q(s.a + COMB_LEN / 2, mid + 3.5), this.nrm(), {
      sizeMm: 2.4,
      color: '#0f172a',
      weight: 800,
    });
    if (!rc.inLoupe)
      drawKnob(rc, this.rotGrip(), '#64748b', { glyph: 'rotate', active: rc.activeHandleId === 'rot' });
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const b = this.env.bounds();
    const u = this.u();
    const n = this.nrm();
    const [lo, hi] = this.rails();
    const kind: ScaleKind = rc.unit === 'mm' ? 'mm' : rc.unit === 'cm' ? 'cm' : 'inch';
    const dir = s.b >= s.a ? u : scale(u, -1);
    const L = Math.abs(s.b - s.a);
    if (this.isComb()) {
      this.renderComb(rc);
      return;
    }
    // Tick marks along the top and bottom of the bright region, zero at line A.
    for (const [o, normal] of [
      [hi, scale(n, -1)],
      [lo, n],
    ] as [number, Vec][]) {
      drawScale(rc, {
        zero: this.Q(s.a, o),
        dir,
        normal,
        from: 0,
        to: L,
        kind,
        ink: rc.theme.ink,
        textUp: n,
        inchDen: rc.fractionDen,
        tickScale: TICK_SCALE,
        labelSize: 2.2,
      });
    }
    const colors: Record<LineKey, string> = { a: rc.theme.accent, b: rc.theme.accent2 };
    for (const k of ['a', 'b'] as const) {
      const base = this.P(s[k]);
      const r = clipLineToRect(base, n, b);
      if (r) drawMarkerLine(rc, add(base, scale(n, r[0])), base, add(base, scale(n, r[1])), colors[k]);
    }
    if (rc.inLoupe) return;
    for (const k of ['a', 'b'] as const) {
      for (const g of this.grips(k)) {
        drawKnob(rc, g, colors[k], { active: rc.activeHandleId === k || rc.activeHandleId === `ind:${k}` });
      }
    }
    if (s.tool === 'threadGauge') {
      // Crest marks: N equal pitches between the lines.
      const n = Math.max(1, s.crests ?? 10);
      const { ctx } = rc;
      ctx.save();
      ctx.strokeStyle = rc.theme.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const mid = (lo + hi) / 2;
      for (let i = 0; i <= n; i++) {
        const t = s.a + ((s.b - s.a) * i) / n;
        const p0 = rc.mmToPx(this.Q(t, mid - 4));
        const p1 = rc.mmToPx(this.Q(t, mid + 4));
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (s.tool === 'leapfrog') {
      const tt = i18n.t.bind(i18n);
      const style = { sizeMm: 3.4, color: rc.theme.ink, halo: rc.theme.bg, weight: 800 };
      drawText(rc, tt('leap.startHere'), this.Q(s.a, hi - GRIP_IN - 6), n, style);
      drawText(rc, tt('leap.markHere'), this.Q(s.b, hi - GRIP_IN - 6), n, style);
    } else if (rc.selected) {
      drawKnob(rc, this.rotGrip(), '#64748b', { glyph: 'rotate', active: rc.activeHandleId === 'rot' });
    }
  }
}

export function isRulerState(x: unknown): x is RulerState {
  const kinds = ['ruler', 'leapfrog', 'wireGauge', 'threadGauge'];
  const o = x as RulerState;
  return !!o && o.v === 2 && kinds.includes(o.tool) && Array.isArray(o.origin) && typeof o.a === 'number';
}
