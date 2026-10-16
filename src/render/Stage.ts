// The single 1:1 measuring canvas (§16.4): backing store = CSS size × DPR, dirty-flag rAF loop,
// pointer manager with Ghost Touch Shield, precision mode, twist-rotate, loupe and pinned loupe.
import type { Vec } from '../core/types';
import type { LengthUnit, FractionDenominator } from '../core/units';
import { makeTransform, type EdgeInsets, type ScreenTransform, type RectPx } from '../core/calibration';
import { lengthUncertainty, pointUncertainty, type ScreenProtector } from '../core/uncertainty';
import { add, dist, normAngle, rad2deg, scale, snapAngle, sub, type RectMm } from '../core/geometry';
import { inkFor, luminance } from '../core/color';
import type {
  Handle,
  Readout,
  RenderContext,
  ThemeTokens,
  ToolDefinition,
  ToolEnv,
  ToolInstance,
} from './types';
import { accentsFor, drawBackground, type BackgroundSpec } from './background';
import type { SkinId } from './skins';
import { classifyContact, isBigContact, PRECISION_FACTOR, type ShieldMode } from './pointer';
import { crisp } from './draw';

export interface StageSettings {
  unit: LengthUnit;
  fractionDen: FractionDenominator;
  skin: SkinId;
  background: BackgroundSpec;
  largeHandles: boolean;
  shield: ShieldMode;
  loupe: boolean;
  loupeZoom: number;
  snapTicks: boolean;
  snapHalfMm: boolean;
  snapHandles: boolean;
  snapAngles: boolean;
  haptics: boolean;
  nudgeStep: 'px' | '0.05';
  canvasLabels: boolean;
  /** Dim everything outside the measured region (§8, like a light box). */
  spotlight: boolean;
}

export const DEFAULT_STAGE_SETTINGS: StageSettings = {
  unit: 'mm',
  fractionDen: 16,
  skin: 'steel',
  background: { color: '#ffffff', pattern: 'none' },
  largeHandles: false,
  shield: 'normal',
  loupe: true,
  loupeZoom: 4,
  snapTicks: false,
  snapHalfMm: false,
  snapHandles: true,
  snapAngles: true,
  haptics: true,
  nudgeStep: 'px',
  canvasLabels: false,
  spotlight: true,
};

export interface UncertaintyModel {
  relCal: number;
  protector: ScreenProtector;
}

export interface StageCallbacks {
  /** Readouts of the selected tool, at most once per frame. */
  onReadouts?(readouts: Readout[], tool: ToolInstance | null): void;
  /** A gesture changed tool state (undo stack, autosave, quick history). */
  onCommit?(tool: ToolInstance | null): void;
  onSelect?(tool: ToolInstance | null): void;
  onLongPress?(tool: ToolInstance, handle: Handle, cssPos: Vec): void;
  onDoubleTapEmpty?(): void;
  onTwoFingerTap?(): void;
  /** Two fingers held still on empty canvas: positions in mm (e.g. place gap rulers there). */
  onTwoFingerHold?(a: Vec, b: Vec): void;
  /** CSS position of the handle being dragged (HUD avoidance), or null. */
  onActiveHandle?(cssPos: Vec | null): void;
  onFirstInteraction?(): void;
  /** User touched the stage while measuring is disabled or tools are locked. */
  onBlocked?(reason: 'guard' | 'locked'): void;
  onSnap?(): void;
}

const LOUPE_R_CSS = 66;
const LOUPE_OFFSET_CSS = 80;
const LONG_PRESS_MS = 550;
const HIT_CSS = { normal: 24, large: 32 };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

type Special = 'pin' | 'pinwin';

interface DragState {
  pointerId: number;
  tool: ToolInstance | null;
  special?: Special;
  handle: Handle;
  lastRaw: Vec;
  virt: Vec;
  start: Vec;
  startCss: Vec;
  cssPos: Vec;
  moved: boolean;
  startedAt: number;
  longPress: number | null;
  before: string;
}

interface TwistState {
  pointerId: number;
  pos: Vec;
  lastAngle: number;
  accum: number;
  startToolAngle: number;
}

interface EmptyContact {
  downAt: number;
  pos: Vec;
  downMm: Vec;
  moved: boolean;
  group: number | null;
  consumed?: boolean;
  /** Side(s) of the selected tool this touch would drive from the dimmed surround. */
  indirect?: Handle | null;
}

