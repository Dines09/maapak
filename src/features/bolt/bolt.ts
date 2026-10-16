// Bolt Wizard (§6.6.2): head types, the result card ("M8 × 1.25 × 40 — Hex head bolt, 13 AF") and an
// auto-generated front + top drawing built from the record's measurements.
import type { Measurement, PartRecord, Vec } from '../../core/types';
import { acrossCorners } from '../../core/geometry/fit';
import { METRIC_ROWS, INCH_ROWS, suggestWrenches } from '../../core/standards/hex';
import { identifyBolt, type BoltId } from '../../core/standards/threads';
import type { DimSpec, Entity, GhostShape } from '../../render/types';
import { ghostFrom, linear, nutPts } from '../../tools/drawing';
import type { RecordView } from '../drawing/model';

export const BOLT_HEADS = ['hex', 'socket', 'countersunk', 'button', 'pan', 'carriage'] as const;
export type BoltHead = (typeof BOLT_HEADS)[number];

/** Length convention: countersunk heads are measured overall, the rest from under the head (§6.6.2). */
export const lengthIsOverall = (h: BoltHead): boolean => h === 'countersunk';

export interface BoltSummary {
  L?: Measurement;
  d?: Measurement;
  P?: Measurement;
  af?: Measurement;
  k?: Measurement;
  id: BoltId | null;
  /** Nut that fits the identified thread (from the sourced AF tables). */
  nut?: string;
}

function pick(rec: PartRecord, kinds: string[], prefix?: string): Measurement | undefined {
  return rec.measurements.find((m) => kinds.includes(m.kind) && (!prefix || m.label.startsWith(prefix)));
}

export function boltSummary(rec: PartRecord): BoltSummary {
  const L = pick(rec, ['length'], 'L');
  const d = pick(rec, ['diameter', 'outerDiameter']);
  const P = pick(rec, ['pitch']);
  const af = pick(rec, ['acrossFlats']);
  const k = pick(rec, ['length'], 'k');
  const id = d
    ? identifyBolt({ dMm: d.value, dU: d.uncertainty, pMm: P?.value, pU: P?.uncertainty, lengthMm: L?.value })
    : null;
  let nut: string | undefined;
  if (id) {
    const rows = id.system === 'metric' ? METRIC_ROWS : INCH_ROWS;
    const row = rows.find((r) => r.size === id.nominal.size);
    if (row) nut = `${row.size} nut · AF ${row.af}${id.system === 'metric' ? ' mm' : '″'}`;
  }
  return { L, d, P, af, k, id, nut };
}

/** One-line result: "M8 × 1.25 × 40 — Hex head bolt, 13 AF". */
export function boltTitle(s: BoltSummary, headName: string): string {
  if (!s.id) return headName;
  let af = '';
  if (s.af) {
    const w = suggestWrenches(s.af.value, s.af.uncertainty, 1)[0];
    af = `, ${w ? w.label : `${s.af.value.toFixed(1)} mm`} AF`;
  }
  return `${s.id.text} — ${headName}${af}`;
}

interface Geo {
  d: number;
  L: number;
  k: number;
  /** Head width seen from the front (across corners for a hex). */
  dk: number;
  af?: number;
  pitch?: number;
}

function geo(s: BoltSummary, head: BoltHead): Geo | null {
  if (!s.d || !s.L) return null;
  const d = s.d.value;
  const af = s.af?.value;
  const typicalK: Record<BoltHead, number> = {
    hex: 0.7,
    socket: 1,
    countersunk: 0.6,
    button: 0.55,
    pan: 0.6,
    carriage: 0.6,
  };
  const typicalDk: Record<BoltHead, number> = {
    hex: 1.7,
    socket: 1.5,
    countersunk: 2,
    button: 1.75,
    pan: 2,
    carriage: 2.3,
  };
  const dk =
    head === 'hex' && af
      ? acrossCorners(af)
      : head === 'socket' && af
        ? Math.max(1.5 * d, af * 1.9)
        : typicalDk[head] * d;
  return { d, L: s.L.value, k: s.k?.value ?? typicalK[head] * d, dk, af, pitch: s.P?.value };
}

