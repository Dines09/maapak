// Gasket builder & PCD finder (§6.5): outer profile (circle / rectangle / obround) + inner cut-out + an even
// hole pattern on a PCD — or free hole circles placed on the real holes → fitted PCD with a uniformity check.
import type { Vec } from '../../core/types';
import {
  add,
  dirOf,
  dist,
  fitShift,
  norm,
  normAngle,
  rad2deg,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { pcdFit } from '../../core/geometry/pcd';
import { formatNumber } from '../../core/units';
import { roundUpOneSig } from '../../core/uncertainty';
import type {
  DrawingEntities,
  Entity,
  GhostShape,
  Handle,
  Readout,
  RenderContext,
  ToolAction,
  ToolInstance,
  ToolPreset,
} from '../../render/types';
import { circlePoints, drawCross, drawKnob, drawOutline, pathMm } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { diameter, ghostFrom, linear, rectPts } from '../drawing';

export type GasketOuter = 'circle' | 'rect' | 'obround';

export interface GasketHole {
  c: Vec;
  r: number;
}

export interface GasketState {
  v: 1;
  id: string;
  tool: 'gasket';
  n: number;
  placed: boolean;
  mode: 'builder' | 'pcd';
  outer: GasketOuter;
  c: Vec;
  /** Circle outer radius; rect / obround full width and height. */
  R: number;
  w: number;
  h: number;
  /** Inner cut-out radius (0 = none). */
  ri: number;
  pcdR: number;
  holesN: number;
  hr: number;
  /** Direction of the first hole (deg). */
  rot: number;
  /** PCD-finder mode: circles placed on the real holes. */
  holes: GasketHole[];
}

export function defaultGasketState(n = 1, mode: GasketState['mode'] = 'builder'): GasketState {
  return {
    v: 1,
    id: newId('gsk'),
    tool: 'gasket',
    n,
    placed: false,
    mode,
    outer: 'circle',
    c: [0, 0],
    R: 30,
    w: 60,
    h: 40,
    ri: 12,
    pcdR: 22,
    holesN: 4,
    hr: 3,
    rot: -45,
    holes: [],
  };
}

const DIAG = norm([1, 1]);

export class GasketTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'gasket' as const;
  s: GasketState;
  private drag: { id: string; p0: Vec; s0: GasketState; snapped: number | null } | null = null;

  constructor(state: GasketState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `GK${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const s = this.s;
    s.c = [b.x + b.w / 2, b.y + b.h / 2];
    const k = Math.min(b.w, b.h) / 2 - 4;
    s.R = clamp(k * 0.9, 10, 60);
    s.w = s.R * 2;
    s.h = s.R * 1.4;
    s.ri = s.R * 0.4;
    s.pcdR = s.R * 0.72;
    s.hr = clamp(s.R * 0.1, 1.5, 6);
    s.holes = [0, 120, 240].map((a) => ({ c: add(s.c, scale(dirOf(a - 90), s.R * 0.6)), r: s.hr }));
    s.placed = true;
  }

  private outerPts(): Vec[] {
    const s = this.s;
    if (s.outer === 'circle') return circlePoints(s.c, s.R, 120);
    const r = s.outer === 'obround' ? Math.min(s.w, s.h) / 2 : 0;
    return rectPts(s.w, s.h, r).map((p) => add(p, s.c));
  }

  private patternHoles(): GasketHole[] {
    const s = this.s;
    return Array.from({ length: s.holesN }, (_, i) => ({
      c: add(s.c, scale(dirOf(s.rot + (i * 360) / s.holesN), s.pcdR)),
      r: s.hr,
    }));
  }

  holesNow(): GasketHole[] {
    return this.s.mode === 'pcd' ? this.s.holes : this.patternHoles();
  }

  outline(): Vec[] {
    if (this.s.mode === 'pcd')
      return this.s.holes.flatMap((h) => [sub(h.c, [h.r + 4, h.r + 4]), add(h.c, [h.r + 4, h.r + 4])]);
    return this.outerPts();
  }

  fit(b: RectMm): void {
    const s = this.s;
    if (s.mode === 'pcd') {
      s.holes = s.holes.map((h) => ({
        ...h,
        c: [clamp(h.c[0], b.x, b.x + b.w), clamp(h.c[1], b.y, b.y + b.h)],
      }));
      return;
    }
    s.c = add(s.c, fitShift(this.outerPts(), b));
  }

  rotateBy(deg: number): void {
    this.s.rot = normAngle(this.s.rot + deg);
  }

  angle(): number {
    return this.s.rot;
  }

  spotlight(): Vec[][] {
    const s = this.s;
    if (s.mode === 'pcd') return s.holes.map((h) => circlePoints(h.c, h.r, 48));
    const out = [this.outerPts()];
    if (s.ri > 0) out.push(circlePoints(s.c, s.ri, 96));
    for (const h of this.patternHoles()) out.push(circlePoints(h.c, h.r, 40));
    return out;
  }

  /** Drag from the dimmed surround: outside → outer profile; inside the bore → inner cut-out. */
  indirect(p: Vec): Handle | null {
    const s = this.s;
    if (s.mode === 'pcd') return null;
    if (s.ri > 0 && dist(p, s.c) < s.ri) return { id: 'ind:i', kind: 'point', posMm: p };
    const d = sub(p, s.c);
    const outside =
      s.outer === 'circle' ? dist(p, s.c) > s.R : Math.abs(d[0]) > s.w / 2 || Math.abs(d[1]) > s.h / 2;
    return outside ? { id: 'ind:o', kind: 'point', posMm: p } : null;
  }

  snapTargets(): Vec[] {
    return [this.s.c, ...this.holesNow().map((h) => h.c)];
  }

  private knobs(): [string, Vec][] {
    const s = this.s;
    if (s.mode === 'pcd') {
      return s.holes.flatMap((h, i) => [
        [`h${i}`, h.c] as [string, Vec],
        [`r${i}`, add(h.c, scale(DIAG, h.r + 3))] as [string, Vec],
      ]);
    }
    const out: [string, Vec][] = [['c', s.c]];
    if (s.outer === 'circle') out.push(['o', add(s.c, [s.R, 0])]);
    else out.push(['ow', add(s.c, [s.w / 2, 0])], ['oh', add(s.c, [0, s.h / 2])]);
    if (s.ri > 0) out.push(['i', add(s.c, scale(dirOf(-135), s.ri))]);
    const first = add(s.c, scale(dirOf(s.rot), s.pcdR));
    out.push(['p', first], ['h', add(first, scale(dirOf(s.rot), s.hr))]);
    return out;
  }

  focusOf(id: string): Vec | null {
    return this.knobs().find(([k]) => k === id)?.[1] ?? null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    for (const [id, q] of this.knobs()) {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind: id === 'p' ? 'rotate' : 'point', posMm: q };
      }
    }
    return best;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), snapped: null };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const radial = (c: Vec) => dist(p, c) - dist(d.p0, c);
    const mh = /^([hr])(\d+)$/.exec(h.id);
    if (mh) {
      const i = Number(mh[2]);
      if (mh[1] === 'h') s.holes[i].c = add(s0.holes[i].c, delta);
      else s.holes[i].r = Math.max(0.3, s0.holes[i].r + radial(s0.holes[i].c));
      return;
    }
    switch (h.id) {
      case 'c':
        s.c = add(s0.c, delta);
        break;
      case 'o':
        s.R = Math.max(s.pcdR + s.hr + 0.5, s0.R + delta[0]);
        break;
      case 'ow':
        s.w = Math.max(2, s0.w + 2 * delta[0]);
        break;
      case 'oh':
        s.h = Math.max(2, s0.h + 2 * delta[1]);
        break;
      case 'i':
      case 'ind:i':
        s.ri = clamp(s0.ri + radial(s0.c), 0.3, Math.max(0.3, s.pcdR - s.hr - 0.3));
        break;
      case 'ind:o': {
        if (s.outer === 'circle') s.R = Math.max(s.ri + 1, s0.R + radial(s0.c));
        else {
          const a = sub(d.p0, s0.c);
          const ax = Math.abs(a[0]);
          const ay = Math.abs(a[1]);
          if (ax >= ay * 0.5) s.w = Math.max(2, s0.w + 2 * (Math.abs(p[0] - s0.c[0]) - ax));
          if (ay >= ax * 0.5) s.h = Math.max(2, s0.h + 2 * (Math.abs(p[1] - s0.c[1]) - ay));
        }
        break;
      }
      case 'p': {
        s.pcdR = Math.max(s.ri + s.hr + 0.3, dist(p, s0.c));
        let a = normAngle(rad2deg(Math.atan2(p[1] - s0.c[1], p[0] - s0.c[0])));
        if (this.env.angleSnap()) {
          const [sa, ok] = snapAngle(a, 45, 3);
          if (ok) {
            if (d.snapped !== sa) this.snapHaptic();
            d.snapped = sa;
            a = sa;
          } else d.snapped = null;
        }
        s.rot = a;
        break;
      }
      case 'h':
        s.hr = Math.max(0.3, s0.hr + radial(add(s0.c, scale(dirOf(s0.rot), s0.pcdR))));
        break;
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  presets(): ToolPreset[] {
    const s = this.s;
    if (s.mode !== 'builder') return [];
    return [3, 4, 5, 6, 8, 12].map((k) => ({
      id: `n${k}`,
      label: `${k}×`,
      active: s.holesN === k,
      run: () => (s.holesN = k),
    }));
  }

  actions(): ToolAction[] {
    const s = this.s;
    const next: Record<GasketOuter, GasketOuter> = { circle: 'rect', rect: 'obround', obround: 'circle' };
    const out: ToolAction[] = [
      {
        id: 'mode',
        labelKey: s.mode === 'builder' ? 'gasket.toPcd' : 'gasket.toBuilder',
        run: () => (s.mode = s.mode === 'builder' ? 'pcd' : 'builder'),
      },
    ];
    if (s.mode === 'builder') {
      out.push({
        id: 'outer',
        labelKey: `gasket.outer.${next[s.outer]}`,
        run: () => (s.outer = next[s.outer]),
      });
      out.push({
        id: 'bore',
        labelKey: s.ri > 0 ? 'gasket.noBore' : 'gasket.bore',
        run: () => (s.ri = s.ri > 0 ? 0 : Math.min(s.pcdR - s.hr - 1, s.R * 0.4)),
      });
    } else {
      out.push({
        id: 'add',
        labelKey: 'gasket.addHole',
        run: () => {
          const f = pcdFit(s.holes.map((h) => h.c));
          const c = f?.c ?? s.c;
          const r = f ? f.pcd / 2 : s.R * 0.6;
          // New hole on the fitted circle, in the largest angular gap.
          const ang = s.holes.map((h) => Math.atan2(h.c[1] - c[1], h.c[0] - c[0])).sort((a, b) => a - b);
          let best = 0;
          let gap = -1;
          ang.forEach((a, i) => {
            const nx = i + 1 < ang.length ? ang[i + 1] : ang[0] + Math.PI * 2;
            if (nx - a > gap) {
              gap = nx - a;
              best = a + (nx - a) / 2;
            }
          });
          s.holes.push({ c: add(c, [r * Math.cos(best), r * Math.sin(best)]), r: s.holes[0]?.r ?? s.hr });
        },
      });
      if (s.holes.length > 3)
        out.push({ id: 'remove', labelKey: 'gasket.removeHole', run: () => void s.holes.pop() });
    }
    return out;
  }

  readouts(): Readout[] {
    const s = this.s;
    const U = (d: number) => this.env.uncertainty(d, DIAG, 2);
    const n = s.n;
    if (s.mode === 'pcd') {
      const f = pcdFit(
        s.holes.map((h) => h.c),
        this.env.pointU(),
      );
      const hd = s.holes.reduce((a, h) => a + 2 * h.r, 0) / Math.max(1, s.holes.length);
      if (!f)
        return [
          {
            label: `PCD${n}`,
            kind: 'pcd',
            value: 0,
            uncertainty: 0,
            primary: true,
            unit: 'length',
            nameKey: 'kind.pcd',
          },
        ];
      const notes = [
        `N = ${f.n} · ${formatNumber(f.pitchDeg, 1)}° · max Δ∠ ${formatNumber(f.maxAngDev, 1)}°`,
        f.angDev.map((a, i) => `#${i + 1} ${a >= 0 ? '+' : ''}${formatNumber(a, 1)}°`).join('  '),
      ];
      return [
        {
          label: `PCD${n}`,
          kind: 'pcd',
          value: f.pcd,
          uncertainty: roundUpOneSig(Math.hypot(U(f.pcd), 2 * f.uPcd)),
          primary: true,
          unit: 'length',
          nameKey: 'kind.pcd',
          notes,
        },
        { label: 'N', kind: 'pcd', value: f.n, uncertainty: 0, unit: 'count', nameKey: 'gasket.holes' },
        {
          label: `H${n}`,
          kind: 'diameter',
          value: hd,
          uncertainty: U(hd),
          unit: 'length',
          nameKey: 'gasket.holeD',
        },
        {
          label: '∠',
          kind: 'angle',
          value: f.pitchDeg,
          uncertainty: 0,
          unit: 'angle',
          nameKey: 'gasket.pitch',
        },
      ];
    }
    const out: Readout[] = [];
    if (s.outer === 'circle') {
      out.push({
        label: `OD${n}`,
        kind: 'outerDiameter',
        value: 2 * s.R,
        uncertainty: U(2 * s.R),
        primary: true,
        unit: 'length',
        nameKey: 'kind.outerDiameter',
      });
    } else {
      out.push({
        label: `L${n}`,
        kind: 'length',
        value: s.w,
        uncertainty: this.env.uncertainty(s.w, [1, 0], 2),
        primary: true,
        unit: 'length',
        nameKey: 'kind.length',
      });
      out.push({
        label: `W${n}`,
        kind: 'width',
        value: s.h,
        uncertainty: this.env.uncertainty(s.h, [0, 1], 2),
        unit: 'length',
        nameKey: 'kind.width',
      });
    }
    if (s.ri > 0)
      out.push({
        label: `ID${n}`,
        kind: 'innerDiameter',
        value: 2 * s.ri,
        uncertainty: U(2 * s.ri),
        unit: 'length',
        nameKey: 'kind.innerDiameter',
      });
    out.push(
      {
        label: `PCD${n}`,
        kind: 'pcd',
        value: 2 * s.pcdR,
        uncertainty: U(2 * s.pcdR),
        unit: 'length',
        nameKey: 'kind.pcd',
      },
      { label: 'N', kind: 'pcd', value: s.holesN, uncertainty: 0, unit: 'count', nameKey: 'gasket.holes' },
      {
        label: `H${n}`,
        kind: 'diameter',
        value: 2 * s.hr,
        uncertainty: U(2 * s.hr),
        unit: 'length',
        nameKey: 'gasket.holeD',
      },
      {
        label: '∠',
        kind: 'angle',
        value: 360 / s.holesN,
        uncertainty: 0,
        unit: 'angle',
        nameKey: 'gasket.pitch',
      },
    );
    return out;
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .filter((r) => r.unit === 'length')
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  private partFrame(): { outer: Entity | null; holes: GasketHole[]; c: Vec } {
    const s = this.s;
    if (s.mode === 'pcd') {
      const f = pcdFit(s.holes.map((h) => h.c));
      const c = f?.c ?? s.c;
      return { outer: null, holes: s.holes.map((h) => ({ c: sub(h.c, c), r: h.r })), c };
    }
    const outer: Entity =
      s.outer === 'circle'
        ? { type: 'circle', center: [0, 0], r: s.R }
        : {
            type: 'polyline',
            points: rectPts(s.w, s.h, s.outer === 'obround' ? Math.min(s.w, s.h) / 2 : 0),
            closed: true,
          };
    return { outer, holes: this.patternHoles().map((h) => ({ c: sub(h.c, s.c), r: h.r })), c: s.c };
  }

  toDrawing(): DrawingEntities {
    const s = this.s;
    const rs = this.readouts();
    const get = (lbl: string) => rs.find((r) => r.label === lbl);
    const { outer, holes } = this.partFrame();
    const outline: Entity[] = [];
    if (outer) outline.push(outer);
    if (s.mode === 'builder' && s.ri > 0) outline.push({ type: 'circle', center: [0, 0], r: s.ri });
    for (const h of holes) outline.push({ type: 'circle', center: h.c, r: h.r });
    const pcd = get(`PCD${s.n}`);
    if (pcd && pcd.value > 0)
      outline.push({ type: 'circle', center: [0, 0], r: pcd.value / 2, style: 'centre' });
    const dims = [];
    const od = get(`OD${s.n}`);
    if (od) dims.push(diameter('outerDiameter', od.label, od.value, od.uncertainty, [0, 0], 35));
    const L = get(`L${s.n}`);
    const W = get(`W${s.n}`);
    if (L && W) {
      dims.push(
        linear('length', L.label, L.value, L.uncertainty, [-s.w / 2, s.h / 2], [s.w / 2, s.h / 2], -8),
      );
      dims.push(
        linear('width', W.label, W.value, W.uncertainty, [s.w / 2, s.h / 2], [s.w / 2, -s.h / 2], -8),
      );
    }
    const id = get(`ID${s.n}`);
    if (id) dims.push(diameter('innerDiameter', id.label, id.value, id.uncertainty, [0, 0], 160));
    if (pcd && pcd.value > 0) dims.push(diameter('pcd', pcd.label, pcd.value, pcd.uncertainty, [0, 0], -60));
    const hd = get(`H${s.n}`);
    if (hd && holes[0]) dims.push(diameter('diameter', hd.label, hd.value, hd.uncertainty, holes[0].c, 60));
    return { views: { top: { outline, dims } } };
  }

  toGhost(): GhostShape {
    const s = this.s;
    const { holes } = this.partFrame();
    const paths: GhostShape['paths'] = [];
    if (s.mode === 'builder') {
      if (s.outer === 'circle') paths.push({ kind: 'circle', center: [0, 0], r: s.R });
      else
        paths.push({
          kind: 'polyline',
          points: rectPts(s.w, s.h, s.outer === 'obround' ? Math.min(s.w, s.h) / 2 : 0),
          closed: true,
        });
      if (s.ri > 0) paths.push({ kind: 'circle', center: [0, 0], r: s.ri });
    }
    for (const h of holes) paths.push({ kind: 'circle', center: h.c, r: h.r });
    return ghostFrom(paths);
  }

  serialize(): GasketState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const { ctx } = rc;
    let pcdC: Vec = s.c;
    let pcdR = s.pcdR;
    if (s.mode === 'builder') {
      const outer = this.outerPts();
      drawOutline(rc, outer, true, rc.theme.accent);
      if (s.ri > 0) drawOutline(rc, circlePoints(s.c, s.ri, 96), true, rc.theme.accent);
    } else {
      const f = pcdFit(s.holes.map((h) => h.c));
      if (f) {
        pcdC = f.c;
        pcdR = f.pcd / 2;
      } else pcdR = 0;
    }
    if (pcdR > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = rc.theme.accent2;
      ctx.lineWidth = 1;
      pathMm(rc, circlePoints(pcdC, pcdR, 144), true);
      ctx.stroke();
      ctx.restore();
      drawCross(rc, pcdC, rc.theme.accent2);
    }
    for (const h of this.holesNow()) {
      drawOutline(rc, circlePoints(h.c, h.r, 48), true, rc.theme.accent2);
      drawCross(rc, h.c, rc.theme.accent2, Math.min(1.5, h.r * 0.6));
    }
    if (rc.inLoupe) return;
    for (const [id, q] of this.knobs()) {
      const isCentre = id === 'c' || /^h\d+$/.test(id);
      drawKnob(rc, q, isCentre ? '#334155' : rc.theme.accent2, {
        active: rc.activeHandleId === id,
        glyph: id === 'p' ? 'rotate' : undefined,
      });
    }
  }
}

export function isGasketState(x: unknown): x is GasketState {
  const o = x as GasketState;
  return !!o && o.tool === 'gasket' && Array.isArray(o.holes);
}
