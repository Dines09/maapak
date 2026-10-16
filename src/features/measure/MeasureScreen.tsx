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
  Crosshair,
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
} from 'lucide-react';
import type { ToolId, Vec } from '../../core/types';
import { edgesToCurrent, makeTransform, usableRect } from '../../core/calibration';
import { toMm, type LengthUnit } from '../../core/units';
import { Stage } from '../../render/Stage';
import type { Handle, ToolInstance } from '../../render/types';
import type { BackgroundSpec } from '../../render/background';
import { TOOL_REGISTRY, createTool, MAX_TOOLS } from '../../tools/registry';
import { useSettings } from '../../state/settings';
import { useEnv } from '../../state/env';
import { resolveScale, useCalibration } from '../../state/calibration';
import { useLive } from '../../state/live';
import { UndoStack, autosave, loadSession } from '../../state/session';
import { db, pushHistory, type HistoryEntry } from '../../db';
import type { ToolMeasurement } from '../../tools/base';
import { navigate } from '../../app/router';
import { ReadoutHud, fmtReadout, fmtU } from '../../app/components/ReadoutHud';
import { BackgroundPanel, nextPreset } from '../../app/components/BackgroundPanel';
import { SaveDialog } from '../../app/components/SaveDialog';
import { Btn, IconBtn, Segmented, Sheet, cx, inputCls, useToast } from '../../app/components/ui';
import { ToolIcon } from '../../app/components/ToolIcon';

const DOCK: { id: ToolId | 'free'; labelKey: string }[] = [
  { id: 'ruler', labelKey: 'tool.ruler' },
  { id: 'gapRuler', labelKey: 'tool.gapRuler' },
  { id: 'splitRuler', labelKey: 'tool.splitRuler' },
  { id: 'leapfrog', labelKey: 'tool.leapfrog' },
  { id: 'free', labelKey: 'tool.free' },
];

