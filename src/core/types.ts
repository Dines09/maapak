// Shared data model (§15). All lengths are millimetres, all angles degrees.

export type Vec = [number, number];

export type ToolId =
  | 'ruler'
  | 'gapRuler'
  | 'splitRuler'
  | 'leapfrog'
  | 'caliper'
  | 'protractor'
  | 'circle'
  | 'ring'
  | 'gasket'
  | 'hex'
  | 'rect'
  | 'polygon'
  | 'datumXY'
  | 'threadGauge'
  | 'radiusGauge'
  | 'wireGauge'
  | 'grid'
  | 'level'
  | 'box'
  | 'template'
  | 'calLines';

export type FeatureKind =
  | 'length'
  | 'width'
  | 'diameter'
  | 'innerDiameter'
  | 'outerDiameter'
  | 'crossSection'
  | 'radius'
  | 'angle'
  | 'acrossFlats'
  | 'acrossCorners'
  | 'pitch'
  | 'pcd'
  | 'area'
  | 'perimeter'
  | 'coordinate'
  | 'slope';

export interface Measurement {
  id: string;
  recordId?: string;
  tool: ToolId;
  kind: FeatureKind;
  label: string; // "OD1"
  value: number; // mm, mm², or degrees (canonical)
  uncertainty: number; // expanded U, same unit as value
  tolerance?: { nominal: number; lower: number; upper: number; result?: 'pass' | 'warn' | 'fail' };
  repeats?: number[];
  toolState: unknown;
  calibrationId: string;
  createdAt: number;
}

export interface Annotation {
  measurementId: string;
  anchorA: Vec;
  anchorB?: Vec;
  offset: number;
  textPos?: Vec;
  visible: boolean;
  style?: { color?: string; weight?: number; textSize?: number; halo?: boolean };
}

export interface PhotoRef {
  id: string;
  blobKey: string;
  originalBlobKey?: string;
  width: number;
  height: number;
  view: 'top' | 'side' | 'front' | 'free';
  ghostToPhoto?: number[];
  mmPerPx?: number;
  matchScore?: number;
  annotations: Annotation[];
  takenAt: number;
}

export interface PartRecord {
  id: string;
  name: string;
  partNo?: string;
  project?: string;
  tags: string[];
  notes?: string;
  measuredBy?: string;
  recipe?: 'bolt' | 'nut' | 'oring' | 'washer' | 'gasket' | 'rect' | 'custom';
  identification?: { label: string; standard?: string; confidence: number }[];
  /** Bolt Wizard (§6.6.2): head type picked at the start. */
  bolt?: { head: 'hex' | 'socket' | 'countersunk' | 'button' | 'pan' | 'carriage' };
  measurements: Measurement[];
  photos: PhotoRef[];
  drawing: { projection: 'first' | 'third'; views: ('front' | 'top' | 'side')[] };
  location?: { lat: number; lng: number; accuracy: number };
  calibrationLabel?: string;
  createdAt: number;
  updatedAt: number;
}

/** Feature-label prefix per kind (§9 auto-labels). */
export const LABEL_PREFIX: Record<FeatureKind, string> = {
  length: 'L',
  width: 'W',
  diameter: 'Ø',
  innerDiameter: 'ID',
  outerDiameter: 'OD',
  crossSection: 'CS',
  radius: 'R',
  angle: 'A',
  acrossFlats: 'AF',
  acrossCorners: 'AC',
  pitch: 'P',
  pcd: 'PCD',
  area: 'AR',
  perimeter: 'PE',
  coordinate: 'XY',
  slope: 'S',
};

/** Assign the next free label for a kind, given labels already used (L1, L2, …). */
export function nextLabel(kind: FeatureKind, used: readonly string[]): string {
  const prefix = LABEL_PREFIX[kind];
  let n = 1;
  while (used.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
