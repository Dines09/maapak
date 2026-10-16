import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, CircleDot, RotateCcw } from 'lucide-react';
import { edgesToCurrent, edgesToNatural, makeTransform, type EdgeInsets } from '../../core/calibration';
import { formatNumber } from '../../core/units';
import { Stage } from '../../render/Stage';
import { resolveScale, useCalibration } from '../../state/calibration';
import { useEnv } from '../../state/env';
import { useSettings } from '../../state/settings';
import { navigate, useRoute } from '../../app/router';
import { Btn, useToast } from '../../app/components/ui';
import { EdgeTool, type EdgeState } from './EdgeTool';

/** env(safe-area-inset-*) in CSS px. */
function safeInsets(): { top: number; right: number; bottom: number; left: number } {
  const d = document.createElement('div');
  d.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const r = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  d.remove();
  return r;
}

export function EdgesScreen() {
  const { t } = useTranslation();
  const route = useRoute();
  const onboarding = route.query.get('onboarding') === '1';
  const toast = useToast((s) => s.show);
  const env = useEnv((s) => s.env);
  const envKey = useEnv((s) => s.key);
  const vp = useEnv((s) => s.viewport);
  const cal = useCalibration();
  const settings = useSettings();
  const scale = useMemo(() => resolveScale(env, cal), [env, cal]);
  const saved = cal.edges[envKey];
  const [unlocked, setUnlocked] = useState(!saved?.locked);
  const [area, setArea] = useState<[number, number] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const toolRef = useRef<EdgeTool | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const st = new Stage(canvasRef.current);
    stageRef.current = st;
    const tr = makeTransform(scale.profile, env.orientationAngle, env.dpr);
    st.setTransform(tr);
    st.showEdges = false;
    st.setSettings({
      background: { color: '#ffffff', pattern: 'grid' },
      loupe: settings.loupe,
      loupeZoom: Math.max(4, settings.loupeZoom),
      largeHandles: settings.largeHandles,
      haptics: settings.haptics,
    });
    st.setLocked(!unlocked);
    st.setCallbacks({
      onReadouts: () => {
        const s = toolRef.current?.s;
        if (s) setArea([s.W - s.left - s.right, s.H - s.top - s.bottom]);
      },
      onBlocked: () => toast(t('edges.lockedHint')),
    });
    let cancelled = false;
    void st.ready.then(() => {
      if (cancelled) return;
      const [W, H] = tr.cssPxToMm([vp.w, vp.h]);
      const mmPer = st.mmPerCssPx();
      let s: EdgeState;
      if (saved) {
        const cur = edgesToCurrent(saved, env.orientationAngle);
        s = {
          top: cur.top * mmPer,
          right: cur.right * mmPer,
          bottom: cur.bottom * mmPer,
          left: cur.left * mmPer,
          corner: cur.cornerRadius * mmPer,
          exclusions: cur.exclusions.map((z) => ({ cx: z.cx * mmPer, cy: z.cy * mmPer, r: z.r * mmPer })),
          W,
          H,
        };
      } else {
        const sa = safeInsets();
        s = {
          top: sa.top * mmPer + 2,
          right: sa.right * mmPer + 2,
          bottom: sa.bottom * mmPer + 2,
          left: sa.left * mmPer + 2,
          corner: 0,
          exclusions: [],
          W,
          H,
        };
      }
      const tool = new EdgeTool(s);
      toolRef.current = tool;
      st.addTool(tool, true);
    });
    return () => {
      cancelled = true;
      st.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.orientationAngle, vp.w, vp.h]);

  useEffect(() => {
    stageRef.current?.setLocked(!unlocked);
  }, [unlocked]);

  const lock = async () => {
    const tool = toolRef.current;
    const st = stageRef.current;
    if (!tool || !st) return;
    const cssPer = 1 / st.mmPerCssPx();
    const s = tool.s;
    const current: EdgeInsets = {
      top: s.top * cssPer,
      right: s.right * cssPer,
      bottom: s.bottom * cssPer,
      left: s.left * cssPer,
      cornerRadius: s.corner * cssPer,
      exclusions: s.exclusions.map((z) => ({ cx: z.cx * cssPer, cy: z.cy * cssPer, r: z.r * cssPer })),
      locked: true,
      refW: vp.w,
      refH: vp.h,
    };
    await cal.saveEdges(envKey, edgesToNatural(current, env.orientationAngle));
    setUnlocked(false);
    toast(t('edges.lockedToast'));
    navigate(onboarding ? '/calibrate?onboarding=1' : '/', true);
  };

  const addHole = () => {
    const tool = toolRef.current;
    if (!tool) return;
    tool.s.exclusions.push({ cx: tool.s.W / 2, cy: tool.s.top + 6, r: 3 });
    stageRef.current?.invalidate(true);
  };

  const reset = () => {
    const tool = toolRef.current;
    const st = stageRef.current;
    if (!tool || !st) return;
    const sa = safeInsets();
    const mmPer = st.mmPerCssPx();
    Object.assign(tool.s, {
      top: sa.top * mmPer + 2,
      right: sa.right * mmPer + 2,
      bottom: sa.bottom * mmPer + 2,
      left: sa.left * mmPer + 2,
      corner: 0,
      exclusions: [],
    });
    st.invalidate(true);
  };

  return (
    <div className="fixed inset-0 bg-white">
      <canvas ref={canvasRef} className="stage absolute inset-0 h-full w-full" data-testid="edges-stage" />
      <div
        className="chrome absolute left-1/2 top-1/2 z-20 w-[min(88vw,340px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-slate-950/90 p-3 text-white shadow-2xl"
        data-testid="edges-panel"
      >
        <h1 className="text-base font-bold">{t('edges.title')}</h1>
        <p className="mt-1 text-sm text-slate-300">{unlocked ? t('edges.instr') : t('edges.lockedInfo')}</p>
        {area && (
          <p className="tabular mt-1 text-xs text-slate-400">
            {t('edges.area')}: {formatNumber(area[0], 1)} × {formatNumber(area[1], 1)} mm{' '}
            {!scale.calibrated && `(${t('conf.estimate')})`}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {unlocked ? (
            <>
              <Btn onClick={addHole} className="min-h-10 px-3 text-xs">
                <CircleDot size={16} /> {t('edges.addHole')}
              </Btn>
              <Btn onClick={reset} className="min-h-10 px-3 text-xs">
                <RotateCcw size={16} /> {t('edges.reset')}
              </Btn>
              <Btn
                variant="primary"
                className="min-h-10 flex-1 px-3"
                onClick={() => void lock()}
                data-testid="edges-lock"
              >
                <Lock size={16} /> {t('edges.lock')}
              </Btn>
            </>
          ) : (
            <Btn className="min-h-10 flex-1" onClick={() => setUnlocked(true)} data-testid="edges-unlock">
              <Unlock size={16} /> {t('edges.unlock')}
            </Btn>
          )}
        </div>
        <div className="mt-2 flex justify-between">
          <Btn
            variant="ghost"
            className="min-h-10 px-2 text-xs"
            onClick={() => navigate(onboarding ? '/calibrate?onboarding=1' : '/', true)}
          >
            {onboarding ? t('common.skip') : t('common.back')}
          </Btn>
        </div>
      </div>
    </div>
  );
}