/** Later-phase tools shown in "More" so the roadmap is visible. */
const LATER: { id: string; phase: number }[] = [
  { id: 'caliper', phase: 2 },
  { id: 'protractor', phase: 2 },
  { id: 'circle', phase: 2 },
  { id: 'hex', phase: 2 },
  { id: 'rect', phase: 2 },
  { id: 'polygon', phase: 2 },
  { id: 'gasket', phase: 4 },
  { id: 'threadGauge', phase: 4 },
  { id: 'radiusGauge', phase: 4 },
  { id: 'wireGauge', phase: 4 },
  { id: 'grid', phase: 4 },
  { id: 'datumXY', phase: 4 },
  { id: 'level', phase: 4 },
  { id: 'photoMeasure', phase: 5 },
];

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [menu, setMenu] = useState<{ tool: ToolInstance; handle: Handle; pos: Vec } | null>(null);
  const [exact, setExact] = useState<{ tool: ToolInstance; handle: Handle } | null>(null);
  const [tour, setTour] = useState<number | null>(null);

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
    const el = document.documentElement;
    void el
      .requestFullscreen?.({ navigationUI: 'hide' })
      .then(() =>
        (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> })?.lock?.('portrait'),
      )
      .catch(() => {});
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

  useLayoutEffect(() => {
    stageRef.current?.setPlacementInsets(
      focus
        ? 0
        : Math.max(
            topRef.current?.getBoundingClientRect().bottom ?? 0,
            document.querySelector('[data-banner]')?.getBoundingClientRect().bottom ?? 0,
          ) + 8,
      focus
        ? 0
        : window.innerHeight -
            Math.min(
              bottomRef.current?.getBoundingClientRect().top ?? window.innerHeight,
              // Keep new tools clear of the readout panel too (it can be dragged elsewhere later).
              (() => {
                const top = document.querySelector('.hud')?.getBoundingClientRect().top ?? Infinity;
                return top > window.innerHeight * 0.35 ? top : Infinity;
              })(),
            ) +
            8,
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

  // Keyboard: arrows nudge, Ctrl+Z / Ctrl+Y (§7.2).
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
        for (let i = 0; i < reps; i++) st.nudge(...map[e.key]);
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

  // First-run tour.
  useEffect(() => {
    if (settings.loaded && settings.onboarded && !settings.tourDone && tour === null) setTour(0);
  }, [settings.loaded, settings.onboarded, settings.tourDone, tour]);

  // ---------- actions ----------
  const pickTool = (id: ToolId | 'free') => {
    const st = stageRef.current;
    if (!st) return;
    if (id === 'free') {
      // Mode E: several classic rulers that snap parallel / perpendicular to each other.
      if (st.tools.some((x) => x.tool !== 'ruler')) st.clearTools();
      if (st.tools.length >= MAX_TOOLS) {
        toast(t('dock.maxTools', { n: MAX_TOOLS }));
        return;
      }
      const r = createTool('ruler', st.tools);
      if (r) st.addTool(r);
    } else {
      st.clearTools();
      const tool = createTool(id, []);
      if (tool) st.addTool(tool);
    }
    commit(st.selected());
    setSel(st.selected());
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

  const openSave = (ms?: ToolMeasurement[]) => {
    const list = ms ?? stageRef.current?.tools.flatMap((x) => (x === sel ? x.toMeasurements() : [])) ?? [];
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

  const st = stageRef.current;
  const toolActions = sel?.actions?.() ?? [];
  const calChip = scale.calibrated ? t(`conf.${scale.profile.confidence}`) : t('conf.estimate');

  const units: { value: LengthUnit; label: string }[] = [
    { value: 'mm', label: 'mm' },
    { value: 'cm', label: 'cm' },
    { value: 'in', label: 'in' },
    { value: 'in-frac', label: '⅛″' },
  ];

  return (
    <div className={cx('fixed inset-0 overflow-hidden bg-black', settings.leftHanded && 'left-handed')}>
      <canvas ref={canvasRef} className="stage absolute inset-0 h-full w-full" data-testid="stage" />

      {!focus && (
        <div
          ref={topRef}
          className="chrome absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-2 pt-[max(0.4rem,env(safe-area-inset-top))]"
        >
          <Segmented
            size="sm"
            label={t('settings.unit')}
            value={settings.unit}
            onChange={(u) => settings.set({ unit: u })}
            options={units}
          />
          <button
            onClick={() => navigate('/calibrate')}
            data-testid="cal-chip"
            className={cx(
              'ml-1 flex min-h-9 items-center gap-1.5 truncate rounded-full px-2.5 text-xs font-bold',
              scale.calibrated ? 'bg-emerald-600/85 text-white' : 'bg-amber-500/90 text-slate-950',
            )}
          >
            <span
              className={cx('h-2 w-2 rounded-full', scale.calibrated ? 'bg-emerald-200' : 'bg-slate-900')}
            />
            {calChip}
          </button>
          <span className="flex-1" />
          <IconBtn label={t('nav.records')} onClick={() => navigate('/records')}>
            <FolderOpen size={20} />
          </IconBtn>
          <IconBtn label={t('nav.settings')} onClick={() => navigate('/settings')}>
            <SettingsIcon size={20} />
          </IconBtn>
        </div>
      )}

      <Banners
        scale={scale}
        onCal={() => navigate('/calibrate')}
        onEstimate={() => cal.setGuardOverride(true)}
        top={focus ? 8 : 56}
      />

      <ReadoutHudLive
        unit={settings.unit}
        den={settings.fractionDen}
        secondary={settings.secondaryUnits}
        showRaw={settings.showRaw}
        calibrated={scale.calibrated}
        onAdd={() => openSave()}
      />

      {focus ? (
        <button
          onClick={() => setFocus(false)}
          className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 rounded-full bg-slate-900/70 p-2.5 text-white"
          aria-label={t('action.exitFocus')}
        >
          <Minimize2 size={18} />
        </button>
      ) : (
        <div
          ref={bottomRef}
          className="chrome absolute inset-x-0 bottom-0 z-20 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
        >
          {sel && (
            <div className="flex items-center gap-1 overflow-x-auto px-2 pb-1 [scrollbar-width:none]">
              <span className="mr-1 shrink-0 rounded-md bg-white/10 px-2 py-1 text-xs font-bold text-slate-200">
                {t(`tool.${sel.tool}`)}
              </span>
              {toolActions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => runAction(a.run)}
                  className={cx(
                    'shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold',
                    a.active ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-100',
                  )}
                >
                  {t(a.labelKey)}
                </button>
              ))}
              <button
                onClick={() => setNudgeOpen((v) => !v)}
                aria-pressed={nudgeOpen}
                className={cx(
                  'flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold',
                  nudgeOpen ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-100',
                )}
              >
                <Move size={14} /> {t('action.nudge')}
              </button>
              <button
                onClick={() => setPrecision((v) => !v)}
                aria-pressed={precision}
                className={cx(
                  'shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold',
                  precision ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-slate-100',
                )}
              >
                ×0.1
              </button>
              <button
                onClick={removeSel}
                aria-label={t('action.remove')}
                className="shrink-0 rounded-lg bg-white/10 p-1.5 text-rose-300"
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
          {nudgeOpen && st && <NudgePad stage={st} onCommit={() => commit(st.selected())} />}
          <div className="flex items-center justify-between px-1">
            <IconBtn
              label={locked ? t('action.unlock') : t('action.lock')}
              active={locked}
              onClick={() => setLocked((v) => !v)}
            >
              {locked ? <Lock size={20} /> : <Unlock size={20} />}
            </IconBtn>
            <IconBtn
              label={t('action.contrastCycle')}
              onClick={() => applyBg(nextPreset(settings.background), sel)}
            >
              <Contrast size={20} />
            </IconBtn>
            <IconBtn label={t('bg.title')} onClick={() => setBgOpen(true)}>
              <Palette size={20} />
            </IconBtn>
            <IconBtn label={t('action.focus')} onClick={() => setFocus(true)}>
              <Focus size={20} />
            </IconBtn>
            <IconBtn label={t('action.undo')} disabled={!undo.current.canUndo} onClick={doUndo}>
              <Undo2 size={20} />
            </IconBtn>
            <IconBtn label={t('action.redo')} disabled={!undo.current.canRedo} onClick={doRedo}>
              <Redo2 size={20} />
            </IconBtn>
            <Btn
              variant="primary"
              className="min-h-10 px-3"
              onClick={() => openSave()}
              data-testid="save-btn"
            >
              <Save size={18} /> {t('common.save')}
            </Btn>
          </div>
          <nav className="flex items-stretch justify-between gap-0.5 px-1 pt-1" aria-label={t('dock.label')}>
            {DOCK.map((d) => {
              const active =
                d.id === 'free' ? (st?.tools.length ?? 0) > 1 : st?.tools.length === 1 && sel?.tool === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => pickTool(d.id)}
                  data-testid={`dock-${d.id}`}
                  className={cx(
                    'flex min-h-12 flex-1 flex-col items-center justify-center rounded-xl text-[10px] font-semibold',
                    active ? 'bg-sky-500/90 text-white' : 'text-slate-200 hover:bg-white/10',
                  )}
                >
                  <ToolIcon id={d.id} />
                  <span className="mt-0.5 leading-none">{t(d.labelKey)}</span>
                </button>
              );
            })}
            <button
              onClick={() => {
                const v = !pinned;
                setPinned(v);
                st?.pinLoupe(v);
              }}
              aria-pressed={pinned}
              className={cx(
                'flex min-h-12 flex-1 flex-col items-center justify-center rounded-xl text-[10px] font-semibold',
                pinned ? 'bg-sky-500/90 text-white' : 'text-slate-200 hover:bg-white/10',
              )}
            >
              <Search size={20} />
              <span className="mt-0.5 leading-none">{t('dock.loupe')}</span>
            </button>
            <button
              onClick={() => setMoreOpen(true)}
              className="flex min-h-12 flex-1 flex-col items-center justify-center rounded-xl text-[10px] font-semibold text-slate-200 hover:bg-white/10"
            >
              <MoreHorizontal size={20} />
              <span className="mt-0.5 leading-none">{t('dock.more')}</span>
            </button>
          </nav>
        </div>
      )}

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
        <div className="grid grid-cols-2 gap-2">
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

      {locked && !focus && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-amber-200">
          <Lock size={12} className="mr-1 inline" /> {t('banner.locked')}
        </div>
      )}
      {precision && (
        <div className="pointer-events-none absolute left-2 top-24 z-20 rounded-full bg-amber-400/90 px-2 py-0.5 text-xs font-bold text-slate-950">
          <Crosshair size={12} className="mr-1 inline" /> {t('banner.precision')}
        </div>
      )}
    </div>
  );
}

