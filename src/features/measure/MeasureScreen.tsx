import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Lock,
  Unlock,
  Contrast,
  Palette,
  Focus,
  Undo2,
  Redo2,
  CircleHelp,
  ImageDown,
  History,
  Save,
  Settings as SettingsIcon,
  FolderOpen,
  Move,
  Trash2,
  MoreHorizontal,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import type { ToolId, Vec } from '../../core/types';
import { edgesToCurrent, makeTransform, usableRect } from '../../core/calibration';
import { toMm, type LengthUnit } from '../../core/units';
import { evaluateTolerance } from '../../core/tolerance';
import { repeatStats } from '../../core/uncertainty';
import { Stage } from '../../render/Stage';
import type { Handle, Readout, ToolInstance } from '../../render/types';
import type { BackgroundSpec } from '../../render/background';
import { TOOL_REGISTRY, createTool, QUICK_SHAPES, type QuickShape } from '../../tools/registry';
import { RulerTool } from '../../tools/ruler/RulerTool';
import { defaultRulerState } from '../../tools/ruler/RulerTool';
import { useSettings } from '../../state/settings';
import { useEnv } from '../../state/env';
import { resolveScale, useCalibration } from '../../state/calibration';
import { useLive } from '../../state/live';
import { extraKey, useExtras } from '../../state/extras';
import { UndoStack, autosave, loadSession } from '../../state/session';
import { db, pushHistory, type HistoryEntry } from '../../db';
import type { ToolMeasurement } from '../../tools/base';
import { navigate, useRoute } from '../../app/router';
import { blankRecord, getRecord, nextRecordName, saveRecord, withMeasurements } from '../records/repo';
import { recipeProgress, type RecipeStep } from '../records/recipes';
import type { PartRecord } from '../../core/types';
import { ReadoutHud, fmtReadout, fmtU } from '../../app/components/ReadoutHud';
import { BackgroundPanel, nextPreset } from '../../app/components/BackgroundPanel';
import { SaveDialog } from '../../app/components/SaveDialog';
import { ToleranceSheet } from '../../app/components/ToleranceSheet';
import { ThumbWheel } from '../../app/components/ThumbWheel';
import { Btn, IconBtn, Segmented, Sheet, cx, inputCls, useToast } from '../../app/components/ui';
import { ToolIcon } from '../../app/components/ToolIcon';
import { BoltWizardSheet } from '../bolt/BoltWizard';
import { IdentifySheet } from '../identify/IdentifySheet';

type DockId = ToolId | 'shapes' | 'more';

/** One slim row; scrolls sideways on narrow phones. */
const DOCK: { id: DockId; labelKey: string }[] = [
  { id: 'ruler', labelKey: 'tool.ruler' },
  { id: 'box', labelKey: 'tool.box' },
  { id: 'leapfrog', labelKey: 'tool.leapfrog' },
  { id: 'caliper', labelKey: 'tool.caliperShort' },
  { id: 'protractor', labelKey: 'tool.protractorShort' },
  { id: 'circle', labelKey: 'tool.circleShort' },
  { id: 'hex', labelKey: 'tool.hexShort' },
  { id: 'rect', labelKey: 'tool.rectShort' },
  { id: 'shapes', labelKey: 'dock.shapes' },
  { id: 'more', labelKey: 'dock.more' },
];

/** Specialty tools (§6.5, §6.7, §6.8) in the "More" sheet. */
const SPECIALTY: { id: ToolId; init?: Record<string, unknown>; labelKey: string; icon: string }[] = [
  { id: 'threadGauge', labelKey: 'tool.threadGauge', icon: 'threadGauge' },
  { id: 'wireGauge', labelKey: 'tool.wireGauge', icon: 'wireGauge' },
  { id: 'radiusGauge', labelKey: 'tool.radiusGauge', icon: 'radiusGauge' },
  { id: 'gasket', labelKey: 'tool.gasket', icon: 'ring' },
  { id: 'gasket', init: { mode: 'pcd' }, labelKey: 'tool.pcd', icon: 'circle' },
  { id: 'datumXY', labelKey: 'tool.datumXY', icon: 'datumXY' },
  { id: 'grid', labelKey: 'tool.grid', icon: 'grid' },
  { id: 'polygon', labelKey: 'tool.polygon', icon: 'polygon' },
];

/** Later-phase tools shown in "More" so the roadmap is visible. */
const LATER: { id: string; phase: number }[] = [{ id: 'photoMeasure', phase: 5 }];

