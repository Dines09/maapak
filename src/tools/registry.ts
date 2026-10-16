import type { ToolId } from '../core/types';
import type { ToolDefinition, ToolInstance } from '../render/types';
import { RulerTool, defaultRulerState, isRulerState, type RulerKind } from './ruler/RulerTool';
import { GapRulerTool, defaultGapState, type GapState } from './gapRuler/GapRulerTool';
import { CaliperTool, defaultCaliperState, isCaliperState } from './caliper/CaliperTool';
import {
  ProtractorTool,
  defaultProtractorState,
  isProtractorState,
  type ProtractorMode,
} from './protractor/ProtractorTool';
import {
  CircleTool,
  defaultCircleState,
  isCircleState,
  type CircleMode,
  type CirclePreset,
} from './circle/CircleTool';
import { HexTool, defaultHexState, isHexState } from './hex/HexTool';
import { RectTool, defaultRectState, isRectState } from './rect/RectTool';
import { PolygonTool, defaultPolygonState, isPolygonState } from './polygon/PolygonTool';
import { BoxTool, defaultBoxState, isBoxState } from './box/BoxTool';
import { RadiusTool, defaultRadiusState, isRadiusState } from './radius/RadiusTool';
import { GridTool, defaultGridState, isGridState } from './grid/GridTool';
import { DatumTool, defaultDatumState, isDatumState } from './datum/DatumTool';
import { GasketTool, defaultGasketState, isGasketState } from './gasket/GasketTool';
import { TemplateTool, defaultTemplateState, isTemplateState } from './template/TemplateTool';
import type { Entity } from '../render/types';

type Init = Partial<Record<string, unknown>> | undefined;
const num = (init: Init, k: string, d: number) => Number(init?.[k] ?? d);

function rulerDef(tool: RulerKind, icon: string, labelKey: string): ToolDefinition {
  return {
    tool,
    icon,
    labelKey,
    create: (init) => new RulerTool({ ...defaultRulerState(tool, num(init, 'n', 1), num(init, 'slot', 0)) }),
    deserialize: (state) => {
      if (!isRulerState(state)) throw new Error('Bad ruler state');
      return new RulerTool(state);
    },
  };
}

function guarded<T>(ok: (x: unknown) => x is T, make: (s: T) => ToolInstance) {
  return (state: unknown): ToolInstance => {
    if (!ok(state)) throw new Error('Bad tool state');
    return make(state);
  };
}