function ReadoutHudLive(p: Omit<Parameters<typeof ReadoutHud>[0], 'readouts' | 'toolKey' | 'avoid'>) {
  const readouts = useLive((s) => s.readouts);
  const toolKey = useLive((s) => s.toolKey);
  const avoid = useLive((s) => s.avoid);
  return <ReadoutHud {...p} readouts={readouts} toolKey={toolKey} avoid={avoid} />;
}

function Banners({
  scale,
  onCal,
  onEstimate,
  top,
}: {
  scale: ReturnType<typeof resolveScale>;
  onCal: () => void;
  onEstimate: () => void;
  top: number;
}) {
  const { t } = useTranslation();
  let body: React.ReactNode = null;
  if (!scale.guard.ok) {
    const zoom = scale.guard.reasons.includes('zoom');
    body = (
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
    );
  } else if (!scale.calibrated) {
    body = (
      <button
        onClick={onCal}
        data-testid="banner-estimate"
        className="w-full rounded-xl bg-amber-400/95 px-3 py-1.5 text-left text-xs font-bold text-slate-950 shadow"
      >
        {t('banner.notCalibrated')} <span className="underline">{t('banner.calibrateNow')}</span>
      </button>
    );
  }
  if (!body) return null;
  return (
    <div data-banner className="absolute inset-x-2 z-20 mx-auto max-w-md" style={{ top }}>
      {body}
    </div>
  );
}

