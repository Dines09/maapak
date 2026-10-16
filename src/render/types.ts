// Tool plugin interface (§16.3). Every measuring tool implements ToolInstance so it works with the
// readout, records, the camera ghost overlay and the engineering drawing.
import type { FeatureKind, Measurement, ToolId, Vec } from '../core/types';
import type { LengthUnit, FractionDenominator } from '../core/units';
import type { RectMm } from '../core/geometry';
import type { ScreenTransform } from '../core/calibration';
import type { SkinId } from './skins';

export interface ThemeTokens {
  /** Canvas background (solid base colour). */
  bg: string;
  /** Ink on the background, ≥ 7:1 where possible. */
  ink: string;
  /** Handle colours from a colour-blind-safe palette, chosen for contrast with the background. */
  accent: string;
  accent2: string;
  skin: SkinId;
  font: string;
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  /** mm → device px (includes loupe zoom when inLoupe). */
  mmToPx(p: Vec): Vec;
  pxToMm(p: Vec): Vec;
  /** Mean device px per mm (for sizes such as fonts). */
  pxPerMm: number;
  dpr: number;
  theme: ThemeTokens;
  unit: LengthUnit;
  fractionDen: FractionDenominator;
  inLoupe: boolean;
  loupeZoom: number;
  selected: boolean;
  activeHandleId: string | null;
  /** Hidden handles while Focus mode is on are still drawn; chrome is not. */
  largeHandles: boolean;
}

export type HandleKind = 'point' | 'edge' | 'rotate' | 'body';

export interface Handle {
  id: string;
  posMm: Vec;
  kind: HandleKind;
  /** Where alignment matters (shown in the loupe). Defaults to posMm. */
  focusMm?: Vec;
}

export type ReadoutUnit = 'length' | 'area' | 'count' | 'angle';

export interface Readout {
  label: string;
  kind: FeatureKind;
  /** Canonical value: mm, mm², degrees, or a plain count. */
  value: number;
  /** Expanded uncertainty U, same unit as value. */
  uncertainty: number;
  primary?: boolean;
  unit?: ReadoutUnit;
  /** i18n key for a descriptive name ("Length", "Gap"). */
  nameKey?: string;
}

export interface Path2DLike {
  kind: 'polyline' | 'circle';
  points?: Vec[];
  center?: Vec;
  r?: number;
  closed?: boolean;
}

export interface GhostShape {
  paths: Path2DLike[];
  edgeSamples: Vec[];
  boundsMm: [number, number, number, number];
}

export interface Entity {
  type: 'line' | 'circle' | 'arc' | 'text';
  a?: Vec;
  b?: Vec;
  center?: Vec;
  r?: number;
  text?: string;
}

export interface DimSpec {
  measurementLabel: string;
  a: Vec;
  b: Vec;
  offset: number;
}

export interface DrawingEntities {
  views: Partial<Record<'front' | 'top' | 'side', { outline: Entity[]; dims: DimSpec[] }>>;
}

/** Services a tool needs from the stage. */
export interface ToolEnv {
  transform(): ScreenTransform;
  /** Usable area in mm (current orientation). */
  bounds(): RectMm;
  /** Where new tools are placed by default (usable area minus on-screen chrome). */
  placeBounds(): RectMm;
  /** Expanded uncertainty for a length along a direction (mm). */
  uncertainty(lengthMm: number, dir: Vec, edges?: number): number;
  /** Tick snapping step in mm, or 0 when off. */
  tickSnapMm(): number;
  /** Snap targets from other tools (mm). */
  snapPoints(excludeToolId: string): Vec[];
  /** Angles of other tools (deg) for parallel / perpendicular snapping. */
  otherAngles(excludeToolId: string): number[];
  angleSnap(): boolean;
  haptic(kind: 'snap' | 'tick'): void;
  unit(): LengthUnit;
  fractionDen(): FractionDenominator;
}

export interface ToolAction {
  id: string;
  labelKey: string;
  run(): void;
  active?: boolean;
}

export interface ToolInstance {
  readonly id: string;
  readonly tool: ToolId;
  label: string;
  attach(env: ToolEnv): void;
  hitTest(pMm: Vec, tolMm: number): Handle | null;
  onDragStart(h: Handle, pMm: Vec): void;
  onDragMove(h: Handle, pMm: Vec, precision: boolean): void;
  onDragEnd(h: Handle): void;
  render(rc: RenderContext): void;
  readouts(): Readout[];
  toMeasurements(): Omit<Measurement, 'id' | 'createdAt' | 'calibrationId'>[];
  toGhost(view: 'top' | 'side' | 'front'): GhostShape | null;
  toDrawing(): DrawingEntities;
  serialize(): unknown;

  // Optional extensions used by the shell.
  /** Points that must stay in the usable area. */
  outline?(): Vec[];
  /** Keep the tool inside the bounds (after rotation or resize). */
  fit?(bounds: RectMm): void;
  rotateBy?(deg: number, pivotMm: Vec): void;
  actions?(): ToolAction[];
  /** Long-press handle menu support. */
  setZeroAt?(handleId: string): boolean;
  setExactValue?(handleId: string, valueMm: number): boolean;
  /** Snap targets this tool offers to others. */
  snapTargets?(): Vec[];
  angle?(): number;
  /** Current alignment point of a handle (loupe focus while dragging). */
  focusOf?(handleId: string): Vec | null;
}

export interface ToolDefinition {
  tool: ToolId;
  icon: string;
  labelKey: string;
  create(init?: Partial<Record<string, unknown>>): ToolInstance;
  deserialize(state: unknown): ToolInstance;
}
