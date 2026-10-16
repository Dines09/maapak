import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Volume2, Plus, GripHorizontal } from 'lucide-react';
import type { Vec } from '../../core/types';
import {
  formatFraction,
  formatNumber,
  fromMm,
  toFraction,
  type FractionDenominator,
  type LengthUnit,
} from '../../core/units';
import { decimalsFor } from '../../core/uncertainty';
import type { Readout } from '../../render/types';
import { fmtArea, fmtLength, unitLabel } from '../../render/format';
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
  onAdd(): void;
  onRecord?(r: Readout): void;
}

export function fmtReadout(r: Readout, unit: LengthUnit, den: FractionDenominator, raw = false): string {
  if (r.unit === 'count') return String(Math.round(r.value));
  if (r.unit === 'area') return `${fmtArea(r.value, r.uncertainty, unit, raw)} ${unitLabel(unit)}²`;
  if (r.unit === 'angle') return `${formatNumber(r.value, 1)}°`;
  const v = fmtLength(r.value, r.uncertainty, unit, den, raw);
  return unit === 'in-frac' ? v : `${v} ${unitLabel(unit)}`;
}

export function fmtU(Umm: number, unit: LengthUnit): string {
  const u = unit === 'in-frac' ? 'in' : unit;
  return `±${formatNumber(fromMm(Umm, u), decimalsFor(Umm, u))} ${unitLabel(u)}`;
}