function NudgePad({ stage, onCommit }: { stage: Stage; onCommit: () => void }) {
  const { t } = useTranslation();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const start = (fn: () => void) => {
    fn();
    const delay = setTimeout(() => {
      timer.current = setInterval(fn, 60);
    }, 380);
    timer.current = delay as unknown as ReturnType<typeof setInterval>;
  };
  const stop = () => {
    if (timer.current) {
      clearInterval(timer.current);
      clearTimeout(timer.current as unknown as ReturnType<typeof setTimeout>);
    }
    timer.current = null;
    onCommit();
  };
  const b = (label: string, icon: React.ReactNode, fn: () => void) => (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        start(fn);
      }}
      onPointerUp={stop}
      onPointerLeave={() => timer.current && stop()}
      onPointerCancel={stop}
      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/12 text-white active:bg-sky-500"
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center justify-center gap-1.5 pb-1" data-testid="nudge-pad">
      {b(t('nudge.rotL'), <RotateCcw size={18} />, () => stage.rotateSelected(-0.5))}
      {b(t('nudge.left'), <ChevronLeft size={20} />, () => stage.nudge(-1, 0))}
      {b(t('nudge.up'), <ChevronUp size={20} />, () => stage.nudge(0, -1))}
      {b(t('nudge.down'), <ChevronDown size={20} />, () => stage.nudge(0, 1))}
      {b(t('nudge.right'), <ChevronRight size={20} />, () => stage.nudge(1, 0))}
      {b(t('nudge.rotR'), <RotateCw size={18} />, () => stage.rotateSelected(0.5))}
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
                  {r.unit !== 'area' ? fmtU(r.uncertainty, unit) : ''}
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
