import type { Measurement, ToolId, Vec } from '../core/types';
import type { DrawingEntities, GhostShape, ToolEnv } from '../render/types';

let seq = 0;
export function newId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type ToolMeasurement = Omit<Measurement, 'id' | 'createdAt' | 'calibrationId'>;

/** Common plumbing for tools: env access and default (not yet meaningful) ghost/drawing outputs. */
export abstract class BaseTool {
  abstract readonly id: string;
  abstract readonly tool: ToolId;
  protected env!: ToolEnv;

  attach(env: ToolEnv): void {
    this.env = env;
  }

  protected snapHaptic(): void {
    this.env?.haptic('snap');
  }

  toGhost(_view: 'top' | 'side' | 'front'): GhostShape | null {
    // Ghost overlays arrive with the camera feature (Phase 3).
    return null;
  }

  toDrawing(): DrawingEntities {
    return { views: {} };
  }

  protected boundsCenter(): Vec {
    const b = this.env.bounds();
    return [b.x + b.w / 2, b.y + b.h / 2];
  }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
