import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Volume2, Plus, GripHorizontal, X } from 'lucide-react';
import type { Vec } from '../../core/types';
import {
  formatFraction,
  formatNumber,
  fromMm,
  toFraction,
  type FractionDenominator,
  type LengthUnit,
} from '../../core/units';
import { decimalsFor, repeatStats } from '../../core/uncertainty';
import { evaluateTolerance } from '../../core/tolerance';
import type { Readout } from '../../render/types';
import { fmtAngle, fmtArea, fmtLength, unitLabel } from '../../render/format';
import { extraKey, useExtras } from '../../state/extras';
import { cx, useToast } from './ui';

export interface HudProps {
  readouts: Readout[];
  toolKey: string | null;
  unit: LengthUnit;
  den: FractionDenominator;
  secondary: boolean;
  showRaw: boolean;
  avoid: Vec | null;
  calibrated: boolean;
  /** Relative calibration uncertainty, for repeat & average. */
  relCal: number;
  onAdd(): void;
  onTolerance(key: string, r: Readout): void;
}

const isLength = (r: Readout) => r.unit === 'length' || !r.unit;

export function fmtReadout(r: Readout, unit: LengthUnit, den: FractionDenominator, raw = false): string {
  if (r.unit === 'count') return String(Math.round(r.value));
  if (r.unit === 'area') return `${fmtArea(r.value, r.uncertainty, unit, raw)} ${unitLabel(unit)}²`;
  if (r.unit === 'angle') return fmtAngle(r.value, r.uncertainty);
  const v = fmtLength(r.value, r.uncertainty, unit, den, raw);
  return unit === 'in-frac' ? v : `${v} ${unitLabel(unit)}`;
}

export function fmtU(Umm: number, unit: LengthUnit): string {
  const u = unit === 'in-frac' ? 'in' : unit;
  return `±${formatNumber(fromMm(Umm, u), decimalsFor(Umm, u))} ${unitLabel(u)}`;
}

/** "±0.3 mm", "±0.4°", "±2 mm²". */
export function fmtUFor(r: Readout, unit: LengthUnit): string {
  if (r.unit === 'angle') {
    const d = r.uncertainty > 0 ? Math.min(1, Math.max(0, -Math.floor(Math.log10(r.uncertainty)))) : 1;
    return `±${r.uncertainty.toFixed(d)}°`;
  }
  if (r.unit === 'area') return `±${fmtArea(r.uncertainty, r.uncertainty, unit)} ${unitLabel(unit)}²`;
  if (r.unit === 'count') return '';
  return fmtU(r.uncertainty, unit);
}

const TOL_STYLE = {
  pass: 'border-emerald-400 bg-emerald-500/15',
  warn: 'border-amber-400 bg-amber-500/15',
  fail: 'border-rose-500 bg-rose-600/20',
} as const;

