// Record → drawing views and camera ghost (§10, §11). Each measurement carries the state of the tool that
// took it; tools are rebuilt from that state and asked for their own geometry.
import type { Measurement, PartRecord } from '../../core/types';
import type { DrawingView, GhostShape, ToolInstance } from '../../render/types';
import { TOOL_REGISTRY } from '../../tools/registry';

export interface RecordView {
  title: string;
  view: DrawingView;
}

function rebuild(m: Measurement): ToolInstance | null {
  const def = TOOL_REGISTRY[m.tool];
  if (!def) return null;
  try {
    return def.deserialize(m.toolState);
  } catch {
    return null;
  }
}

/** Group measurements that came from the same tool setup (identical tool state). */
function groups(rec: PartRecord): { tool: ToolInstance; ms: Measurement[] }[] {
  const out: { key: string; tool: ToolInstance; ms: Measurement[] }[] = [];
  for (const m of rec.measurements) {
    const key = `${m.tool}:${JSON.stringify(m.toolState)}`;
    const g = out.find((x) => x.key === key);
    if (g) {
      g.ms.push(m);
      continue;
    }
    const tool = rebuild(m);
    if (tool) out.push({ key, tool, ms: [m] });
  }
  return out;
}

/** One drawing view per tool setup; dimension labels and values come from the record's measurements. */
export function recordViews(rec: PartRecord): RecordView[] {
  const views: RecordView[] = [];
  for (const { tool, ms } of groups(rec)) {
    const top = tool.toDrawing().views.top;
    if (!top) continue;
    const used = new Set<Measurement>();
    const dims = top.dims.map((d) => {
      const m = ms.find((x) => x.kind === d.kind && !used.has(x));
      if (!m) return d;
      used.add(m);
      return {
        ...d,
        label: m.label,
        value: m.value,
        uncertainty: m.uncertainty,
        r: d.type === 'diameter' ? m.value / 2 : d.r,
      };
    });
    views.push({ title: ms.map((m) => m.label).join(' · '), view: { outline: top.outline, dims } });
  }
  return views;
}

/** Camera ghost for a view: the first measured shape that has one (§10.3). */
export function recordGhost(rec: PartRecord, view: 'top' | 'side' | 'front' = 'top'): GhostShape | null {
  for (const { tool } of groups(rec)) {
    const g = tool.toGhost(view);
    if (g && g.edgeSamples.length > 4) return g;
  }
  return null;
}
