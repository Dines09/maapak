import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Ruler as RulerIcon, Box, Smartphone, Check, Trash2, AlertTriangle } from 'lucide-react';
import {
  ID1_CARD,
  VERIFY_RESIDUAL_LIMIT_MM,
  axisScale,
  cardCalibration,
  combineAxes,
  confidenceFor,
  deviceKeyString,
  edgesToCurrent,
  isAxisSwapped,
  makeDeviceKey,
  makeTransform,
  usableRect,
  DEFAULT_ALIGNMENT_ERROR_PX,
  type AxisResult,
  type CalibrationMethod,
  type CalibrationProfile,
} from '../../core/calibration';
import type { ScreenProtector } from '../../core/uncertainty';
import { formatNumber } from '../../core/units';
import { Stage } from '../../render/Stage';
import type { RenderContext } from '../../render/types';
import { CalLinesTool, calLines } from '../../tools/calLines/CalLinesTool';
import { newId } from '../../tools/base';
import { resolveScale, useCalibration } from '../../state/calibration';
import { useEnv } from '../../state/env';
import { useSettings } from '../../state/settings';
import { kvGet, kvSet } from '../../db';
import { navigate, useRoute } from '../../app/router';
import { Btn, Field, ScreenHeader, Segmented, inputCls, cx, useToast } from '../../app/components/ui';

type Step = 'choose' | 'card' | 'rulerY' | 'rulerX' | 'custom' | 'result' | 'verify';

interface MyRef {
  name: string;
  mm: number;
}

interface Pending {
  method: CalibrationMethod;
  axes: AxisResult;
  baselineMm: { x: number; y: number };
  referenceLabel: string;
  singleAxis: boolean;
}

