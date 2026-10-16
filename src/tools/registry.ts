import type { ToolId } from '../core/types';
import type { ToolDefinition, ToolInstance } from '../render/types';
import { RulerTool, defaultRulerState, isRulerState, type RulerKind } from './ruler/RulerTool';
import { GapRulerTool, defaultGapState, type GapState } from './gapRuler/GapRulerTool';

function rulerDef(tool: RulerKind, icon: string, labelKey: string): ToolDefinition {
  return {
    tool,
    icon,
    labelKey,
    create: (init) =>
      new RulerTool({ ...defaultRulerState(tool, Number(init?.n ?? 1), Number(init?.slot ?? 0)) }),
    deserialize: (state) => {
      if (!isRulerState(state)) throw new Error('Bad ruler state');
      return new RulerTool(state);
    },
  };
}

export const TOOL_REGISTRY: Partial<Record<ToolId, ToolDefinition>> = {
  ruler: rulerDef('ruler', 'ruler', 'tool.ruler'),
  splitRuler: rulerDef('splitRuler', 'split', 'tool.splitRuler'),
  leapfrog: rulerDef('leapfrog', 'leapfrog', 'tool.leapfrog'),
  gapRuler: {
    tool: 'gapRuler',
    icon: 'gap',
    labelKey: 'tool.gapRuler',
    create: (init) => new GapRulerTool(defaultGapState(Number(init?.n ?? 1))),
    deserialize: (state) => new GapRulerTool(state as GapState),
  },
};

/** Maximum rulers on screen (§6.1). */
export const MAX_TOOLS = 4;

export function createTool(tool: ToolId, existing: readonly ToolInstance[]): ToolInstance | null {
  const def = TOOL_REGISTRY[tool];
  if (!def) return null;
  const n = existing.filter((t) => t.tool === tool).length + 1;
  return def.create({ n, slot: existing.length });
}