export function ReadoutHud(p: HudProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast((s) => s.show);
  const extras = useExtras();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Vec | null>(null);
  const [place, setPlace] = useState<'user' | 'top' | 'bottom'>('user');
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<Readout[] | null>(null);
  const [mm, setMm] = useState<{ min: number; max: number } | null>(null);
  const [mmOn, setMmOn] = useState(false);
  const [guess, setGuess] = useState('');
  const [verdict, setVerdict] = useState<'right' | 'wrong' | 'shown' | null>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const shown = held ?? p.readouts;
  const primary = shown.find((r) => r.primary) ?? shown[0];
  const key = primary ? extraKey(p.toolKey, primary.label) : '';
  const off = offsets[key] ?? 0;
  const inc = key in offsets;
  const value = primary ? primary.value - off : 0;
  const extra = extras.map[key];

  useEffect(() => {
    if (!mmOn || !primary || held) return;
    setMm((m) => (m ? { min: Math.min(m.min, value), max: Math.max(m.max, value) } : { min: value, max: value }));
  }, [mmOn, value, primary, held]);

  useEffect(() => {
    setHeld(null);
    setMm(null);
    setVerdict(null);
    setGuess('');
  }, [p.toolKey]);

  // A new jaw position needs a new answer in Learn mode.
  const learnReading = primary?.learn?.reading;
  useEffect(() => {
    setVerdict(null);
  }, [learnReading]);

  useLayoutEffect(() => {
    if (pos || !ref.current) return;
    const w = ref.current.offsetWidth;
    setPos([Math.max(8, (window.innerWidth - w) / 2), Math.max(80, window.innerHeight - 330)]);
  }, [pos, primary]);

  useEffect(() => {
    if (!p.avoid || !ref.current || !pos) return;
    const r = ref.current.getBoundingClientRect();
    const m = 40;
    const inside = p.avoid[0] > r.left - m && p.avoid[0] < r.right + m && p.avoid[1] > r.top - m && p.avoid[1] < r.bottom + m;
    if (inside) setPlace(p.avoid[1] > window.innerHeight / 2 ? 'top' : 'bottom');
  }, [p.avoid, pos]);

  const style = useMemo(() => {
    if (!pos) return { left: 8, top: -999 };
    if (place === 'user') return { left: pos[0], top: pos[1] };
    const h = ref.current?.offsetHeight ?? 120;
    return { left: pos[0], top: place === 'top' ? 64 : Math.max(64, window.innerHeight - h - 190) };
  }, [pos, place]);

  if (!primary) return null;

  const isLen = isLength(primary);
  const learn = primary.learn;
  const valueText = isLen ? fmtLength(value, primary.uncertainty, p.unit, p.den) : fmtReadout({ ...primary, value }, p.unit, p.den);

  const secondaries: string[] = [];
  if (isLen && p.secondary && !learn) {
    for (const u of ['mm', 'cm', 'in'] as const) {
      if (u === p.unit) continue;
      secondaries.push(`${fmtLength(value, primary.uncertainty, u, p.den)} ${u}`);
    }
    if (p.unit !== 'in-frac') {
      const f = toFraction(value, p.den);
      secondaries.push(`${formatFraction(f)} (${f.errorMm >= 0.005 ? `Δ${formatNumber(f.errorMm, 2)} mm` : 'exact'})`);
    }
  }

  const tolResult = extra?.tol ? evaluateTolerance(primary.value, primary.uncertainty, extra.tol) : null;
  const rep = extra?.repeats?.length
    ? repeatStats(extra.repeats, primary.uncertainty, primary.unit === 'angle' ? 0 : p.relCal)
    : null;
  const fmtVal = (v: number, U = primary.uncertainty) =>
    isLen ? `${fmtLength(v, U, p.unit, p.den)}${p.unit === 'in-frac' ? '' : ` ${unitLabel(p.unit)}`}` : fmtReadout({ ...primary, value: v, uncertainty: U }, p.unit, p.den);

  const copyText = `${primary.label} ${fmtVal(value)} ${fmtUFor(primary, p.unit)}`;

  const speak = () => {
    try {
      const unitName = isLen ? t(`unitName.${p.unit === 'in-frac' ? 'in' : p.unit}`) : primary.unit === 'angle' ? t('unitName.deg') : '';
      const num = valueText.replace('″', '').replace('°', '');
      const u = new SpeechSynthesisUtterance(`${num} ${unitName}`);
      u.lang = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      toast(t('hud.speakUnsupported'));
    }
  };

  const checkLearn = () => {
    if (!learn) return;
    const n = Number(guess.replace(',', '.'));
    if (!Number.isFinite(n)) return;
    setVerdict(Math.abs(n - learn.reading) <= learn.leastCount / 2 + 1e-9 ? 'right' : 'wrong');
  };

  const onGripDown = (e: React.PointerEvent) => {
    if (!pos) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = ref.current!.getBoundingClientRect();
    dragRef.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId || !ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    setPlace('user');
    setPos([Math.min(window.innerWidth - w - 4, Math.max(4, e.clientX - d.dx)), Math.min(window.innerHeight - h - 4, Math.max(4, e.clientY - d.dy))]);
  };
  const onGripUp = () => (dragRef.current = null);

  const others = shown.filter((r) => r !== primary);
  const lu = learn?.unit ?? 'mm';

  return (
    <div
      ref={ref}
      data-testid="hud"
      data-tol={tolResult ?? undefined}
      style={style}
      className={cx(
        'hud fixed z-30 w-[min(92vw,360px)] select-none rounded-2xl border-2 p-2.5 text-white shadow-2xl backdrop-blur-sm',
        tolResult ? TOL_STYLE[tolResult] : 'border-white/10',
        'bg-slate-950/88',
      )}
    >
      <div
        className="-mx-1 -mt-1 mb-1 flex cursor-grab touch-none items-center justify-between rounded-lg px-1 py-0.5 text-[11px] text-slate-400 active:cursor-grabbing"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
      >
        <span className="flex items-center gap-1.5">
          <span className="rounded-md bg-sky-500/25 px-1.5 py-0.5 font-bold text-sky-200">{primary.label}</span>
          {primary.nameKey && <span>{t(primary.nameKey)}</span>}
          {inc && <span className="rounded bg-amber-500/30 px-1 font-bold text-amber-200">INC</span>}
          {held && <span className="rounded bg-rose-500/30 px-1 font-bold text-rose-200">HOLD</span>}
          {tolResult && (
            <span data-testid="hud-tol" className={cx('rounded px-1 font-bold', tolResult === 'pass' ? 'bg-emerald-500 text-white' : tolResult === 'warn' ? 'bg-amber-400 text-slate-950' : 'bg-rose-600 text-white')}>
              {t(`tol.${tolResult}`)}
            </span>
          )}
        </span>
        <GripHorizontal size={16} aria-hidden />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="tabular min-w-0 truncate text-[40px] font-bold leading-none tracking-tight" data-testid="hud-value">
          {learn && verdict === null ? '?' : valueText}
          {isLen && p.unit !== 'in-frac' && <span className="ml-1 text-lg font-semibold text-slate-300">{unitLabel(p.unit)}</span>}
        </div>
        {primary.unit !== 'count' && (
          <span
            className={cx('tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', p.calibrated ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/25 text-amber-200')}
            data-testid="hud-u"
          >
            {fmtUFor(primary, p.unit)}
          </span>
        )}
      </div>
      {learn && (
        <div className="mt-2 rounded-xl bg-white/5 p-2 text-[13px]" data-testid="learn">
          <p className="text-slate-300">{t('learn.caliperPrompt', { unit: lu })}</p>
          <form
            className="mt-1 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              checkLearn();
            }}
          >
            <input
              inputMode="decimal"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              className="min-h-10 w-full rounded-lg bg-slate-800 px-2 text-base text-white"
              placeholder={lu === 'mm' ? '0.00' : '0.000'}
              data-testid="learn-input"
            />
            <button type="submit" className="rounded-lg bg-sky-500 px-3 font-bold">
              {t('learn.check')}
            </button>
            <button type="button" className="rounded-lg bg-white/10 px-2 text-xs" onClick={() => setVerdict('shown')}>
              {t('learn.show')}
            </button>
          </form>
          {verdict && (
            <p className={cx('mt-1', verdict === 'right' ? 'text-emerald-300' : verdict === 'wrong' ? 'text-rose-300' : 'text-slate-300')} data-testid="learn-verdict">
              {verdict === 'right' ? '✓ ' : verdict === 'wrong' ? '✗ ' : ''}
              {t('learn.explain', {
                main: formatNumber(learn.main, lu === 'mm' ? 0 : 3),
                line: learn.line,
                lc: learn.leastCount,
                reading: formatNumber(learn.reading, lu === 'mm' ? 2 : 3),
                unit: lu,
              })}
            </p>
          )}
        </div>
      )}
      {p.showRaw && isLen && !learn && <div className="tabular text-xs text-slate-500">raw {formatNumber(value, 4)} mm</div>}
      {secondaries.length > 0 && (
        <div className="tabular mt-1 flex flex-wrap gap-x-3 text-[13px] text-slate-300">
          {secondaries.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      )}
      {primary.notes && primary.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[12.5px] text-slate-200" data-testid="hud-notes">
          {primary.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {extra?.tol && (
        <div className="tabular mt-1 text-[12px] text-slate-300">
          {t('tol.limits')}: {fmtVal(extra.tol.lower)} … {fmtVal(extra.tol.upper)}
        </div>
      )}
      {rep && (
        <div className="tabular mt-1 flex items-center justify-between rounded-lg bg-white/5 px-2 py-1 text-[12.5px]" data-testid="hud-repeat">
          <span>
            n={rep.n} · {t('rep.mean')} <b>{fmtVal(rep.mean, rep.U)}</b> · {t('rep.spread')} {fmtVal(rep.spread)} · ±
            {fmtUFor({ ...primary, uncertainty: rep.U }, p.unit).slice(1)}
          </span>
          <button aria-label={t('rep.clear')} onClick={() => extras.clearRepeats(key)} className="p-1 text-slate-400">
            <X size={14} />
          </button>
        </div>
      )}
      {others.length > 0 && (
        <div className="tabular mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[13px]">
          {others.map((r) => (
            <span key={r.label} className="flex justify-between gap-2 text-slate-300">
              <span className="truncate text-slate-400">{r.nameKey ? t(r.nameKey) : r.label}</span>
              <span className="shrink-0 font-semibold text-white">{fmtReadout(r, p.unit, p.den)}</span>
            </span>
          ))}
        </div>
      )}
      {mmOn && mm && (
        <div className="tabular mt-1 text-[13px] text-slate-300">
          min {fmtVal(mm.min)} · max {fmtVal(mm.max)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <HudBtn
          active={inc}
          onClick={() =>
            setOffsets((o) => {
              const n = { ...o };
              if (key in n) delete n[key];
              else n[key] = primary.value;
              return n;
            })
          }
        >
          {inc ? 'ABS' : 'ZERO'}
        </HudBtn>
        <HudBtn active={!!held} onClick={() => setHeld((h) => (h ? null : p.readouts))}>
          HOLD
        </HudBtn>
        <HudBtn
          active={mmOn}
          onClick={() => {
            setMmOn((v) => !v);
            setMm(null);
          }}
        >
          MIN/MAX
        </HudBtn>
        <HudBtn active={!!extra?.tol} onClick={() => p.onTolerance(key, primary)} testId="hud-tol-btn">
          TOL
        </HudBtn>
        <HudBtn
          active={!!rep}
          onClick={() => {
            extras.addRepeat(key, primary.value);
            toast(t('rep.added', { n: (extra?.repeats?.length ?? 0) + 1 }));
          }}
          testId="hud-rep-btn"
        >
          REP{rep ? ` ${rep.n}` : ''}
        </HudBtn>
        <HudBtn
          label={t('hud.copy')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyText);
              toast(t('hud.copied'));
            } catch {
              toast(copyText);
            }
          }}
        >
          <Copy size={16} />
        </HudBtn>
        <HudBtn label={t('hud.speak')} onClick={speak}>
          <Volume2 size={16} />
        </HudBtn>
        <HudBtn label={t('hud.add')} primary onClick={p.onAdd}>
          <Plus size={16} />
          <span>{t('hud.add')}</span>
        </HudBtn>
      </div>
    </div>
  );
}

function HudBtn({
  children,
  onClick,
  active,
  primary,
  label,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      data-testid={testId}
      className={cx(
        'inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold transition active:scale-95',
        primary ? 'ml-auto bg-sky-500 text-white' : active ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-slate-100',
      )}
    >
      {children}
    </button>
  );
}