export function CalibrateScreen() {
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
  const [step, setStep] = useState<Step>('choose');
  const [protector, setProtector] = useState<ScreenProtector>(scale.profile.screenProtector ?? 'none');
  const [name, setName] = useState('');
  const [realY, setRealY] = useState('100');
  const [realX, setRealX] = useState('50');
  const [customAxis, setCustomAxis] = useState<'y' | 'x'>('y');
  const [customName, setCustomName] = useState('');
  const [customMm, setCustomMm] = useState('');
  const [myRefs, setMyRefs] = useState<MyRef[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [rulerYScale, setRulerYScale] = useState<number | null>(null);
  const [verifyRef, setVerifyRef] = useState(String(ID1_CARD.longMm));
  const [live, setLive] = useState<{ a?: number; b?: number; mmA?: number; mmB?: number }>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const toolsRef = useRef<CalLinesTool[]>([]);
  const portrait = !isAxisSwapped(env.orientationAngle);
  const onStage =
    step === 'card' || step === 'rulerY' || step === 'rulerX' || step === 'custom' || step === 'verify';
  const profilesHere = cal.profiles.filter((p) => deviceKeyString(p.deviceKey) === envKey);

  useEffect(() => {
    void kvGet<MyRef[]>('myRefs').then((r) => setMyRefs(r ?? []));
  }, []);

  // Build the stage for each measuring step.
  useEffect(() => {
    if (!onStage || !canvasRef.current) return;
    const st = new Stage(canvasRef.current);
    stageRef.current = st;
    const provisional =
      step === 'verify' && pending
        ? { pxPerMmX: pending.axes.pxPerMmX, pxPerMmY: pending.axes.pxPerMmY }
        : scale.profile;
    st.setTransform(makeTransform(provisional, env.orientationAngle, env.dpr));
    const edges = cal.edges[envKey];
    if (edges) {
      const cur = edgesToCurrent(edges, env.orientationAngle);
      st.setUsable(usableRect(cur, vp.w, vp.h), cur);
    }
    st.setSettings({
      background: { color: '#ffffff', pattern: 'none' },
      loupe: settings.loupe,
      loupeZoom: Math.max(4, settings.loupeZoom),
      largeHandles: settings.largeHandles,
      haptics: settings.haptics,
      snapTicks: false,
      snapHandles: false,
    });
    st.setCallbacks({
      onReadouts: () => {
        const [a, b] = toolsRef.current;
        if (step === 'card' && a && b) {
          // Keep the right line's knob just below the moving bottom line.
          a.s.knob2 = b.s.p2 + 10;
          a.s.span = [a.s.span[0], b.s.p2 + 12];
        }
        setLive({ a: a?.devicePx(), b: b?.devicePx(), mmA: a?.mm(), mmB: b?.mm() });
      },
    });
    let cancelled = false;
    void st.ready.then(() => {
      if (cancelled) return;
      const bnd = st.boundsMm();
      const panelH = panelRef.current?.getBoundingClientRect().height ?? 220;
      const bottomLimit = bnd.y + bnd.h - panelH * st.mmPerCssPx() - 4;
      const x0 = bnd.x + 2;
      const y0 = bnd.y + 4;
      const list: CalLinesTool[] = [];
      if (step === 'card') {
        const x1 = x0 + ID1_CARD.shortMm;
        const y1 = y0 + ID1_CARD.longMm;
        list.push(
          new CalLinesTool(
            calLines({ axis: 'x', p1: x0, p2: x1, fixed1: true, span: [y0 - 2, y1 + 12], knob2: y1 + 10 }),
          ),
        );
        const knobX = x1 + 5 < bnd.x + bnd.w - 2 ? x1 + 5 : x0 + 12;
        list.push(
          new CalLinesTool(
            calLines({
              axis: 'y',
              p1: y0,
              p2: y1,
              fixed1: true,
              span: [x0 - 2, Math.min(bnd.x + bnd.w, x1 + 9)],
              knob2: knobX,
            }),
          ),
        );
      } else if (step === 'rulerY' || (step === 'custom' && customAxis === 'y') || step === 'verify') {
        const len = Math.min(
          step === 'verify' ? Number(verifyRef) || ID1_CARD.longMm : 100,
          bottomLimit - y0 - 12,
        );
        const knob = bnd.x + bnd.w - 9;
        list.push(
          new CalLinesTool(
            calLines({
              axis: 'y',
              p1: y0 + (step === 'verify' ? 0 : 8),
              p2: y0 + (step === 'verify' ? 0 : 8) + len,
              fixed1: step === 'verify',
              span: [bnd.x + 1, bnd.x + bnd.w - 1],
              knob1: knob,
              knob2: knob,
            }),
          ),
        );
      } else {
        const len = Math.min(50, bnd.w - 12);
        const knob = Math.min(bottomLimit - 8, y0 + 70);
        list.push(
          new CalLinesTool(
            calLines({
              axis: 'x',
              p1: x0 + 4,
              p2: x0 + 4 + len,
              span: [y0, knob + 6],
              knob1: knob,
              knob2: knob,
            }),
          ),
        );
      }
      for (const tl of list) st.addTool(tl, false);
      toolsRef.current = list;
      st.overlay = step === 'card' ? (rc) => drawCardGuide(rc, list[0], list[1]) : null;
      st.invalidate(true);
    });
    return () => {
      cancelled = true;
      st.destroy();
      stageRef.current = null;
      toolsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, onStage]);

  const finish = async (p: CalibrationProfile) => {
    await cal.saveProfile(p);
    toast(t('cal.saved'));
    if (onboarding) {
      settings.set({ onboarded: true });
      navigate('/', true);
    } else navigate('/', true);
  };

  const buildProfile = (residual?: number): CalibrationProfile | null => {
    if (!pending) return null;
    return {
      id: newId('cal'),
      name:
        name.trim() ||
        (protector === 'none'
          ? t('cal.defaultName')
          : `${t('cal.defaultName')} (${t(`protector.${protector}`)})`),
      deviceKey: makeDeviceKey(env),
      pxPerMmX: pending.axes.pxPerMmX,
      pxPerMmY: pending.axes.pxPerMmY,
      method: pending.method,
      referenceLabel: pending.referenceLabel,
      baselineMm: pending.baselineMm,
      alignmentErrorPx: DEFAULT_ALIGNMENT_ERROR_PX,
      verifyResidualMm: residual,
      screenProtector: protector,
      confidence: confidenceFor(pending.method, residual),
      createdAt: Date.now(),
    };
  };

  const back = () => {
    if (step === 'choose') {
      if (onboarding) settings.set({ onboarded: true });
      navigate('/', true);
    } else if (step === 'rulerX') setStep('rulerY');
    else if (step === 'verify') setStep('result');
    else setStep('choose');
  };

  // ---------- step actions ----------
  const calcCard = () => {
    const [x, y] = toolsRef.current;
    const axes = cardCalibration(x.devicePx(), y.devicePx());
    setPending({
      method: 'card',
      axes,
      baselineMm: { x: ID1_CARD.shortMm, y: ID1_CARD.longMm },
      referenceLabel: 'ID-1 card 85.60 × 53.98 mm',
      singleAxis: false,
    });
    setVerifyRef(String(ID1_CARD.longMm));
    setStep('result');
  };

  const calcRulerY = () => {
    const mm = Number(realY.replace(',', '.'));
    if (!(mm > 0)) return toast(t('cal.enterDistance'));
    setRulerYScale(axisScale(toolsRef.current[0].devicePx(), mm));
    setStep('rulerX');
  };

  const calcRulerX = (skip: boolean) => {
    const yMm = Number(realY.replace(',', '.'));
    if (rulerYScale === null) return;
    let axes: AxisResult;
    let xMm = yMm;
    if (skip) {
      axes = { pxPerMmX: rulerYScale, pxPerMmY: rulerYScale, disagreement: 0, averaged: true, warn: false };
    } else {
      xMm = Number(realX.replace(',', '.'));
      if (!(xMm > 0)) return toast(t('cal.enterDistance'));
      axes = combineAxes(axisScale(toolsRef.current[0].devicePx(), xMm), rulerYScale);
    }
    setPending({
      method: 'ruler',
      axes,
      baselineMm: { x: xMm, y: yMm },
      referenceLabel: `Steel rule ${yMm} / ${xMm} mm`,
      singleAxis: skip,
    });
    setVerifyRef(String(ID1_CARD.longMm));
    setStep('result');
  };

  const calcCustom = async () => {
    const mm = Number(customMm.replace(',', '.'));
    if (!(mm > 0)) return toast(t('cal.enterSize'));
    const s = axisScale(toolsRef.current[0].devicePx(), mm);
    const label = customName.trim() || t('cal.customObject');
    if (customName.trim()) {
      const refs = [...myRefs.filter((r) => r.name !== label), { name: label, mm }];
      setMyRefs(refs);
      await kvSet('myRefs', refs);
    }
    setPending({
      method: 'custom',
      axes: { pxPerMmX: s, pxPerMmY: s, disagreement: 0, averaged: true, warn: false },
      baselineMm: { x: mm, y: mm },
      referenceLabel: `${label} ${mm} mm`,
      singleAxis: true,
    });
    setVerifyRef(String(mm));
    setStep('result');
  };

  // ---------- render ----------
  if (!portrait && step !== 'choose' && step !== 'result') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center text-white">
        <Smartphone size={48} />
        <p>{t('cal.portraitOnly')}</p>
        <Btn onClick={back}>{t('common.back')}</Btn>
      </div>
    );
  }

  if (onStage) {
    const usableMm = live;
    return (
      <div className="fixed inset-0 bg-white">
        <canvas ref={canvasRef} className="stage absolute inset-0 h-full w-full" data-testid="cal-stage" />
        <div
          ref={panelRef}
          className="chrome absolute inset-x-0 bottom-0 z-20 rounded-t-2xl bg-slate-950/92 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white"
          data-testid="cal-panel"
        >
          <p className="mb-2 text-sm leading-snug">
            {step === 'card' && t('cal.cardInstr')}
            {step === 'rulerY' && t('cal.rulerYInstr')}
            {step === 'rulerX' && t('cal.rulerXInstr')}
            {step === 'custom' && t('cal.customInstr')}
            {step === 'verify' && t('cal.verifyInstr')}
          </p>
          <div className="tabular mb-2 text-xs text-slate-300">
            {step === 'card' && usableMm.a !== undefined && (
              <>
                X {formatNumber(usableMm.a, 0)} px · Y {formatNumber(usableMm.b ?? 0, 0)} px
              </>
            )}
            {step !== 'card' && step !== 'verify' && usableMm.a !== undefined && (
              <>Δ {formatNumber(usableMm.a, 0)} device px</>
            )}
            {step === 'verify' && usableMm.mmA !== undefined && (
              <VerifyLine measured={usableMm.mmA} reference={Number(verifyRef) || 0} />
            )}
          </div>
          {step === 'rulerY' && (
            <Field label={t('cal.realDistance')}>
              <input
                className={inputCls}
                inputMode="decimal"
                value={realY}
                onChange={(e) => setRealY(e.target.value)}
              />
            </Field>
          )}
          {step === 'rulerX' && (
            <Field label={t('cal.realDistance')}>
              <input
                className={inputCls}
                inputMode="decimal"
                value={realX}
                onChange={(e) => setRealX(e.target.value)}
              />
            </Field>
          )}
          {step === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('cal.objectName')}>
                <input
                  className={inputCls}
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  list="myrefs"
                />
                <datalist id="myrefs">
                  {myRefs.map((r) => (
                    <option key={r.name} value={r.name} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('cal.knownSize')}>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={customMm}
                  onChange={(e) => setCustomMm(e.target.value)}
                />
              </Field>
            </div>
          )}
          {step === 'verify' && (
            <Field label={t('cal.verifyReference')}>
              <input
                className={inputCls}
                inputMode="decimal"
                value={verifyRef}
                onChange={(e) => setVerifyRef(e.target.value)}
              />
            </Field>
          )}
          <div className="mt-2 flex gap-2">
            <Btn variant="ghost" onClick={back}>
              {t('common.back')}
            </Btn>
            {step === 'card' && (
              <Btn variant="primary" className="flex-1" onClick={calcCard} data-testid="cal-calc">
                {t('cal.calculate')}
              </Btn>
            )}
            {step === 'rulerY' && (
              <Btn variant="primary" className="flex-1" onClick={calcRulerY}>
                {t('cal.nextAxis')}
              </Btn>
            )}
            {step === 'rulerX' && (
              <>
                <Btn className="flex-1" onClick={() => calcRulerX(true)}>
                  {t('cal.skipAxis')}
                </Btn>
                <Btn variant="primary" className="flex-1" onClick={() => calcRulerX(false)}>
                  {t('cal.calculate')}
                </Btn>
              </>
            )}
            {step === 'custom' && (
              <Btn variant="primary" className="flex-1" onClick={() => void calcCustom()}>
                {t('cal.calculate')}
              </Btn>
            )}
            {step === 'verify' && (
              <Btn
                variant="primary"
                className="flex-1"
                data-testid="cal-verify-save"
                onClick={() => {
                  const residual = (live.mmA ?? 0) - (Number(verifyRef) || 0);
                  const p = buildProfile(residual);
                  if (p) void finish(p);
                }}
              >
                {t('cal.saveVerified')}
              </Btn>
            )}
          </div>
        </div>
      </div>
    );
  }

  const usable = (() => {
    if (!pending) return null;
    const edges = cal.edges[envKey];
    const r = edges
      ? usableRect(edgesToCurrent(edges, env.orientationAngle), vp.w, vp.h)
      : { x: 0, y: 0, w: vp.w, h: vp.h };
    const tr = makeTransform(
      { pxPerMmX: pending.axes.pxPerMmX, pxPerMmY: pending.axes.pxPerMmY },
      env.orientationAngle,
      env.dpr,
    );
    const [w, h] = tr.cssPxToMm([r.w, r.h]);
    return { w, h };
  })();

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader title={t('cal.title')} onBack={back} />
      <main className="mx-auto max-w-lg px-3 pb-10">
        {step === 'choose' && (
          <>
            <p className="mb-3 text-sm text-slate-300">{t('cal.intro')}</p>
            <MethodCard
              icon={<CreditCard />}
              title={t('cal.card')}
              hint={t('cal.cardHint')}
              badge={t('cal.recommended')}
              onClick={() => setStep('card')}
              testId="cal-card"
            />
            <MethodCard
              icon={<RulerIcon />}
              title={t('cal.ruler')}
              hint={t('cal.rulerHint')}
              badge={t('cal.mostAccurate')}
              onClick={() => setStep('rulerY')}
            />
            <MethodCard
              icon={<Box />}
              title={t('cal.custom')}
              hint={t('cal.customHint')}
              onClick={() => setStep('custom')}
            />
            {step === 'choose' && (
              <div className="mt-2 rounded-xl bg-slate-800/60 p-3">
                <Segmented
                  label={t('cal.customAxis')}
                  size="sm"
                  value={customAxis}
                  onChange={setCustomAxis}
                  options={[
                    { value: 'y', label: t('cal.longAxis') },
                    { value: 'x', label: t('cal.shortAxis') },
                  ]}
                />
                <p className="mt-1 text-xs text-slate-400">{t('cal.customAxisHint')}</p>
              </div>
            )}
            <div className="mt-3 rounded-xl bg-slate-800/60 p-3 text-xs text-slate-400">
              <Smartphone size={16} className="mr-1 inline" />
              {t('cal.estimateInfo', { ppi: formatNumber(scale.profile.pxPerMmX * 25.4, 0) })}
            </div>
            <div className="mt-3 rounded-xl bg-slate-800/60 p-3 text-xs text-slate-400">
              {t('cal.coinNote')}
            </div>

            {profilesHere.length > 0 && (
              <section className="mt-5">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-sky-300">
                  {t('cal.profiles')}
                </h2>
                {profilesHere.map((p) => {
                  const isActive = scale.calibrated && scale.profile.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className={cx(
                        'mb-2 flex items-center gap-2 rounded-xl p-3',
                        isActive ? 'bg-emerald-900/40 ring-1 ring-emerald-500' : 'bg-slate-800',
                      )}
                    >
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-semibold">
                          {p.name} {isActive && <Check size={14} className="inline text-emerald-400" />}
                        </div>
                        <div className="tabular text-xs text-slate-400">
                          {t(`calMethod.${p.method}`)} · {t(`conf.${p.confidence}`)} ·{' '}
                          {formatNumber(p.pxPerMmX * 25.4, 0)}×{formatNumber(p.pxPerMmY * 25.4, 0)} ppi
                          {p.verifyResidualMm !== undefined &&
                            ` · Δ ${formatNumber(p.verifyResidualMm, 2)} mm`}
                        </div>
                      </div>
                      {!isActive && (
                        <Btn
                          className="min-h-9 px-3 text-xs"
                          onClick={() => void cal.setActive(envKey, p.id)}
                        >
                          {t('cal.use')}
                        </Btn>
                      )}
                      <button
                        aria-label={t('common.delete')}
                        className="p-2 text-rose-300"
                        onClick={() => void cal.removeProfile(p.id)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}

        {step === 'result' && pending && (
          <div data-testid="cal-result">
            <div className="rounded-2xl bg-slate-800 p-4">
              <div className="tabular grid grid-cols-2 gap-2 text-sm">
                <span className="text-slate-400">X (short)</span>
                <span>
                  {formatNumber(pending.axes.pxPerMmX, 3)} px/mm ·{' '}
                  {formatNumber(pending.axes.pxPerMmX * 25.4, 0)} ppi
                </span>
                <span className="text-slate-400">Y (long)</span>
                <span>
                  {formatNumber(pending.axes.pxPerMmY, 3)} px/mm ·{' '}
                  {formatNumber(pending.axes.pxPerMmY * 25.4, 0)} ppi
                </span>
                {!pending.singleAxis && (
                  <>
                    <span className="text-slate-400">{t('cal.agreement')}</span>
                    <span>
                      {formatNumber(pending.axes.disagreement * 100, 2)} %{' '}
                      {pending.axes.averaged ? `(${t('cal.averaged')})` : ''}
                    </span>
                  </>
                )}
                {usable && (
                  <>
                    <span className="text-slate-400">{t('cal.usableArea')}</span>
                    <span>
                      {formatNumber(usable.w, 1)} × {formatNumber(usable.h, 1)} mm
                    </span>
                  </>
                )}
              </div>
              {pending.axes.warn && (
                <p className="mt-3 flex gap-2 rounded-lg bg-amber-500/20 p-2 text-xs text-amber-200">
                  <AlertTriangle size={16} className="shrink-0" /> {t('cal.axisWarn')}
                </p>
              )}
              {pending.singleAxis && <p className="mt-3 text-xs text-slate-400">{t('cal.singleAxisNote')}</p>}
            </div>
            <Field label={t('cal.profileName')}>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('cal.defaultName')}
              />
            </Field>
            <Field label={t('cal.protector')}>
              <Segmented
                label={t('cal.protector')}
                value={protector}
                onChange={setProtector}
                options={[
                  { value: 'none', label: t('protector.none') },
                  { value: 'film', label: t('protector.film') },
                  { value: 'tempered', label: t('protector.tempered') },
                ]}
              />
            </Field>
            <div className="mt-4 flex flex-col gap-2">
              <Btn variant="primary" onClick={() => setStep('verify')} data-testid="cal-verify">
                {t('cal.verify')}
              </Btn>
              <Btn
                onClick={() => {
                  const p = buildProfile();
                  if (p) void finish(p);
                }}
                data-testid="cal-save"
              >
                {t('cal.saveWithoutVerify')}
              </Btn>
              <Btn variant="ghost" onClick={() => setStep('choose')}>
                {t('cal.redo')}
              </Btn>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function VerifyLine({ measured, reference }: { measured: number; reference: number }) {
  const { t } = useTranslation();
  const r = measured - reference;
  const bad = Math.abs(r) > VERIFY_RESIDUAL_LIMIT_MM;
  return (
    <span className={bad ? 'text-amber-300' : 'text-emerald-300'} data-testid="verify-line">
      {t('cal.measured')} {formatNumber(measured, 2)} mm · Δ {formatNumber(r, 2)} mm{' '}
      {bad ? `— ${t('cal.residualHigh')}` : '✓'}
    </span>
  );
}

function MethodCard({
  icon,
  title,
  hint,
  badge,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  badge?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-slate-800 p-4 text-left hover:bg-slate-700"
    >
      <span className="text-sky-300">{icon}</span>
      <span className="flex-1">
        <span className="flex items-center gap-2 font-semibold">
          {title}{' '}
          {badge && (
            <span className="rounded bg-sky-500/25 px-1.5 text-[10px] font-bold text-sky-200">{badge}</span>
          )}
        </span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </button>
  );
}

/** Card outline with fixed top-left corner marks (§5.2 A). */
function drawCardGuide(rc: RenderContext, x: CalLinesTool, y: CalLinesTool): void {
  const { ctx } = rc;
  const x0 = x.s.p1;
  const x1 = x.s.p2;
  const y0 = y.s.p1;
  const y1 = y.s.p2;
  const a = rc.mmToPx([x0, y0]);
  const b = rc.mmToPx([x1, y1]);
  const r = ID1_CARD.cornerRadiusMm * rc.pxPerMm;
  ctx.save();
  ctx.fillStyle = 'rgba(14,165,233,0.06)';
  ctx.strokeStyle = 'rgba(14,165,233,0.55)';
  ctx.setLineDash([5 * rc.dpr, 4 * rc.dpr]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(a[0], a[1], b[0] - a[0], b[1] - a[1], r);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3 * rc.dpr;
  const m = 8 * rc.pxPerMm;
  ctx.beginPath();
  ctx.moveTo(a[0] - 2 * rc.dpr, a[1] + m);
  ctx.lineTo(a[0] - 2 * rc.dpr, a[1] - 2 * rc.dpr);
  ctx.lineTo(a[0] + m, a[1] - 2 * rc.dpr);
  ctx.stroke();
  if (!rc.inLoupe) {
    ctx.fillStyle = '#0f172a';
    ctx.font = `600 ${Math.max(11 * rc.dpr, 2.6 * rc.pxPerMm)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('85.60 × 53.98', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.restore();
}