const TWO_FINGER_HOLD_MS = 600;

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  tools: ToolInstance[] = [];
  selectedId: string | null = null;
  settings: StageSettings = { ...DEFAULT_STAGE_SETTINGS };
  measuring = true;
  locked = false;
  precisionLatched = false;
  model: UncertaintyModel = { relCal: 0.2, protector: 'none' };
  overlay: ((rc: RenderContext) => void) | null = null;
  pinned: { focus: Vec; center: Vec } | null = null;
  /** Show the faint locked usable-area boundary. */
  showEdges = true;

  private transform: ScreenTransform;
  private usableCss: RectPx | null = null;
  private edges: EdgeInsets | null = null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private rect: DOMRect | null = null;
  private dirty = true;
  private readoutsDirty = true;
  private raf = 0;
  private destroyed = false;
  private drag: DragState | null = null;
  private twist: TwistState | null = null;
  private precisionPointers = new Set<number>();
  private empty = new Map<number, EmptyContact>();
  private groupSeq = 0;
  private lastTap: { at: number; pos: Vec } | null = null;
  private pulse: { pos: Vec; until: number } | null = null;
  private holdTimer: number | null = null;
  private lastHandle: { toolId: string; handle: Handle } | null = null;
  private ro: ResizeObserver;
  private interacted = false;
  private placeInsets: [number, number, number, number] = [0, 0, 0, 0];
  private cb: StageCallbacks;
  /** Resolves after the first non-zero layout (tools can only be placed once the size is known). */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(canvas: HTMLCanvasElement, cb: StageCallbacks = {}) {
    this.canvas = canvas;
    this.ready = new Promise((r) => (this.resolveReady = r));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.cb = cb;
    this.dpr = window.devicePixelRatio || 1;
    this.transform = makeTransform({ pxPerMmX: this.dpr * 6.3, pxPerMmY: this.dpr * 6.3 }, 0, this.dpr);
    this.ro = new ResizeObserver((entries) => this.onResize(entries));
    try {
      this.ro.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.ro.observe(canvas);
    }
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', this.prevent);
    this.loop();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('contextmenu', this.prevent);
  }

  setCallbacks(cb: StageCallbacks): void {
    this.cb = cb;
  }

  // ---------- configuration ----------

  setTransform(t: ScreenTransform): void {
    this.transform = t;
    this.refit();
    this.invalidate(true);
  }

  getTransform(): ScreenTransform {
    return this.transform;
  }

  /** Usable area in CSS px (current orientation) and the edge description for drawing. */
  setUsable(rect: RectPx | null, edges: EdgeInsets | null): void {
    this.usableCss = rect;
    this.edges = edges;
    this.refit();
    this.invalidate(true);
  }

  setSettings(s: Partial<StageSettings>): void {
    this.settings = { ...this.settings, ...s };
    this.invalidate(true);
  }

  setModel(m: UncertaintyModel): void {
    this.model = m;
    this.invalidate(true);
  }

  setMeasuring(on: boolean): void {
    if (!on) this.cancelDrag();
    this.measuring = on;
    this.invalidate();
  }

  setLocked(on: boolean): void {
    if (on) this.cancelDrag();
    this.locked = on;
    this.invalidate();
  }

  invalidate(readouts = false): void {
    this.dirty = true;
    if (readouts) this.readoutsDirty = true;
  }

  // ---------- tools ----------

  env(): ToolEnv {
    return {
      transform: () => this.transform,
      bounds: () => this.boundsMm(),
      placeBounds: () => this.placeBoundsMm(),
      uncertainty: (lengthMm, dir, edges) =>
        lengthUncertainty({
          lengthMm,
          pxPerMm: this.transform.pxPerMmAlong(dir),
          relCal: this.model.relCal,
          screenProtector: this.model.protector,
          edges,
        }).U,
      pointU: () => pointUncertainty((this.transform.sx + this.transform.sy) / 2, this.model.protector),
      relCal: () => this.model.relCal,
      tickSnapMm: () => {
        if (!this.settings.snapTicks) return 0;
        if (this.settings.unit === 'in' || this.settings.unit === 'in-frac') return 25.4 / 16;
        return this.settings.snapHalfMm ? 0.5 : 1;
      },
      snapPoints: (ex) =>
        this.settings.snapHandles
          ? this.tools.filter((t) => t.id !== ex).flatMap((t) => t.snapTargets?.() ?? [])
          : [],
      otherAngles: (ex) =>
        this.tools
          .filter((t) => t.id !== ex && t.angle)
          .map((t) => t.angle!())
          .filter((a): a is number => typeof a === 'number'),
      angleSnap: () => this.settings.snapAngles,
      haptic: (kind) => this.haptic(kind),
      unit: () => this.settings.unit,
      fractionDen: () => this.settings.fractionDen,
    };
  }

  addTool(t: ToolInstance, select = true): void {
    t.attach(this.env());
    t.fit?.(this.boundsMm());
    this.tools.push(t);
    if (select) this.select(t.id);
    this.invalidate(true);
  }

  removeTool(id: string): void {
    this.tools = this.tools.filter((t) => t.id !== id);
    if (this.selectedId === id) this.select(this.tools.at(-1)?.id ?? null);
    this.invalidate(true);
  }

  clearTools(): void {
    this.tools = [];
    this.select(null);
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.cb.onSelect?.(this.selected());
    this.invalidate(true);
  }

  selected(): ToolInstance | null {
    return this.tools.find((t) => t.id === this.selectedId) ?? null;
  }

  snapshot(): { tools: { tool: string; state: unknown }[]; selectedId: string | null } {
    return {
      tools: this.tools.map((t) => ({ tool: t.tool, state: t.serialize() })),
      selectedId: this.selectedId,
    };
  }

  restore(
    snap: { tools: { tool: string; state: unknown }[]; selectedId: string | null },
    registry: Partial<Record<string, ToolDefinition>>,
  ): void {
    this.cancelDrag();
    const list: ToolInstance[] = [];
    for (const s of snap.tools) {
      const def = registry[s.tool];
      if (!def) continue;
      try {
        const t = def.deserialize(s.state);
        t.attach(this.env());
        t.fit?.(this.boundsMm());
        list.push(t);
      } catch {
        // Ignore corrupt entries rather than failing the whole session.
      }
    }
    this.tools = list;
    this.select(list.some((t) => t.id === snap.selectedId) ? snap.selectedId : (list.at(-1)?.id ?? null));
  }

  /** Move the last-used handle (or the selected tool body) by a fixed step: ◀ ▶ ▲ ▼ (§7.2). */
  nudge(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    const tool = this.selected();
    if (!tool || this.locked || !this.measuring) return;
    const step: Vec =
      this.settings.nudgeStep === 'px' ? [1 / this.transform.sx, 1 / this.transform.sy] : [0.05, 0.05];
    const h =
      this.lastHandle && this.lastHandle.toolId === tool.id
        ? this.lastHandle.handle
        : ({ id: 'body', kind: 'body', posMm: [0, 0] } as Handle);
    const p0: Vec = [0, 0];
    tool.onDragStart(h, p0);
    tool.onDragMove(h, [dx * step[0], dy * step[1]], true);
    tool.onDragEnd(h);
    tool.fit?.(this.boundsMm());
    this.invalidate(true);
    this.cb.onCommit?.(tool);
  }

  /** Thumb wheel: one detent = 1 device px or 0.05 mm (§6.2). Returns false if the tool has no wheel. */
  wheel(detents: number): boolean {
    const t = this.selected();
    if (!t?.wheel || this.locked || !this.measuring) return false;
    const step = this.settings.nudgeStep === 'px' ? 2 / (this.transform.sx + this.transform.sy) : 0.05;
    t.wheel(detents * step);
    t.fit?.(this.boundsMm());
    this.haptic('tick');
    this.invalidate(true);
    return true;
  }

  /** Rotate the selected tool (buttons / keyboard). */
  rotateSelected(deg: number): void {
    const t = this.selected();
    if (!t?.rotateBy || this.locked) return;
    const o = t.outline?.() ?? [];
    const c: Vec = o.length
      ? scale(
          o.reduce((s, p) => add(s, p), [0, 0] as Vec),
          1 / o.length,
        )
      : [0, 0];
    t.rotateBy(deg, c);
    t.fit?.(this.boundsMm());
    this.invalidate(true);
    this.cb.onCommit?.(t);
  }

  pinLoupe(on: boolean): void {
    if (!on) {
      this.pinned = null;
    } else {
      const b = this.boundsMm();
      this.pinned = {
        focus: [b.x + b.w / 2, b.y + b.h / 2],
        center: [this.cssW - LOUPE_R_CSS - 12, LOUPE_R_CSS + 72],
      };
    }
    this.invalidate();
  }

  /** Move the pinned lens focus (arrow keys, §7.1). */
  moveLens(dx: -1 | 0 | 1, dy: -1 | 0 | 1, stepMm = 0.25): void {
    if (!this.pinned) return;
    const a = this.canvasAreaMm();
    this.pinned.focus = [
      Math.min(a.w, Math.max(0, this.pinned.focus[0] + dx * stepMm)),
      Math.min(a.h, Math.max(0, this.pinned.focus[1] + dy * stepMm)),
    ];
    this.invalidate();
  }

  isLensPinned(): boolean {
    return !!this.pinned;
  }

  // ---------- geometry ----------

  mmPerCssPx(): number {
    return this.dpr / ((this.transform.sx + this.transform.sy) / 2);
  }

  canvasAreaMm(): RectMm {
    const [w, h] = this.transform.cssPxToMm([this.cssW, this.cssH]);
    return { x: 0, y: 0, w, h };
  }

  boundsMm(): RectMm {
    const r = this.usableCss ?? { x: 0, y: 0, w: this.cssW, h: this.cssH };
    const [x, y] = this.transform.cssPxToMm([r.x, r.y]);
    const [w, h] = this.transform.cssPxToMm([r.w, r.h]);
    return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
  }

  /** CSS px covered by chrome at the top / bottom (tools are placed clear of it). */
  setPlacementInsets(topCss: number, bottomCss: number, leftCss = 0, rightCss = 0): void {
    this.placeInsets = [topCss, bottomCss, leftCss, rightCss];
  }

  placeBoundsMm(): RectMm {
    const b = this.boundsMm();
    const mmPer = this.mmPerCssPx();
    const top = Math.max(b.y, this.placeInsets[0] * mmPer);
    const bottom = Math.min(b.y + b.h, (this.cssH - this.placeInsets[1]) * mmPer);
    const left = Math.max(b.x, this.placeInsets[2] * mmPer);
    const right = Math.min(b.x + b.w, (this.cssW - this.placeInsets[3]) * mmPer);
    const y = bottom - top >= 40 ? top : b.y;
    const h = bottom - top >= 40 ? bottom - top : b.h;
    const x = right - left >= 40 ? left : b.x;
    const w = right - left >= 40 ? right - left : b.w;
    return { x, y, w, h };
  }

  cssSize(): Vec {
    return [this.cssW, this.cssH];
  }

  private refit(): void {
    if (!this.cssW || !this.cssH) return;
    const b = this.boundsMm();
    for (const t of this.tools) t.fit?.(b);
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    const e = entries[0];
    const dpr = window.devicePixelRatio || 1;
    const cssW = e.contentRect.width;
    const cssH = e.contentRect.height;
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    const dp = e.devicePixelContentBoxSize?.[0];
    // Use the exact device-pixel size when it is consistent with CSS size × DPR (emulators may report CSS px).
    if (dp && Math.abs(dp.inlineSize - cssW * dpr) <= 2 && Math.abs(dp.blockSize - cssH * dpr) <= 2) {
      w = dp.inlineSize;
      h = dp.blockSize;
    }
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.rect = this.canvas.getBoundingClientRect();
    this.refit();
    this.invalidate(true);
    if (cssW > 0 && cssH > 0) this.resolveReady();
  }

  // ---------- pointer manager ----------

  private prevent = (e: Event) => e.preventDefault();

  private cssOf(e: PointerEvent): Vec {
    const r = this.rect ?? this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private hitTolMm(): number {
    return (this.settings.largeHandles ? HIT_CSS.large : HIT_CSS.normal) * this.mmPerCssPx();
  }

  private hitAll(
    pMm: Vec,
    pCss: Vec,
  ): { tool: ToolInstance | null; handle: Handle; special?: Special } | null {
    const tol = this.hitTolMm();
    if (this.pinned) {
      if (dist(pMm, this.pinned.focus) <= tol) {
        return { tool: null, special: 'pin', handle: { id: 'pin', kind: 'point', posMm: this.pinned.focus } };
      }
      if (dist(pCss, this.pinned.center) <= LOUPE_R_CSS) {
        return { tool: null, special: 'pinwin', handle: { id: 'pinwin', kind: 'body', posMm: pMm } };
      }
    }
    const order = [...this.tools].reverse();
    const sel = this.selected();
    if (sel) order.sort((a, b) => (a === sel ? -1 : b === sel ? 1 : 0));
    let body: { tool: ToolInstance; handle: Handle } | null = null;
    let best: { tool: ToolInstance; handle: Handle; d: number } | null = null;
    for (const t of order) {
      const h = t.hitTest(pMm, tol);
      if (!h) continue;
      if (h.kind === 'body') {
        body ??= { tool: t, handle: h };
        continue;
      }
      const d = dist(pMm, h.posMm);
      if (!best || d < best.d - 1e-9) best = { tool: t, handle: h, d };
    }
    return best ?? body;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (!this.interacted) {
      this.interacted = true;
      this.cb.onFirstInteraction?.();
    }
    const css = this.cssOf(e);
    const mm = this.transform.cssPxToMm(css);
    const mmPerCss = this.mmPerCssPx();
    const big = isBigContact(
      {
        pointerType: e.pointerType,
        widthMm: (e.width || 0) * mmPerCss,
        heightMm: (e.height || 0) * mmPerCss,
      },
      this.settings.shield,
    );
    const hit = this.measuring ? this.hitAll(mm, css) : null;
    if (!this.measuring) {
      this.cb.onBlocked?.('guard');
      return;
    }
    const role = classifyContact({
      mode: this.settings.shield,
      big,
      hit: hit ? (hit.handle.kind === 'body' ? 'body' : 'handle') : 'none',
      sameToolAsDrag: !!(hit && this.drag && hit.tool && hit.tool === this.drag.tool),
      dragActive: !!this.drag,
      locked: this.locked && !hit?.special,
    });
    if (this.locked && hit && !hit.special && role === 'ignore') this.cb.onBlocked?.('locked');
    switch (role) {
      case 'drag':
        if (hit) this.startDrag(e, hit, mm, css);
        break;
      case 'twist':
        if (this.drag && this.drag.tool?.rotateBy && this.drag.tool.angle && !this.twist) {
          this.twist = {
            pointerId: e.pointerId,
            pos: mm,
            lastAngle: this.angleBetween(this.drag.lastRaw, mm),
            accum: 0,
            startToolAngle: this.drag.tool.angle(),
          };
          this.clearLongPress();
          this.capture(e);
        } else {
          this.precisionPointers.add(e.pointerId);
        }
        break;
      case 'precision':
        this.precisionPointers.add(e.pointerId);
        this.invalidate();
        break;
      case 'empty': {
        let group: number | null = null;
        for (const c of this.empty.values()) {
          if (performance.now() - c.downAt < 180) {
            c.group ??= ++this.groupSeq;
            group = c.group;
          }
        }
        const sel = this.selected();
        const indirect =
          this.settings.shield !== 'strict' && !this.locked ? (sel?.indirect?.(mm) ?? null) : null;
        this.empty.set(e.pointerId, {
          downAt: performance.now(),
          pos: css,
          downMm: mm,
          moved: false,
          group,
          indirect,
        });
        this.armTwoFingerHold();
        break;
      }
      case 'ignore':
        break;
    }
  };

  /** Two still fingers on empty canvas for 600 ms → onTwoFingerHold (not in Strict shield mode). */
  private armTwoFingerHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    const list = [...this.empty.values()];
    if (list.length !== 2 || this.settings.shield === 'strict' || this.locked) return;
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      const now = [...this.empty.values()];
      if (now.length !== 2 || now.some((c) => c.moved)) return;
      now.forEach((c) => (c.consumed = true));
      this.haptic('tick');
      this.cb.onTwoFingerHold?.(this.transform.cssPxToMm(now[0].pos), this.transform.cssPxToMm(now[1].pos));
    }, TWO_FINGER_HOLD_MS);
  }

  private capture(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests */
    }
  }

  private startDrag(
    e: PointerEvent,
    hit: { tool: ToolInstance | null; handle: Handle; special?: Special },
    mm: Vec,
    css: Vec,
  ): void {
    this.capture(e);
    if (hit.tool) {
      if (this.selectedId !== hit.tool.id) this.select(hit.tool.id);
      hit.tool.onDragStart(hit.handle, mm);
    }
    this.drag = {
      pointerId: e.pointerId,
      tool: hit.tool,
      special: hit.special,
      handle: hit.handle,
      lastRaw: mm,
      virt: mm,
      start: mm,
      startCss: css,
      cssPos: css,
      moved: false,
      startedAt: performance.now(),
      longPress: null,
      before: hit.tool ? JSON.stringify(hit.tool.serialize()) : '',
    };
    if (hit.tool && hit.handle.kind !== 'body' && !hit.handle.id.startsWith('ind')) {
      this.drag.longPress = window.setTimeout(() => this.fireLongPress(), LONG_PRESS_MS);
      this.lastHandle = { toolId: hit.tool.id, handle: hit.handle };
    } else if (hit.tool) {
      this.lastHandle = null;
    }
    this.cb.onActiveHandle?.(css);
    this.invalidate(true);
  }

  private fireLongPress(): void {
    const d = this.drag;
    if (!d || d.moved || !d.tool) return;
    d.longPress = null;
    d.tool.onDragEnd(d.handle);
    try {
      this.canvas.releasePointerCapture(d.pointerId);
    } catch {
      /* ignore */
    }
    this.drag = null;
    this.cb.onActiveHandle?.(null);
    this.haptic('tick');
    this.cb.onLongPress?.(d.tool, d.handle, d.cssPos);
    this.invalidate();
  }

  private clearLongPress(): void {
    if (this.drag?.longPress) {
      clearTimeout(this.drag.longPress);
      this.drag.longPress = null;
    }
  }

  precisionActive(): boolean {
    return this.precisionLatched || this.precisionPointers.size > 0;
  }

  private angleBetween(a: Vec, b: Vec): number {
    // Screen-space angle (accounts for anisotropic scale).
    const pa = this.transform.mmToDevicePx(a);
    const pb = this.transform.mmToDevicePx(b);
    return rad2deg(Math.atan2(pb[1] - pa[1], pb[0] - pa[0]));
  }

  private onMove = (e: PointerEvent): void => {
    const css = this.cssOf(e);
    const mm = this.transform.cssPxToMm(css);
    const d = this.drag;
    if (d && e.pointerId === d.pointerId) {
      e.preventDefault();
      const delta = sub(mm, d.lastRaw);
      const prevCss = d.cssPos;
      d.lastRaw = mm;
      d.cssPos = css;
      if (this.twist) {
        this.applyTwist();
        return;
      }
      const precision = this.precisionActive();
      d.virt = add(d.virt, scale(delta, precision ? PRECISION_FACTOR : 1));
      if (!d.moved && dist(css, d.startCss) > 6) {
        d.moved = true;
        this.clearLongPress();
      }
      if (d.special === 'pin' && this.pinned) {
        const a = this.canvasAreaMm();
        this.pinned.focus = [Math.min(a.w, Math.max(0, d.virt[0])), Math.min(a.h, Math.max(0, d.virt[1]))];
      } else if (d.special === 'pinwin' && this.pinned) {
        this.pinned.center = add(this.pinned.center, sub(css, prevCss));
      } else if (d.tool) {
        d.tool.onDragMove(d.handle, d.virt, precision);
        d.tool.fit?.(this.boundsMm());
      }
      this.cb.onActiveHandle?.(css);
      this.invalidate(true);
      return;
    }
    if (this.twist && e.pointerId === this.twist.pointerId) {
      this.twist.pos = mm;
      this.applyTwist();
      return;
    }
    const c = this.empty.get(e.pointerId);
    // A single finger moving in the dimmed surround drives the nearest side (indirect drag).
    const sel = this.selected();
    if (
      c &&
      c.indirect &&
      sel &&
      !c.consumed &&
      !this.drag &&
      this.empty.size === 1 &&
      dist(c.pos, css) > 6
    ) {
      this.empty.delete(e.pointerId);
      if (this.holdTimer) clearTimeout(this.holdTimer);
      this.holdTimer = null;
      this.startDrag(e, { tool: sel, handle: c.indirect }, c.downMm, c.pos);
      this.onMove(e);
      return;
    }
    if (c && dist(c.pos, css) > 10) {
      c.moved = true;
      if (this.holdTimer) clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  };

  private applyTwist(): void {
    const d = this.drag;
    const tw = this.twist;
    if (!d || !tw || !d.tool?.rotateBy || !d.tool.angle) return;
    const a = this.angleBetween(d.lastRaw, tw.pos);
    tw.accum += normAngle(a - tw.lastAngle);
    tw.lastAngle = a;
    let target = tw.startToolAngle + tw.accum;
    if (this.settings.snapAngles) {
      const [s, snapped] = snapAngle(target, 15, 2);
      if (snapped && Math.abs(normAngle(s - d.tool.angle())) > 1e-6) this.haptic('snap');
      target = s;
    }
    const pivot = scale(add(d.lastRaw, tw.pos), 0.5);
    d.tool.rotateBy(normAngle(target - d.tool.angle()), pivot);
    d.tool.fit?.(this.boundsMm());
    d.moved = true;
    this.invalidate(true);
  }

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (d && e.pointerId === d.pointerId) {
      this.clearLongPress();
      this.drag = null;
      this.twist = null;
      this.precisionPointers.clear();
      if (d.tool) {
        d.tool.onDragEnd(d.handle);
        if (JSON.stringify(d.tool.serialize()) !== d.before) this.cb.onCommit?.(d.tool);
      }
      this.cb.onActiveHandle?.(null);
      this.invalidate(true);
      return;
    }
    if (this.twist && e.pointerId === this.twist.pointerId) {
      this.twist = null;
      // Re-anchor the drag so the body does not jump after the twist.
      if (this.drag?.tool) {
        this.drag.tool.onDragEnd(this.drag.handle);
        this.drag.tool.onDragStart(this.drag.handle, this.drag.lastRaw);
        this.drag.virt = this.drag.lastRaw;
      }
      return;
    }
    if (this.precisionPointers.delete(e.pointerId)) {
      this.invalidate();
      return;
    }
    const c = this.empty.get(e.pointerId);
    if (c) {
      this.empty.delete(e.pointerId);
      if (this.holdTimer) clearTimeout(this.holdTimer);
      this.holdTimer = null;
      if (c.consumed) return;
      const now = performance.now();
      const quick = now - c.downAt < 350 && !c.moved && e.type === 'pointerup';
      if (c.group !== null) {
        const rest = [...this.empty.values()].filter((x) => x.group === c.group);
        if (rest.some((x) => x.consumed)) return;
        if (rest.length === 0 && quick && this.settings.shield !== 'strict') this.cb.onTwoFingerTap?.();
        return;
      }
      if (!quick || this.settings.shield === 'strict') return;
      if (this.lastTap && now - this.lastTap.at < 320 && dist(this.lastTap.pos, c.pos) < 40) {
        this.lastTap = null;
        this.cb.onDoubleTapEmpty?.();
      } else {
        this.lastTap = { at: now, pos: c.pos };
      }
    }
  };

  private cancelDrag(): void {
    if (!this.drag) return;
    this.clearLongPress();
    this.drag.tool?.onDragEnd(this.drag.handle);
    this.drag = null;
    this.twist = null;
    this.precisionPointers.clear();
    this.cb.onActiveHandle?.(null);
  }

  // ---------- feedback ----------

  haptic(kind: 'snap' | 'tick'): void {
    if (kind === 'snap') this.cb.onSnap?.();
    if (!this.settings.haptics) return;
    const ok =
      typeof navigator !== 'undefined' &&
      'vibrate' in navigator &&
      navigator.vibrate(kind === 'snap' ? 8 : 15);
    if (!ok && this.drag) {
      // Visual pulse fallback (iOS has no vibration).
      this.pulse = { pos: this.drag.cssPos, until: performance.now() + 160 };
      this.invalidate();
    }
  }

  // ---------- rendering ----------

  private loop = (): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.pulse && performance.now() > this.pulse.until) {
      this.pulse = null;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    if (this.readoutsDirty) {
      this.readoutsDirty = false;
      const t = this.selected();
      this.cb.onReadouts?.(t ? t.readouts() : [], t);
    }
  };

  theme(): ThemeTokens {
    const bg = this.settings.background.color;
    const [accent, accent2] = accentsFor(bg);
    return { bg, ink: inkFor(bg), accent, accent2, skin: this.settings.skin, font: FONT };
  }

  private makeRc(theme: ThemeTokens, loupe?: { focus: Vec; center: Vec; zoom: number }): RenderContext {
    const { sx, sy } = this.transform;
    const z = loupe?.zoom ?? 1;
    const fx = loupe ? loupe.focus[0] : 0;
    const fy = loupe ? loupe.focus[1] : 0;
    const cx = loupe ? loupe.center[0] : 0;
    const cy = loupe ? loupe.center[1] : 0;
    const active = this.drag?.tool ? this.drag.handle.id : null;
    return {
      ctx: this.ctx,
      mmToPx: (p) => [cx + (p[0] - fx) * sx * z, cy + (p[1] - fy) * sy * z],
      pxToMm: (p) => [fx + (p[0] - cx) / (sx * z), fy + (p[1] - cy) / (sy * z)],
      pxPerMm: ((sx + sy) / 2) * z,
      dpr: this.dpr,
      theme,
      unit: this.settings.unit,
      fractionDen: this.settings.fractionDen,
      inLoupe: !!loupe,
      loupeZoom: z,
      selected: false,
      activeHandleId: active,
      largeHandles: this.settings.largeHandles,
      tags: this.settings.canvasLabels,
    };
  }

  private drawTools(rc: RenderContext): void {
    const sel = this.selected();
    for (const t of this.tools) {
      if (t === sel) continue;
      t.render({ ...rc, selected: false, activeHandleId: null });
    }
    if (sel)
      sel.render({
        ...rc,
        selected: true,
        activeHandleId: this.drag?.tool === sel ? this.drag.handle.id : null,
      });
  }

  /** Dim everything outside the selected tool's measured region. */
  private drawSpotlight(rc: RenderContext, area: RectMm): void {
    if (!this.settings.spotlight) return;
    const polys = this.selected()?.spotlight?.();
    if (!polys || polys.length === 0) return;
    const { ctx } = rc;
    const m = 50;
    const a = rc.mmToPx([area.x - m, area.y - m]);
    const b = rc.mmToPx([area.x + area.w + m, area.y + area.h + m]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    for (const poly of polys) {
      poly.forEach((p, i) => {
        const q = rc.mmToPx(p);
        if (i === 0) ctx.moveTo(q[0], q[1]);
        else ctx.lineTo(q[0], q[1]);
      });
      ctx.closePath();
    }
    ctx.fillStyle = luminance(rc.theme.bg) > 0.3 ? 'rgba(10,14,22,0.62)' : 'rgba(255,255,255,0.2)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  private drawEdges(rc: RenderContext): void {
    if (!this.showEdges || !this.usableCss) return;
    const { ctx } = rc;
    const d = this.dpr;
    const r = this.usableCss;
    ctx.save();
    ctx.strokeStyle = rc.theme.ink;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * d, 4 * d]);
    ctx.beginPath();
    const x0 = crisp(r.x * d, 1);
    const y0 = crisp(r.y * d, 1);
    const x1 = crisp((r.x + r.w) * d, 1);
    const y1 = crisp((r.y + r.h) * d, 1);
    const rad = (this.edges?.cornerRadius ?? 0) * d;
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2));
    ctx.stroke();
    for (const z of this.edges?.exclusions ?? []) {
      ctx.beginPath();
      ctx.arc(z.cx * d, z.cy * d, z.r * d, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLoupe(theme: ThemeTokens, focus: Vec, centerCss: Vec, pinnedMark: boolean): void {
    const { ctx } = this;
    const d = this.dpr;
    const R = LOUPE_R_CSS * d;
    const C: Vec = [centerCss[0] * d, centerCss[1] * d];
    const zoom = Math.max(2, Math.min(8, this.settings.loupeZoom));
    const rc = this.makeRc(theme, { focus, center: C, zoom });
    const span = R / (Math.min(this.transform.sx, this.transform.sy) * zoom);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C[0], C[1], R, 0, Math.PI * 2);
    ctx.clip();
    drawBackground(
      rc,
      { x: focus[0] - span, y: focus[1] - span, w: 2 * span, h: 2 * span },
      this.settings.background,
    );
    this.drawSpotlight(rc, { x: focus[0] - span, y: focus[1] - span, w: 2 * span, h: 2 * span });
    this.drawTools(rc);
    this.overlay?.(rc);
    // Crosshair with a gap at the centre so it never hides the edge.
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const g = 6 * d;
    const cxp = crisp(C[0], 1);
    const cyp = crisp(C[1], 1);
    ctx.moveTo(C[0] - R, cyp);
    ctx.lineTo(C[0] - g, cyp);
    ctx.moveTo(C[0] + g, cyp);
    ctx.lineTo(C[0] + R, cyp);
    ctx.moveTo(cxp, C[1] - R);
    ctx.lineTo(cxp, C[1] - g);
    ctx.moveTo(cxp, C[1] + g);
    ctx.lineTo(cxp, C[1] + R);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(C[0], C[1], R, 0, Math.PI * 2);
    ctx.lineWidth = 3 * d;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
    ctx.lineWidth = 1.2 * d;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.font = `700 ${11 * d}px ${FONT}`;
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.fillText(`${zoom}×`, C[0], C[1] + R - 8 * d);
    ctx.restore();
    if (pinnedMark) {
      const main = this.makeRc(theme);
      const p = main.mmToPx(focus);
      ctx.save();
      ctx.strokeStyle = theme.accent2;
      ctx.lineWidth = 2 * d;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 10 * d, 0, Math.PI * 2);
      ctx.moveTo(p[0] - 16 * d, p[1]);
      ctx.lineTo(p[0] - 4 * d, p[1]);
      ctx.moveTo(p[0] + 4 * d, p[1]);
      ctx.lineTo(p[0] + 16 * d, p[1]);
      ctx.moveTo(p[0], p[1] - 16 * d);
      ctx.lineTo(p[0], p[1] - 4 * d);
      ctx.moveTo(p[0], p[1] + 4 * d);
      ctx.lineTo(p[0], p[1] + 16 * d);
      ctx.stroke();
      ctx.restore();
    }
  }

  private loupeCenterFor(fingerCss: Vec): Vec {
    let cy = fingerCss[1] - LOUPE_OFFSET_CSS - LOUPE_R_CSS * 0.4;
    if (cy - LOUPE_R_CSS < 6) cy = fingerCss[1] + LOUPE_OFFSET_CSS + LOUPE_R_CSS * 0.4;
    const cx = Math.min(this.cssW - LOUPE_R_CSS - 6, Math.max(LOUPE_R_CSS + 6, fingerCss[0]));
    return [cx, cy];
  }

  private draw(): void {
    const { ctx } = this;
    if (!this.canvas.width || !this.canvas.height) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const theme = this.theme();
    const rc = this.makeRc(theme);
    drawBackground(rc, this.canvasAreaMm(), this.settings.background);
    this.drawSpotlight(rc, this.canvasAreaMm());
    this.drawEdges(rc);
    this.drawTools(rc);
    this.overlay?.(rc);
    if (this.pulse) {
      ctx.save();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3 * this.dpr;
      ctx.beginPath();
      ctx.arc(this.pulse.pos[0] * this.dpr, this.pulse.pos[1] * this.dpr, 26 * this.dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (this.pinned) this.drawLoupe(theme, this.pinned.focus, this.pinned.center, true);
    const d = this.drag;
    if (d && d.tool && d.handle.kind !== 'body' && this.settings.loupe && !this.twist) {
      const focus = d.tool.focusOf?.(d.handle.id) ?? d.virt;
      this.drawLoupe(theme, focus, this.loupeCenterFor(d.cssPos), false);
    }
    if (this.precisionActive() && d) {
      ctx.save();
      ctx.font = `700 ${12 * this.dpr}px ${FONT}`;
      ctx.fillStyle = theme.accent;
      ctx.textAlign = 'center';
      ctx.fillText('×0.1', d.cssPos[0] * this.dpr, (d.cssPos[1] + 46) * this.dpr);
      ctx.restore();
    }
    if (!this.measuring) {
      ctx.save();
      ctx.fillStyle = 'rgba(15,23,42,0.45)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
  }

  /** Screen snapshot (§12): the measuring canvas plus a caption, as PNG. */
  async snapshotPng(caption: string[]): Promise<Blob | null> {
    this.draw();
    const c = document.createElement('canvas');
    const lineH = 22 * this.dpr;
    c.width = this.canvas.width;
    c.height = this.canvas.height + lineH * (caption.length + 1);
    const x = c.getContext('2d');
    if (!x) return null;
    x.fillStyle = '#0f172a';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(this.canvas, 0, 0);
    x.fillStyle = '#ffffff';
    x.font = `600 ${14 * this.dpr}px ${FONT}`;
    caption.forEach((t, i) => x.fillText(t, 12 * this.dpr, this.canvas.height + lineH * (i + 1)));
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }
}