export const TOOL_REGISTRY: Partial<Record<ToolId, ToolDefinition>> = {
  ruler: rulerDef('ruler', 'ruler', 'tool.ruler'),
  leapfrog: rulerDef('leapfrog', 'leapfrog', 'tool.leapfrog'),
  threadGauge: rulerDef('threadGauge', 'threadGauge', 'tool.threadGauge'),
  wireGauge: rulerDef('wireGauge', 'wireGauge', 'tool.wireGauge'),
  radiusGauge: {
    tool: 'radiusGauge',
    icon: 'radiusGauge',
    labelKey: 'tool.radiusGauge',
    create: (init) => new RadiusTool(defaultRadiusState(num(init, 'n', 1))),
    deserialize: guarded(isRadiusState, (s) => new RadiusTool(s)),
  },
  grid: {
    tool: 'grid',
    icon: 'grid',
    labelKey: 'tool.grid',
    create: (init) => new GridTool(defaultGridState(num(init, 'n', 1))),
    deserialize: guarded(isGridState, (s) => new GridTool(s)),
  },
  gasket: {
    tool: 'gasket',
    icon: 'ring',
    labelKey: 'tool.gasket',
    create: (init) =>
      new GasketTool(defaultGasketState(num(init, 'n', 1), init?.mode === 'pcd' ? 'pcd' : 'builder')),
    deserialize: guarded(isGasketState, (s) => new GasketTool(s)),
  },
  template: {
    tool: 'template',
    icon: 'shapes',
    labelKey: 'tool.template',
    create: (init) =>
      new TemplateTool(defaultTemplateState((init?.outline as Entity[]) ?? [], String(init?.name ?? ''))),
    deserialize: guarded(isTemplateState, (s) => new TemplateTool(s)),
  },
  datumXY: {
    tool: 'datumXY',
    icon: 'datumXY',
    labelKey: 'tool.datumXY',
    create: (init) => new DatumTool(defaultDatumState(num(init, 'n', 1))),
    deserialize: guarded(isDatumState, (s) => new DatumTool(s)),
  },
  box: {
    tool: 'box',
    icon: 'box',
    labelKey: 'tool.box',
    create: (init) => new BoxTool(defaultBoxState(num(init, 'n', 1))),
    deserialize: guarded(isBoxState, (s) => new BoxTool(s)),
  },
  gapRuler: {
    tool: 'gapRuler',
    icon: 'gap',
    labelKey: 'tool.gapRuler',
    create: (init) => new GapRulerTool(defaultGapState(num(init, 'n', 1))),
    deserialize: (state) => new GapRulerTool(state as GapState),
  },
  caliper: {
    tool: 'caliper',
    icon: 'caliper',
    labelKey: 'tool.caliper',
    create: (init) => new CaliperTool(defaultCaliperState(num(init, 'n', 1))),
    deserialize: guarded(isCaliperState, (s) => new CaliperTool(s)),
  },
  protractor: {
    tool: 'protractor',
    icon: 'protractor',
    labelKey: 'tool.protractor',
    create: (init) => {
      const s = defaultProtractorState(num(init, 'n', 1));
      if (init?.mode) s.mode = init.mode as ProtractorMode;
      return new ProtractorTool(s);
    },
    deserialize: guarded(isProtractorState, (s) => new ProtractorTool(s)),
  },
  circle: {
    tool: 'circle',
    icon: 'circle',
    labelKey: 'tool.circle',
    create: (init) =>
      new CircleTool(
        defaultCircleState(
          num(init, 'n', 1),
          (init?.mode as CircleMode) ?? 'circle',
          (init?.preset as CirclePreset) ?? 'none',
        ),
      ),
    deserialize: guarded(isCircleState, (s) => new CircleTool(s)),
  },
  hex: {
    tool: 'hex',
    icon: 'hex',
    labelKey: 'tool.hex',
    create: (init) =>
      new HexTool(defaultHexState(num(init, 'n', 1), init?.mode === 'square' ? 'square' : 'hex')),
    deserialize: guarded(isHexState, (s) => new HexTool(s)),
  },
  rect: {
    tool: 'rect',
    icon: 'rect',
    labelKey: 'tool.rect',
    create: (init) => new RectTool(defaultRectState(num(init, 'n', 1), init?.square === true)),
    deserialize: guarded(isRectState, (s) => new RectTool(s)),
  },
  polygon: {
    tool: 'polygon',
    icon: 'polygon',
    labelKey: 'tool.polygon',
    create: (init) => new PolygonTool(defaultPolygonState(num(init, 'n', 1))),
    deserialize: guarded(isPolygonState, (s) => new PolygonTool(s)),
  },
};

/** Maximum tools on screen (§6.1). */
export const MAX_TOOLS = 4;

export function createTool(
  tool: ToolId,
  existing: readonly ToolInstance[],
  init: Partial<Record<string, unknown>> = {},
): ToolInstance | null {
  const def = TOOL_REGISTRY[tool];
  if (!def) return null;
  const n = existing.filter((t) => t.tool === tool).length + 1;
  return def.create({ n, slot: existing.length, ...init });
}

/** Quick shapes (§4.3): each places a pre-configured tool. Phase-4 shapes are listed but disabled. */
export interface QuickShape {
  id: string;
  tool: ToolId;
  init: Partial<Record<string, unknown>>;
  icon: string;
  phase?: number;
}

export const QUICK_SHAPES: QuickShape[] = [
  { id: 'nutBolt', tool: 'hex', init: {}, icon: 'bolt' },
  { id: 'hexNut', tool: 'hex', init: {}, icon: 'hex' },
  { id: 'squareNut', tool: 'hex', init: { mode: 'square' }, icon: 'rect' },
  { id: 'oring', tool: 'circle', init: { mode: 'ring', preset: 'oring' }, icon: 'ring' },
  { id: 'washer', tool: 'circle', init: { mode: 'ring', preset: 'washer' }, icon: 'ring' },
  { id: 'gasket', tool: 'gasket', init: {}, icon: 'ring' },
  { id: 'pcd', tool: 'gasket', init: { mode: 'pcd' }, icon: 'circle' },
  { id: 'squarePiece', tool: 'rect', init: { square: true }, icon: 'rect' },
  { id: 'rectPlate', tool: 'rect', init: {}, icon: 'rect' },
  { id: 'rod', tool: 'circle', init: { mode: 'circle', preset: 'rod' }, icon: 'circle' },
];