export function MeasureScreen() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const settings = useSettings();
  const env = useEnv((s) => s.env);
  const envKey = useEnv((s) => s.key);
  const vp = useEnv((s) => s.viewport);
  const cal = useCalibration();
  const scale = useMemo(() => resolveScale(env, cal), [env, cal]);
  const setLiveReadouts = useLive((s) => s.setReadouts);
  const setAvoid = useLive((s) => s.setAvoid);
  const dragging = useLive((s) => s.avoid !== null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const undo = useRef(new UndoStack());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [sel, setSel] = useState<ToolInstance | null>(null);
  const [focus, setFocus] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [precision, setPrecision] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [saveMs, setSaveMs] = useState<ToolMeasurement[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [calInfo, setCalInfo] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [menu, setMenu] = useState<{ tool: ToolInstance; handle: Handle; pos: Vec } | null>(null);
  const [exact, setExact] = useState<{ tool: ToolInstance; handle: Handle } | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [boltOpen, setBoltOpen] = useState(false);
  const [idOpen, setIdOpen] = useState(false);
  const [tolTarget, setTolTarget] = useState<{ key: string; readout: Readout } | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);
  const route = useRoute();
  /** "Measure into record" from a recipe step (§9 guided recipes). */
  const [into, setInto] = useState<{ rec: PartRecord; step: RecipeStep } | null>(null);

  // ---------- stage lifecycle ----------
  useEffect(() => {
    const st = new Stage(canvasRef.current!);
    stageRef.current = st;
    // Exposed for end-to-end tests and debugging (no secrets in here).
    (window as unknown as { __maapak?: Stage }).__maapak = st;
    let cancelled = false;
    void Promise.all([loadSession(), st.ready]).then(([snap]) => {
      if (cancelled) return;
      if (snap) {
        try {
          st.restore(JSON.parse(snap), TOOL_REGISTRY);
        } catch {
          /* start fresh */
        }
      }
      if (st.tools.length === 0) {
        const r = createTool('ruler', []);
        if (r) st.addTool(r);
      }
      undo.current.reset(JSON.stringify(st.snapshot()));
      setSel(st.selected());
      bump();
    });
    return () => {
      cancelled = true;
      st.destroy();
      stageRef.current = null;
    };
  }, []);

  const commit = useCallback(
    (tool: ToolInstance | null) => {
      const st = stageRef.current;
      if (!st) return;
      const snap = JSON.stringify(st.snapshot());
      if (undo.current.push(snap)) autosave(snap);
      const r = tool?.readouts().find((x) => x.primary);
      if (tool && r && r.unit !== 'count' && r.value > 0) {
        const entry: HistoryEntry = {
          createdAt: Date.now(),
          toolInstanceId: tool.id,
          tool: tool.tool,
          kind: r.kind,
          label: r.label,
          value: r.value,
          uncertainty: r.uncertainty,
          unit: r.unit,
          calibrationId: scale.profile.id,
          toolState: tool.serialize(),
        };
        void pushHistory(entry);
      }
      bump();
    },
    [scale.profile.id],
  );

  const restoreSnap = (snap: string | null) => {
    const st = stageRef.current;
    if (!snap || !st) return;
    st.restore(JSON.parse(snap), TOOL_REGISTRY);
    autosave(snap);
    setSel(st.selected());
    bump();
  };
  const doUndo = () => restoreSnap(undo.current.undo());
  const doRedo = () => restoreSnap(undo.current.redo());

  const applyBg = useCallback((b: BackgroundSpec, tool: ToolInstance | null) => {
    const st = useSettings.getState();
    st.set({ background: b, bgByTool: tool ? { ...st.bgByTool, [tool.tool]: b } : st.bgByTool });
  }, []);

  const maybeFullscreen = () => {
    const s = useSettings.getState();
    if (!s.fullscreen || document.fullscreenElement || !/Android/i.test(navigator.userAgent)) return;
    void document.documentElement
      .requestFullscreen?.({ navigationUI: 'hide' })
      .then(() =>
        (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> })?.lock?.('portrait'),
      )
      .catch(() => {});
  };

  /** Two fingers held on empty glass → two measuring lines exactly at the two fingers. */
  const twoFingerGap = (a: Vec, b: Vec) => {
    const st = stageRef.current;
    if (!st) return;
    const g = new RulerTool(defaultRulerState('ruler', 1));
    g.placeAt(a, b, st.boundsMm());
    st.clearTools();
    st.addTool(g);
    commit(g);
    setSel(g);
    toast(t('gesture.gapPlaced'));
  };

  useEffect(() => {
    stageRef.current?.setCallbacks({
      onReadouts: (r, tool) => setLiveReadouts(r, tool?.id ?? null),
      onCommit: commit,
      onSelect: (tool) => {
        setSel(tool);
        const s = useSettings.getState();
        const b = tool ? s.bgByTool[tool.tool] : undefined;
        if (b && (b.color !== s.background.color || b.pattern !== s.background.pattern))
          s.set({ background: b });
      },
      onLongPress: (tool, handle, pos) => setMenu({ tool, handle, pos }),
      onDoubleTapEmpty: () => setFocus((f) => !f),
      onTwoFingerTap: doUndo,
      onTwoFingerHold: twoFingerGap,
      onActiveHandle: setAvoid,
      onFirstInteraction: maybeFullscreen,
      onBlocked: (why) => toast(why === 'locked' ? t('banner.lockedHint') : t('banner.blockedHint')),
    });
  });

  // ---------- push state into the stage ----------
  useEffect(() => {
    stageRef.current?.setTransform(makeTransform(scale.profile, env.orientationAngle, env.dpr));
  }, [scale.profile, env.orientationAngle, env.dpr]);

  const edges = cal.edges[envKey];
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    if (edges) {
      const cur = edgesToCurrent(edges, env.orientationAngle);
      st.setUsable(usableRect(cur, vp.w, vp.h), cur);
    } else st.setUsable(null, null);
  }, [edges, env.orientationAngle, vp.w, vp.h]);

  useEffect(() => {
    stageRef.current?.setSettings({
      unit: settings.unit,
      fractionDen: settings.fractionDen,
      skin: settings.skin,
      background: settings.background,
      largeHandles: settings.largeHandles,
      shield: settings.shield,
      loupe: settings.loupe,
      loupeZoom: settings.loupeZoom,
      snapTicks: settings.snapTicks,
      snapHalfMm: settings.snapHalfMm,
      snapHandles: settings.snapHandles,
      snapAngles: settings.snapAngles,
      haptics: settings.haptics,
      nudgeStep: settings.nudgeStep,
      canvasLabels: settings.canvasLabels,
      spotlight: settings.spotlight,
    });
  }, [settings]);

  useEffect(() => {
    stageRef.current?.setModel({ relCal: scale.relCal, protector: scale.profile.screenProtector });
  }, [scale.relCal, scale.profile.screenProtector]);

  useEffect(() => {
    stageRef.current?.setMeasuring(scale.guard.ok);
  }, [scale.guard.ok]);

  useEffect(() => {
    stageRef.current?.setLocked(locked);
  }, [locked]);

  useEffect(() => {
    const st = stageRef.current;
    if (st) st.precisionLatched = precision;
  }, [precision]);

  // New tools are placed clear of the top bar and the dock.
  useLayoutEffect(() => {
    const rail = railRef.current?.getBoundingClientRect();
    const side = rail && !focus ? rail.width + 8 : 0;
    stageRef.current?.setPlacementInsets(
      // Clear of the top bar and the reading pill under it.
      focus ? 0 : (topRef.current?.getBoundingClientRect().bottom ?? 0) + 50,
      focus
        ? 0
        : window.innerHeight - (bottomRef.current?.getBoundingClientRect().top ?? window.innerHeight) + 6,
      settings.leftHanded ? side : 0,
      settings.leftHanded ? 0 : side,
    );
  });

  // Screen Wake Lock while measuring (§4.9).
  useEffect(() => {
    if (!settings.keepScreenOn || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    };
    req();
    document.addEventListener('visibilitychange', req);
    return () => {
      document.removeEventListener('visibilitychange', req);
      void lock?.release().catch(() => {});
    };
  }, [settings.keepScreenOn]);

  // Keyboard: arrows nudge (Alt + arrows move the pinned lens), Ctrl+Z / Ctrl+Y (§7.2).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      const st = stageRef.current;
      if (!st) return;
      const map: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (map[e.key]) {
        e.preventDefault();
        const reps = e.shiftKey ? 10 : 1;
        for (let i = 0; i < reps; i++) {
          if (e.altKey && st.isLensPinned()) st.moveLens(...map[e.key]);
          else st.nudge(...map[e.key]);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  useEffect(() => {
    if (settings.loaded && settings.onboarded && !settings.tourDone && tour === null) setTour(0);
  }, [settings.loaded, settings.onboarded, settings.tourDone, tour]);

  const intoId = route.query.get('into');
  const stepIdx = Number(route.query.get('step') ?? -1);
  useEffect(() => {
    if (!intoId) {
      setInto(null);
      return;
    }
    let cancelled = false;
    void Promise.all([getRecord(intoId), stageRef.current?.ready]).then(([r]) => {
      if (cancelled || !r) return;
      const step = recipeProgress(r)[stepIdx]?.step;
      if (!step) return;
      setInto({ rec: r, step });
      pickTool(step.tool, step.init ?? {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intoId, stepIdx]);

  // Template / Match mode (§7.9): a saved record's outline at 1:1 with a tolerance band.
  const templateId = route.query.get('template');
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    void Promise.all([getRecord(templateId), stageRef.current?.ready, import('../drawing/model')]).then(
      ([r, , m]) => {
        if (cancelled || !r) return;
        const v = m.recordViews(r)[0];
        if (v) pickTool('template', { outline: v.view.outline, name: r.name });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // ---------- actions ----------
  const pickTool = (id: ToolId, init: Partial<Record<string, unknown>> = {}) => {
    const st = stageRef.current;
    if (!st) return;
    st.clearTools();
    const tool = createTool(id, [], init);
    if (tool) st.addTool(tool);
    setWheelOpen(id === 'caliper');
    commit(st.selected());
    setSel(st.selected());
  };

  const pickShape = (q: QuickShape) => {
    if (q.phase) {
      toast(t('shapes.later', { phase: q.phase }));
      return;
    }
    setShapesOpen(false);
    if (q.id === 'nutBolt') {
      setBoltOpen(true);
      return;
    }
    pickTool(q.tool, q.init);
  };

  const removeSel = () => {
    const st = stageRef.current;
    if (!st || !sel) return;
    st.removeTool(sel.id);
    commit(null);
    setSel(st.selected());
  };

  const runAction = (run: () => void) => {
    const st = stageRef.current;
    run();
    if (st && sel) {
      sel.fit?.(st.boundsMm());
      st.invalidate(true);
    }
    commit(sel);
  };

  /** Measurements of the selected tool, with tolerance and repeat & average attached (§7.5, §7.7). */
  const openSave = (ms?: ToolMeasurement[]) => {
    if (ms) {
      setSaveMs(ms);
      return;
    }
    const tool = stageRef.current?.selected();
    const extras = useExtras.getState().map;
    const list = (tool?.toMeasurements() ?? []).map((m) => {
      const e = extras[extraKey(tool!.id, m.label)];
      let out: ToolMeasurement = { ...m };
      if (e?.repeats?.length) {
        const r = repeatStats(e.repeats, m.uncertainty, m.kind === 'angle' ? 0 : scale.relCal);
        if (r) out = { ...out, value: r.mean, uncertainty: r.U, repeats: [...e.repeats] };
      }
      if (e?.tol) {
        out = {
          ...out,
          tolerance: { ...e.tol, result: evaluateTolerance(out.value, out.uncertainty, e.tol) },
        };
      }
      return out;
    });
    // Recipe step: straight into the record, only the feature the step asks for.
    if (into) {
      const wanted = list.filter((m) => into.step.kinds.includes(m.kind));
      const rec = withMeasurements(
        into.rec,
        wanted.length ? wanted : list.slice(0, 1),
        scale.profile.id,
        into.step.prefix,
      );
      void saveRecord(rec).then(() => {
        toast(t('save.saved', { name: rec.name }));
        // Bolt Wizard: walk straight on to the next open step, then show the result card.
        const next = rec.bolt
          ? recipeProgress(rec).findIndex(({ step, done }) => !done && !!TOOL_REGISTRY[step.tool])
          : -1;
        navigate(next >= 0 ? `/?into=${rec.id}&step=${next}` : `/records/${rec.id}`, true);
      });
      return;
    }
    // Batch / inventory mode: next "Prefix-NN" without a dialog.
    if (settings.batch.on && list.length) {
      void nextRecordName(settings.batch.prefix).then(async (name) => {
        const rec = withMeasurements(
          {
            ...blankRecord(name),
            measuredBy: settings.measuredBy || undefined,
            calibrationLabel: scale.calibrated ? scale.profile.name : t('conf.estimate'),
          },
          list,
          scale.profile.id,
        );
        await saveRecord(rec);
        toast(t('save.saved', { name }));
      });
      return;
    }
    setSaveMs(list);
  };

  const snapshot = async () => {
    const st = stageRef.current;
    if (!st) return;
    const lines = useLive
      .getState()
      .readouts.filter((r) => r.unit !== 'count')
      .map(
        (r) =>
          `${r.label}  ${fmtReadout(r, settings.unit, settings.fractionDen)}  ${r.unit === 'length' ? fmtU(r.uncertainty, settings.unit) : ''}`,
      );
    lines.push(
      `${new Date().toLocaleString()} · ${scale.calibrated ? scale.profile.name : t('banner.estimateShort')}`,
    );
    const blob = await st.snapshotPng(lines);
    if (!blob) return;
    const file = new File([blob], `maapak-${Date.now()}.png`, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Maapak' });
        return;
      }
    } catch {
      /* fall back to download */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(t('snapshot.saved'));
  };

  const togglePin = () => {
    const v = !pinned;
    setPinned(v);
    stageRef.current?.pinLoupe(v);
    if (v) setPadOpen(true);
  };

  const st = stageRef.current;
  const toolActions = sel?.actions?.() ?? [];
  const presets = sel?.presets?.() ?? [];
  const leap = sel instanceof RulerTool && sel.tool === 'leapfrog' ? sel : null;
  const units: { value: LengthUnit; label: string }[] = [
    { value: 'mm', label: 'mm' },
    { value: 'cm', label: 'cm' },
    { value: 'in', label: 'in' },
    { value: 'in-frac', label: '⅛″' },
  ];
  // Chrome steps out of the way while a handle is being dragged.
  const fade = dragging ? 'pointer-events-none opacity-15' : 'opacity-100';
  const railSide = settings.leftHanded ? 'left-1' : 'right-1';

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <canvas ref={canvasRef} className="stage absolute inset-0 h-full w-full" data-testid="stage" />

      {!focus && (
        <div
          ref={topRef}
          className={cx(
            'chrome absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-1.5 pb-1 pt-[max(0.3rem,env(safe-area-inset-top))] transition-opacity',
            fade,
          )}
        >
          <Segmented
            size="sm"
            label={t('settings.unit')}
            value={settings.unit}
            onChange={(u) => settings.set({ unit: u })}
            options={units}
          />
          {scale.calibrated ? (
            <button
              onClick={() => navigate('/calibrate')}
              data-testid="cal-chip"
              title={t(`conf.${scale.profile.confidence}`)}
              className="ml-0.5 flex h-8 items-center gap-1 rounded-full bg-emerald-600/80 px-2 text-[11px] font-bold text-white"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-200" />
              {t('conf.short')}
            </button>
          ) : (
            <button
              onClick={() => setCalInfo((v) => !v)}
              data-testid="cal-warning"
              aria-label={t('banner.notCalibrated')}
              className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-slate-950"
            >
              <TriangleAlert size={18} />
            </button>
          )}
          <span className="flex-1" />
          <IconBtn label={t('nav.records')} onClick={() => navigate('/records')} className="h-9 min-w-9">
            <FolderOpen size={19} />
          </IconBtn>
          <IconBtn label={t('nav.settings')} onClick={() => navigate('/settings')} className="h-9 min-w-9">
            <SettingsIcon size={19} />
          </IconBtn>
        </div>
      )}

      {(into || settings.batch.on) && !focus && (
        <div
          className="absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-sky-600/95 px-3 py-1 text-xs font-bold text-white shadow"
          data-testid="into-chip"
        >
          {into
            ? `→ ${into.rec.name}: ${t(into.step.nameKey)}`
            : `${t('batch.title')}: ${settings.batch.prefix}-NN`}
          <button
            aria-label={t('common.cancel')}
            className="ml-1"
            onClick={() =>
              into ? navigate('/', true) : settings.set({ batch: { ...settings.batch, on: false } })
            }
          >
            <X size={14} />
          </button>
        </div>
      )}

      {calInfo && !scale.calibrated && (
        <div
          className="absolute left-2 top-12 z-30 w-[min(86vw,320px)] rounded-xl bg-amber-400 p-3 text-sm font-semibold text-slate-950 shadow-xl"
          data-testid="cal-popover"
        >
          <button
            className="absolute right-1.5 top-1.5 p-1"
            aria-label={t('common.cancel')}
            onClick={() => setCalInfo(false)}
          >
            <X size={16} />
          </button>
          <p className="pr-5">{t('banner.notCalibrated')}</p>
          <Btn
            variant="primary"
            className="mt-2 min-h-9 bg-slate-900 hover:bg-slate-800"
            onClick={() => navigate('/calibrate')}
          >
            {t('banner.calibrateNow')}
          </Btn>
        </div>
      )}

      {!scale.guard.ok && (
        <GuardBanner
          scale={scale}
          onCal={() => navigate('/calibrate')}
          onEstimate={() => cal.setGuardOverride(true)}
        />
      )}

      <ReadoutHudLive
        unit={settings.unit}
        den={settings.fractionDen}
        secondary={settings.secondaryUnits}
        showRaw={settings.showRaw}
        calibrated={scale.calibrated}
        relCal={scale.relCal}
        top={focus ? 8 : 48}
        leftHanded={settings.leftHanded}
        onAdd={() => openSave()}
        onTolerance={(key, readout) => setTolTarget({ key, readout })}
      />

      {focus && (
        <button
          onClick={() => setFocus(false)}
          className={cx(
            'absolute top-[max(0.5rem,env(safe-area-inset-top))] z-20 rounded-full bg-slate-900/70 p-2.5 text-white',
            railSide,
          )}
          aria-label={t('action.exitFocus')}
        >
          <Minimize2 size={18} />
        </button>
      )}

      {/* Vertical action rail: small, on the side, out of the measuring area (§4.1). */}
      {!focus && (
        <div
          className={cx(
            'chrome absolute top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-2xl p-0.5 transition-opacity',
            railSide,
            fade,
          )}
          data-testid="rail"
          ref={railRef}
        >
          <button
            onClick={() => setRailOpen((v) => !v)}
            aria-label={railOpen ? t('rail.collapse') : t('rail.expand')}
            className="flex h-6 w-10 items-center justify-center text-slate-300"
          >
            {railOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {railOpen && (
            <>
              <RailBtn label={t('action.undo')} disabled={!undo.current.canUndo} onClick={doUndo}>
                <Undo2 size={19} />
              </RailBtn>
              <RailBtn label={t('action.redo')} disabled={!undo.current.canRedo} onClick={doRedo}>
                <Redo2 size={19} />
              </RailBtn>
              <RailBtn
                label={locked ? t('action.unlock') : t('action.lock')}
                active={locked}
                onClick={() => setLocked((v) => !v)}
              >
                {locked ? <Lock size={19} /> : <Unlock size={19} />}
              </RailBtn>
              <RailBtn
                label={t('action.contrastCycle')}
                onClick={() => applyBg(nextPreset(settings.background), sel)}
              >
                <Contrast size={19} />
              </RailBtn>
              <RailBtn label={t('bg.title')} onClick={() => setBgOpen(true)}>
                <Palette size={19} />
              </RailBtn>
              <RailBtn label={t('dock.loupe')} active={pinned} onClick={togglePin} testId="rail-lens">
                <Search size={19} />
              </RailBtn>
              <RailBtn
                label={t('action.nudge')}
                active={padOpen}
                onClick={() => setPadOpen((v) => !v)}
                testId="rail-pad"
              >
                <Move size={19} />
              </RailBtn>
              <RailBtn
                label={t('rail.toolOptions')}
                active={optsOpen}
                disabled={!sel}
                onClick={() => setOptsOpen(true)}
                testId="rail-opts"
              >
                <SlidersHorizontal size={19} />
              </RailBtn>
              <RailBtn
                label={t('identify.title')}
                disabled={!sel}
                onClick={() => setIdOpen(true)}
                testId="rail-identify"
              >
                <ToolIcon id="identify" size={19} />
              </RailBtn>
              <RailBtn label={t('action.focus')} onClick={() => setFocus(true)}>
                <Focus size={19} />
              </RailBtn>
              <RailBtn label={t('common.save')} primary onClick={() => openSave()} testId="save-btn">
                <Save size={19} />
              </RailBtn>
            </>
          )}
        </div>
      )}

      {/* Floating helpers just above the dock. */}
      <div
        className={cx('absolute inset-x-0 z-20 flex flex-col items-center gap-1 transition-opacity', fade)}
        style={{ bottom: focus ? 8 : (bottomRef.current?.offsetHeight ?? 60) + 6 }}
      >
        {presets.length > 0 && !leap && (
          <div className="chrome flex gap-1 rounded-2xl p-1 shadow-xl" data-testid="presets">
            {presets.map((p) => (
              <button
                key={p.id}
                data-testid={`preset-${p.id}`}
                onClick={() => runAction(p.run)}
                className={cx(
                  'tabular h-10 min-w-11 rounded-xl px-2 text-sm font-bold',
                  p.active ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-100',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {leap && (
          <LeapBar
            tool={leap}
            unit={settings.unit}
            onChange={() => {
              stageRef.current?.invalidate(true);
              commit(leap);
            }}
          />
        )}
        {padOpen && st && <NudgePad stage={st} lens={pinned} onCommit={() => commit(st.selected())} />}
        {wheelOpen && st && sel?.wheel && (
          <ThumbWheel onDetents={(n) => st.wheel(n)} onEnd={() => commit(st.selected())} />
        )}
      </div>

      {!focus && (
        <nav
          ref={bottomRef}
          aria-label={t('dock.label')}
          className={cx(
            'chrome absolute inset-x-0 bottom-0 z-20 flex gap-0.5 overflow-x-auto px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 transition-opacity [scrollbar-width:none]',
            fade,
            settings.leftHanded && 'flex-row-reverse',
          )}
        >
          {DOCK.map((d) => {
            const active = d.id !== 'shapes' && d.id !== 'more' && sel?.tool === d.id;
            return (
              <button
                key={d.id}
                onClick={() =>
                  d.id === 'shapes'
                    ? setShapesOpen(true)
                    : d.id === 'more'
                      ? setMoreOpen(true)
                      : pickTool(d.id)
                }
                data-testid={`dock-${d.id}`}
                className={cx(
                  'flex h-12 w-[52px] shrink-0 flex-col items-center justify-center rounded-xl text-[9.5px] font-semibold',
                  active ? 'bg-sky-500/90 text-white' : 'text-slate-200 hover:bg-white/10',
                )}
              >
                {d.id === 'more' ? <MoreHorizontal size={20} /> : <ToolIcon id={d.id} size={20} />}
                <span className="mt-0.5 max-w-full truncate leading-none">{t(d.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Tool options: a compact sheet instead of a permanent row over the canvas. */}
      <Sheet
        open={optsOpen && !!sel}
        onClose={() => setOptsOpen(false)}
        title={sel ? t(`tool.${sel.tool}`) : ''}
        testId="tool-options"
      >
        <div className="flex flex-wrap gap-2">
          {toolActions.map((a) => (
            <Btn
              key={a.id}
              variant={a.active ? 'primary' : 'default'}
              onClick={() => runAction(a.run)}
              data-testid={`opt-${a.id}`}
            >
              {t(a.labelKey)}
            </Btn>
          ))}
          {sel?.wheel && (
            <Btn
              variant={wheelOpen ? 'primary' : 'default'}
              onClick={() => setWheelOpen((v) => !v)}
              data-testid="wheel-toggle"
            >
              {t('wheel.label')}
            </Btn>
          )}
          <Btn variant={precision ? 'primary' : 'default'} onClick={() => setPrecision((v) => !v)}>
            ×0.1 {t('banner.precisionShort')}
          </Btn>
          <Btn
            variant="danger"
            onClick={() => {
              removeSel();
              setOptsOpen(false);
            }}
          >
            <Trash2 size={16} /> {t('action.remove')}
          </Btn>
        </div>
        <p className="mt-3 text-xs text-slate-400">{t('gesture.hint')}</p>
      </Sheet>

      <BackgroundPanel
        open={bgOpen}
        onClose={() => setBgOpen(false)}
        value={settings.background}
        onChange={(b) => applyBg(b, sel)}
      />

      <SaveDialog
        open={saveMs !== null}
        onClose={() => setSaveMs(null)}
        measurements={saveMs ?? []}
        calibrationId={scale.profile.id}
        calibrationLabel={
          scale.calibrated
            ? `${scale.profile.name} (${t(`calMethod.${scale.profile.method}`)})`
            : t('conf.estimate')
        }
        unit={settings.unit}
        den={settings.fractionDen}
      />

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} onAdd={(m) => openSave([m])} />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('dock.more')}>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {SPECIALTY.map((x) => (
            <Btn
              key={x.labelKey}
              data-testid={`more-${x.labelKey.slice(5)}`}
              onClick={() => {
                setMoreOpen(false);
                pickTool(x.id, x.init);
              }}
            >
              <ToolIcon id={x.icon} size={16} /> {t(x.labelKey)}
            </Btn>
          ))}
          <Btn data-testid="more-bolt" onClick={() => (setMoreOpen(false), setBoltOpen(true))}>
            <ToolIcon id="bolt" size={16} /> {t('bolt.title')}
          </Btn>
          <Btn data-testid="more-level" onClick={() => navigate('/level')}>
            <ToolIcon id="level" size={16} /> {t('tool.level')}
          </Btn>
          <Btn data-testid="more-identify" onClick={() => (setMoreOpen(false), setIdOpen(true))}>
            <ToolIcon id="identify" size={16} /> {t('identify.title')}
          </Btn>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Btn
            data-testid="more-twoline"
            onClick={() => {
              setMoreOpen(false);
              pickTool('protractor', { mode: 'twoLine' });
            }}
          >
            <ToolIcon id="protractor" size={16} /> {t('protractor.mode.twoLine')}
          </Btn>
          <Btn
            onClick={() => {
              setMoreOpen(false);
              setHistoryOpen(true);
            }}
          >
            <History size={16} /> {t('action.history')}
          </Btn>
          <Btn
            onClick={() => {
              setMoreOpen(false);
              void snapshot();
            }}
          >
            <ImageDown size={16} /> {t('action.snapshot')}
          </Btn>
          <Btn onClick={() => navigate('/calibrate')}>{t('nav.calibrate')}</Btn>
          <Btn onClick={() => navigate('/edges')}>{t('nav.edges')}</Btn>
          <Btn onClick={() => navigate('/records')}>{t('nav.records')}</Btn>
          <Btn onClick={() => navigate('/learn')}>
            <CircleHelp size={16} /> {t('nav.learn')}
          </Btn>
        </div>
        <h3 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">
          {t('dock.comingSoon')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {LATER.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-400"
            >
              <span>{t(`tool.${l.id}`)}</span>
              <span className="rounded bg-slate-700 px-1.5 text-[10px] font-bold">P{l.phase}</span>
            </div>
          ))}
        </div>
      </Sheet>

      <BoltWizardSheet open={boltOpen} onClose={() => setBoltOpen(false)} />
      <IdentifySheet
        open={idOpen}
        onClose={() => setIdOpen(false)}
        readouts={idOpen ? useLive.getState().readouts : []}
      />

      <Sheet open={shapesOpen} onClose={() => setShapesOpen(false)} title={t('shapes.title')} testId="shapes">
        <div className="grid grid-cols-3 gap-2">
          {QUICK_SHAPES.map((q) => (
            <button
              key={q.id}
              onClick={() => pickShape(q)}
              data-testid={`shape-${q.id}`}
              className={cx(
                'relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl bg-slate-800 p-2 text-xs font-semibold',
                q.phase ? 'text-slate-500' : 'text-slate-100 hover:bg-slate-700',
              )}
            >
              <ToolIcon id={q.icon} size={28} />
              {t(`shapes.${q.id}`)}
              {q.phase && (
                <span className="absolute right-1 top-1 rounded bg-slate-700 px-1 text-[9px] font-bold">
                  P{q.phase}
                </span>
              )}
            </button>
          ))}
        </div>
      </Sheet>

      <ToleranceSheet target={tolTarget} unit={settings.unit} onClose={() => setTolTarget(null)} />

      {menu && (
        <HandleMenu
          pos={menu.pos}
          onClose={() => setMenu(null)}
          canZero={!!menu.tool.setZeroAt}
          canExact={!!menu.tool.setExactValue}
          onZero={() => {
            if (menu.tool.setZeroAt?.(menu.handle.id)) {
              stageRef.current?.invalidate(true);
              commit(menu.tool);
            } else toast(t('menu.notForHandle'));
            setMenu(null);
          }}
          onExact={() => {
            setExact({ tool: menu.tool, handle: menu.handle });
            setMenu(null);
          }}
        />
      )}

      <ExactValueSheet
        target={exact}
        unit={settings.unit}
        onClose={() => setExact(null)}
        onApply={(mm) => {
          if (!exact) return;
          if (exact.tool.setExactValue?.(exact.handle.id, mm)) {
            exact.tool.fit?.(stageRef.current!.boundsMm());
            stageRef.current?.invalidate(true);
            commit(exact.tool);
            setExact(null);
          } else toast(t('menu.doesNotFit'));
        }}
      />

      {tour !== null && (
        <Tour
          step={tour}
          onNext={() => setTour((s) => (s === null ? null : s + 1))}
          onDone={() => {
            setTour(null);
            settings.set({ tourDone: true });
          }}
        />
      )}

      {(locked || precision) && !focus && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-20 flex -translate-x-1/2 gap-1">
          {locked && (
            <span className="rounded-full bg-slate-900/80 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200">
              <Lock size={11} className="mr-1 inline" />
              {t('banner.locked')}
            </span>
          )}
          {precision && (
            <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-bold text-slate-950">
              ×0.1
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RailBtn({
  label,
  children,
  onClick,
  active,
  disabled,
  primary,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
  testId?: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'flex h-9 w-9 items-center justify-center rounded-xl transition active:scale-95 disabled:opacity-30',
        primary
          ? 'bg-sky-500 text-white'
          : active
            ? 'bg-sky-500/90 text-white'
            : 'text-slate-100 hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

function ReadoutHudLive(p: Omit<Parameters<typeof ReadoutHud>[0], 'readouts' | 'toolKey' | 'avoid'>) {
  const readouts = useLive((s) => s.readouts);
  const toolKey = useLive((s) => s.toolKey);
  const avoid = useLive((s) => s.avoid);
  return <ReadoutHud {...p} readouts={readouts} toolKey={toolKey} avoid={avoid} />;
}

/** Only shown when measuring is actually blocked (§3.7). */
function GuardBanner({
  scale,
  onCal,
  onEstimate,
}: {
  scale: ReturnType<typeof resolveScale>;
  onCal: () => void;
  onEstimate: () => void;
}) {
  const { t } = useTranslation();
  const zoom = scale.guard.reasons.includes('zoom');
  return (
    <div className="absolute inset-x-2 top-12 z-30 mx-auto max-w-md">
      <div
        role="alert"
        data-testid="banner-guard"
        className="rounded-xl bg-rose-600/95 px-3 py-2 text-sm font-semibold text-white shadow-lg"
      >
        {zoom ? t('banner.zoom') : t('banner.scaleChanged')}
        {!zoom && (
          <div className="mt-1.5 flex gap-2">
            <button
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-rose-700"
              onClick={onCal}
            >
              {t('banner.recalibrate')}
            </button>
            <button className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold" onClick={onEstimate}>
              {t('banner.useEstimate')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Leapfrog: a large Mark button and a clear running total (§6.1 D). */
function LeapBar({ tool, unit, onChange }: { tool: RulerTool; unit: LengthUnit; onChange: () => void }) {
  const { t } = useTranslation();
  const r = tool.readouts();
  const segs = tool.s.segments.length;
  return (
    <div className="chrome flex items-center gap-2 rounded-2xl p-1.5 shadow-xl" data-testid="leap-bar">
      <button
        className="flex h-12 items-center gap-1 rounded-xl bg-white/10 px-3 text-sm font-bold text-white disabled:opacity-30"
        disabled={segs === 0}
        onClick={() => {
          tool.undoMark();
          onChange();
        }}
      >
        <Undo2 size={18} /> {t('leap.undo')}
      </button>
      <button
        className="flex h-14 min-w-36 flex-col items-center justify-center rounded-xl bg-amber-400 px-5 text-slate-950 shadow active:scale-95"
        data-testid="leap-mark"
        onClick={() => {
          tool.mark();
          onChange();
        }}
      >
        <span className="text-lg font-extrabold leading-none">{t('leap.mark')}</span>
        <span className="text-[10px] font-semibold">{t('leap.markHint')}</span>
      </button>
      <div className="min-w-16 text-center text-white">
        <div className="text-[10px] text-slate-400">{t('leap.segments', { n: segs })}</div>
        <div className="tabular text-sm font-bold">{fmtReadout(r[0], unit, 16)}</div>
        {segs > 0 && (
          <button
            className="text-[10px] text-rose-300 underline"
            onClick={() => {
              tool.resetChain();
              onChange();
            }}
          >
            {t('leap.reset')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Arrow pad: moves the selected handle, or the pinned lens (§7.1, §7.2). */
function NudgePad({ stage, lens, onCommit }: { stage: Stage; lens: boolean; onCommit: () => void }) {
  const { t } = useTranslation();
  const zoom = useSettings((s) => s.loupeZoom);
  const setSettings = useSettings((s) => s.set);
  const [target, setTarget] = useState<'tool' | 'lens'>(lens ? 'lens' : 'tool');
  useEffect(() => setTarget(lens ? 'lens' : 'tool'), [lens]);
  const timer = useRef<{ delay?: ReturnType<typeof setTimeout>; rep?: ReturnType<typeof setInterval> }>({});
  const start = (fn: () => void) => {
    fn();
    timer.current.delay = setTimeout(() => {
      timer.current.rep = setInterval(fn, 60);
    }, 380);
  };
  const stop = () => {
    clearTimeout(timer.current.delay);
    clearInterval(timer.current.rep);
    timer.current = {};
    if (target === 'tool') onCommit();
  };
  const move = (dx: -1 | 0 | 1, dy: -1 | 0 | 1) =>
    target === 'lens' ? stage.moveLens(dx, dy) : stage.nudge(dx, dy);
  const b = (label: string, icon: React.ReactNode, fn: () => void) => (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        start(fn);
      }}
      onPointerUp={stop}
      onPointerLeave={() => (timer.current.delay || timer.current.rep) && stop()}
      onPointerCancel={stop}
      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/12 text-white active:bg-sky-500"
    >
      {icon}
    </button>
  );
  return (
    <div className="chrome flex items-center gap-2 rounded-2xl p-1.5 shadow-xl" data-testid="nudge-pad">
      {lens && (
        <div className="flex flex-col gap-1">
          {(['tool', 'lens'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTarget(k)}
              className={cx(
                'rounded-lg px-2 py-1 text-[10px] font-bold',
                target === k ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-200',
              )}
            >
              {t(`pad.${k}`)}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1">
        <span />
        {b(t('nudge.up'), <ChevronUp size={20} />, () => move(0, -1))}
        <span />
        {b(t('nudge.left'), <ChevronLeft size={20} />, () => move(-1, 0))}
        {target === 'tool' ? (
          b(t('nudge.rotR'), <RotateCw size={16} />, () => stage.rotateSelected(0.5))
        ) : (
          <span />
        )}
        {b(t('nudge.right'), <ChevronRight size={20} />, () => move(1, 0))}
        {target === 'tool' ? (
          b(t('nudge.rotL'), <RotateCcw size={16} />, () => stage.rotateSelected(-0.5))
        ) : (
          <span />
        )}
        {b(t('nudge.down'), <ChevronDown size={20} />, () => move(0, 1))}
        <span />
      </div>
      {target === 'lens' && (
        <div className="flex flex-col items-center gap-1">
          <button
            aria-label={t('pad.zoomIn')}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/12 text-white"
            onClick={() => setSettings({ loupeZoom: Math.min(8, zoom + 1) })}
          >
            <ZoomIn size={16} />
          </button>
          <span className="text-center text-[10px] font-bold text-slate-300">{zoom}×</span>
          <button
            aria-label={t('pad.zoomOut')}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/12 text-white"
            onClick={() => setSettings({ loupeZoom: Math.max(2, zoom - 1) })}
          >
            <ZoomOut size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function HandleMenu({
  pos,
  onClose,
  onZero,
  onExact,
  canZero,
  canExact,
}: {
  pos: Vec;
  onClose: () => void;
  onZero: () => void;
  onExact: () => void;
  canZero: boolean;
  canExact: boolean;
}) {
  const { t } = useTranslation();
  const left = Math.min(window.innerWidth - 210, Math.max(8, pos[0] - 100));
  const top = Math.min(window.innerHeight - 170, Math.max(8, pos[1] - 150));
  return (
    <div className="fixed inset-0 z-40" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="menu"
        className="absolute w-[200px] overflow-hidden rounded-xl bg-slate-900 text-sm text-white shadow-2xl ring-1 ring-white/10"
        style={{ left, top }}
      >
        {canZero && (
          <button
            role="menuitem"
            className="block min-h-11 w-full px-4 text-left hover:bg-white/10"
            onClick={onZero}
          >
            {t('menu.setZero')}
          </button>
        )}
        {canExact && (
          <button
            role="menuitem"
            className="block min-h-11 w-full px-4 text-left hover:bg-white/10"
            onClick={onExact}
          >
            {t('menu.exact')}
          </button>
        )}
        <button
          role="menuitem"
          className="block min-h-11 w-full px-4 text-left text-slate-400 hover:bg-white/10"
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function ExactValueSheet({
  target,
  unit,
  onClose,
  onApply,
}: {
  target: { tool: ToolInstance; handle: Handle } | null;
  unit: LengthUnit;
  onClose: () => void;
  onApply: (mm: number) => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState('');
  const u = unit === 'in-frac' ? 'in' : unit;
  return (
    <Sheet open={!!target} onClose={onClose} title={t('menu.exact')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(v.replace(',', '.'));
          if (Number.isFinite(n) && n >= 0) onApply(toMm(n, u));
        }}
      >
        <div className="flex items-center gap-2">
          <input
            autoFocus
            inputMode="decimal"
            className={inputCls}
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="0.0"
          />
          <span className="text-sm text-slate-300">{u}</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t('menu.exactHint')}</p>
        <Btn variant="primary" className="mt-3 w-full" type="submit">
          {t('common.apply')}
        </Btn>
      </form>
    </Sheet>
  );
}

function HistorySheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (m: ToolMeasurement) => void;
}) {
  const { t } = useTranslation();
  const unit = useSettings((s) => s.unit);
  const den = useSettings((s) => s.fractionDen);
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    if (open)
      void db.history
        .orderBy('seq')
        .reverse()
        .toArray()
        .then(setRows)
        .catch(() => setRows([]));
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={t('history.title')} testId="history">
      {rows.length === 0 && <p className="text-sm text-slate-400">{t('history.empty')}</p>}
      <ul className="divide-y divide-white/5">
        {rows.map((r) => (
          <li key={r.seq} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="tabular font-semibold">
                {r.label} {fmtReadout({ ...r, unit: r.unit ?? 'length' }, unit, den)}{' '}
                <span className="text-xs text-slate-400">
                  {r.unit === 'length' || !r.unit ? fmtU(r.uncertainty, unit) : ''}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {t(`tool.${r.tool}`)} · {new Date(r.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <Btn
              className="min-h-9 px-3 text-xs"
              onClick={() => {
                onClose();
                onAdd({
                  tool: r.tool,
                  kind: r.kind,
                  label: r.label,
                  value: r.value,
                  uncertainty: r.uncertainty,
                  toolState: r.toolState,
                });
              }}
            >
              {t('history.addToRecord')}
            </Btn>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function Tour({ step, onNext, onDone }: { step: number; onNext: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const steps = ['tour.s1', 'tour.s2', 'tour.s3', 'tour.s4', 'tour.s5'];
  if (step >= steps.length) {
    queueMicrotask(onDone);
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-6" data-testid="tour">
      <div className="max-w-sm rounded-2xl bg-slate-900 p-5 text-white shadow-2xl">
        <div className="mb-1 text-xs font-bold text-sky-300">
          {t('tour.title')} · {step + 1}/{steps.length}
        </div>
        <p className="text-base leading-relaxed">{t(steps[step])}</p>
        <div className="mt-4 flex justify-between">
          <Btn variant="ghost" onClick={onDone}>
            {t('tour.skip')}
          </Btn>
          <Btn variant="primary" onClick={step === steps.length - 1 ? onDone : onNext}>
            {step === steps.length - 1 ? t('tour.done') : t('tour.next')}
          </Btn>
        </div>
      </div>
    </div>
  );
}