export function ReadoutHud(p: HudProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast((s) => s.show);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Vec | null>(null);
  const [place, setPlace] = useState<'user' | 'top' | 'bottom'>('user');
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<Readout[] | null>(null);
  const [mm, setMm] = useState<{ min: number; max: number } | null>(null);
  const [mmOn, setMmOn] = useState(false);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const shown = held ?? p.readouts;
  const primary = shown.find((r) => r.primary) ?? shown[0];
  const key = primary ? `${p.toolKey}:${primary.label}` : '';
  const off = offsets[key] ?? 0;
  const inc = key in offsets;
  const value = primary ? primary.value - off : 0;

  // Min/Max tracking while adjusting (§7.4).
  useEffect(() => {
    if (!mmOn || !primary || held) return;
    setMm((m) =>
      m ? { min: Math.min(m.min, value), max: Math.max(m.max, value) } : { min: value, max: value },
    );
  }, [mmOn, value, primary, held]);

  // Reset HOLD when the tool changes.
  useEffect(() => {
    setHeld(null);
    setMm(null);
  }, [p.toolKey]);

  // Default position: lower middle, above the dock.
  useLayoutEffect(() => {
    if (pos || !ref.current) return;
    const w = ref.current.offsetWidth;
    setPos([Math.max(8, (window.innerWidth - w) / 2), Math.max(80, window.innerHeight - 330)]);
  }, [pos, primary]);

  // Move away from the active handle so the HUD never covers the edge being aligned.
  useEffect(() => {
    if (!p.avoid || !ref.current || !pos) return;
    const r = ref.current.getBoundingClientRect();
    const m = 40;
    const inside =
      p.avoid[0] > r.left - m &&
      p.avoid[0] < r.right + m &&
      p.avoid[1] > r.top - m &&
      p.avoid[1] < r.bottom + m;
    if (inside) setPlace(p.avoid[1] > window.innerHeight / 2 ? 'top' : 'bottom');
  }, [p.avoid, pos]);

  const style = useMemo(() => {
    if (!pos) return { left: 8, top: -999 };
    if (place === 'user') return { left: pos[0], top: pos[1] };
    const h = ref.current?.offsetHeight ?? 120;
    return { left: pos[0], top: place === 'top' ? 64 : Math.max(64, window.innerHeight - h - 190) };
  }, [pos, place]);

  if (!primary) return null;

  const valueText =
    primary.unit === 'length' || !primary.unit
      ? fmtLength(value, primary.uncertainty, p.unit, p.den)
      : fmtReadout({ ...primary, value }, p.unit, p.den);
  const isLen = primary.unit === 'length' || !primary.unit;

  const secondaries: string[] = [];
  if (isLen && p.secondary) {
    for (const u of ['mm', 'cm', 'in'] as const) {
      if (u === p.unit) continue;
      secondaries.push(`${fmtLength(value, primary.uncertainty, u, p.den)} ${u}`);
    }
    if (p.unit !== 'in-frac') {
      const f = toFraction(value, p.den);
      secondaries.push(
        `${formatFraction(f)} (${f.errorMm >= 0.005 ? `Δ${formatNumber(f.errorMm, 2)} mm` : 'exact'})`,
      );
    }
  }

  const copyText = isLen
    ? `${primary.label} ${valueText}${p.unit === 'in-frac' ? '' : ` ${unitLabel(p.unit)}`} ${fmtU(primary.uncertainty, p.unit)}`
    : `${primary.label} ${valueText}`;

  const speak = () => {
    try {
      const unitName = t(`unitName.${p.unit === 'in-frac' ? 'in' : p.unit}`);
      const num = isLen ? (p.unit === 'in-frac' ? valueText.replace('″', '') : valueText) : valueText;
      const u = new SpeechSynthesisUtterance(`${num} ${isLen ? unitName : ''}`);
      u.lang = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      toast(t('hud.speakUnsupported'));
    }
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
    setPos([
      Math.min(window.innerWidth - w - 4, Math.max(4, e.clientX - d.dx)),
      Math.min(window.innerHeight - h - 4, Math.max(4, e.clientY - d.dy)),
    ]);
  };
  const onGripUp = () => (dragRef.current = null);

  const others = shown.filter((r) => r !== primary);

  return (
    <div
      ref={ref}
      data-testid="hud"
      style={style}
      className="hud fixed z-30 w-[min(92vw,360px)] select-none rounded-2xl border border-white/10 bg-slate-950/88 p-2.5 text-white shadow-2xl backdrop-blur-sm"
    >
      <div
        className="-mx-1 -mt-1 mb-1 flex cursor-grab touch-none items-center justify-between rounded-lg px-1 py-0.5 text-[11px] text-slate-400 active:cursor-grabbing"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
      >
        <span className="flex items-center gap-1.5">
          <span className="rounded-md bg-sky-500/25 px-1.5 py-0.5 font-bold text-sky-200">
            {primary.label}
          </span>
          {primary.nameKey && <span>{t(primary.nameKey)}</span>}
          {inc && <span className="rounded bg-amber-500/30 px-1 font-bold text-amber-200">INC</span>}
          {held && <span className="rounded bg-rose-500/30 px-1 font-bold text-rose-200">HOLD</span>}
        </span>
        <GripHorizontal size={16} aria-hidden />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="tabular min-w-0 truncate text-[40px] font-bold leading-none tracking-tight"
          data-testid="hud-value"
        >
          {valueText}
          {isLen && p.unit !== 'in-frac' && (
            <span className="ml-1 text-lg font-semibold text-slate-300">{unitLabel(p.unit)}</span>
          )}
        </div>
        {isLen && (
          <span
            className={cx(
              'tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
              p.calibrated ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/25 text-amber-200',
            )}
            data-testid="hud-u"
          >
            {fmtU(primary.uncertainty, p.unit)}
          </span>
        )}
      </div>
      {p.showRaw && isLen && (
        <div className="tabular text-xs text-slate-500">raw {formatNumber(value, 4)} mm</div>
      )}
      {secondaries.length > 0 && (
        <div className="tabular mt-1 flex flex-wrap gap-x-3 text-[13px] text-slate-300">
          {secondaries.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="tabular mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[13px]">
          {others.map((r) => (
            <span key={r.label} className="flex justify-between gap-2 text-slate-300">
              <span className="text-slate-400">{r.nameKey ? t(r.nameKey) : r.label}</span>
              <span className="font-semibold text-white">{fmtReadout(r, p.unit, p.den)}</span>
            </span>
          ))}
        </div>
      )}
      {mmOn && mm && (
        <div className="tabular mt-1 text-[13px] text-slate-300">
          min {fmtLength(mm.min, primary.uncertainty, p.unit, p.den)} · max{' '}
          {fmtLength(mm.max, primary.uncertainty, p.unit, p.den)}
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold transition active:scale-95',
        primary
          ? 'ml-auto bg-sky-500 text-white'
          : active
            ? 'bg-amber-400 text-slate-950'
            : 'bg-white/10 text-slate-100',
      )}
    >
      {children}
    </button>
  );
}