/** Front (side profile) and top views; x along the axis, y down. Only measured values get dimensions. */
export function boltViews(rec: PartRecord, head: BoltHead): RecordView[] {
  const s = boltSummary(rec);
  const g = geo(s, head);
  if (!g) return [];
  const { d, L, k, dk } = g;
  const r = d / 2;
  const front: Entity[] = [];
  const poly = (pts: Vec[]) => front.push({ type: 'polyline', points: pts, closed: true });
  // Head
  if (head === 'countersunk') {
    const hk = (dk - d) / 2; // 90° countersink
    poly([
      [0, -dk / 2],
      [hk, -r],
      [hk, r],
      [0, dk / 2],
    ]);
    poly([
      [hk, -r],
      [L, -r],
      [L, r],
      [hk, r],
    ]);
  } else {
    if (head === 'button' || head === 'carriage' || head === 'pan') {
      // Dome: half ellipse (pan heads flatter, as a superellipse).
      const e = head === 'pan' ? 0.35 : 1;
      const pts: Vec[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = -Math.PI / 2 + (i / 24) * Math.PI;
        pts.push([-k * Math.cos(t) ** e, (dk / 2) * Math.sin(t)]);
      }
      poly(pts);
    } else
      poly([
        [-k, -dk / 2],
        [0, -dk / 2],
        [0, dk / 2],
        [-k, dk / 2],
      ]);
    if (head === 'hex')
      front.push(
        { type: 'line', a: [-k, -dk / 4], b: [0, -dk / 4] },
        { type: 'line', a: [-k, dk / 4], b: [0, dk / 4] },
      );
    if (head === 'carriage')
      poly([
        [0, -r],
        [r, -r],
        [r, r],
        [0, r],
      ]);
    poly([
      [0, -r],
      [L, -r],
      [L, r],
      [0, r],
    ]);
  }
  // Thread: minor-diameter lines over the thread length b ≈ 2d + 6 (or the whole shank when short).
  const start = head === 'countersunk' ? (dk - d) / 2 : 0;
  const b = Math.min(L - start, 2 * d + 6);
  const minor = g.pitch ? r - 0.6134 * g.pitch : r * 0.82;
  front.push({ type: 'line', a: [L - b, -minor], b: [L, -minor], style: 'hidden' });
  front.push({ type: 'line', a: [L - b, minor], b: [L, minor], style: 'hidden' });
  front.push({ type: 'line', a: [L - b, -r], b: [L - b, r] });
  front.push({ type: 'line', a: [-k - 3, 0], b: [L + 3, 0], style: 'centre' });

  const dims: DimSpec[] = [];
  if (s.L) dims.push(linear('length', s.L.label, s.L.value, s.L.uncertainty, [L, dk / 2], [0, dk / 2], 8));
  if (s.d) dims.push(linear(s.d.kind, s.d.label, s.d.value, s.d.uncertainty, [L, -r], [L, r], 6));
  if (s.k && head !== 'countersunk')
    dims.push(linear('length', s.k.label, s.k.value, s.k.uncertainty, [-k, -dk / 2], [0, -dk / 2], 6));

  const top: Entity[] = [];
  const tdims: DimSpec[] = [];
  if (head === 'hex' && g.af) {
    top.push({ type: 'polyline', points: nutPts(g.af, 6), closed: true });
    if (s.af)
      tdims.push(
        linear(
          'acrossFlats',
          s.af.label,
          s.af.value,
          s.af.uncertainty,
          [g.af / 2, dk / 2],
          [-g.af / 2, dk / 2],
          6,
        ),
      );
  } else {
    top.push({ type: 'circle', center: [0, 0], r: dk / 2 });
    if (head === 'socket' && g.af) {
      const key = g.af;
      top.push({ type: 'polyline', points: nutPts(key, 6), closed: true });
      if (s.af)
        tdims.push(
          linear('acrossFlats', s.af.label, s.af.value, s.af.uncertainty, [key / 2, key], [-key / 2, key], 4),
        );
    }
  }
  top.push({ type: 'circle', center: [0, 0], r, style: 'hidden' });
  top.push({ type: 'line', a: [-dk / 2 - 3, 0], b: [dk / 2 + 3, 0], style: 'centre' });
  top.push({ type: 'line', a: [0, -dk / 2 - 3], b: [0, dk / 2 + 3], style: 'centre' });
  return [
    { title: 'front', view: { outline: front, dims } },
    { title: 'top', view: { outline: top, dims: tdims } },
  ];
}

/** Side ghost for the camera: the front-view outline. */
export function boltGhost(rec: PartRecord, head: BoltHead): GhostShape | null {
  const v = boltViews(rec, head)[0];
  if (!v) return null;
  const paths = v.view.outline
    .filter((e): e is Extract<Entity, { type: 'polyline' }> => e.type === 'polyline')
    .map((e) => ({ kind: 'polyline' as const, points: e.points, closed: true }));
  return ghostFrom(paths);
}
