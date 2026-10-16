import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fromMm, toMm, type LengthUnit } from '../../core/units';
import { fromPlusMinus } from '../../core/tolerance';
import type { Readout } from '../../render/types';
import { useExtras } from '../../state/extras';
import { Btn, Field, Sheet, inputCls } from './ui';

/** Nominal ± tolerance entry (§7.5). Values are typed in the display unit and stored in mm (or degrees). */
export function ToleranceSheet({
  target,
  unit,
  onClose,
}: {
  target: { key: string; readout: Readout } | null;
  unit: LengthUnit;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const extras = useExtras();
  const [nominal, setNominal] = useState('');
  const [plus, setPlus] = useState('');
  const [minus, setMinus] = useState('');
  const u = unit === 'in-frac' ? 'in' : unit;
  const isAngle = target?.readout.unit === 'angle';
  const toDisp = (mm: number) => (isAngle ? mm : fromMm(mm, u));
  const toCanon = (v: number) => (isAngle ? v : toMm(v, u));
  const sym = isAngle ? '°' : u;

  useEffect(() => {
    if (!target) return;
    const existing = extras.map[target.key]?.tol;
    const nom = existing ? existing.nominal : target.readout.value;
    const dec = isAngle ? 1 : u === 'mm' ? 2 : u === 'cm' ? 3 : 4;
    setNominal(toDisp(nom).toFixed(dec));
    setPlus(existing ? toDisp(existing.upper - existing.nominal).toFixed(dec) : isAngle ? '0.5' : toDisp(0.2).toFixed(dec));
    setMinus(existing ? toDisp(existing.nominal - existing.lower).toFixed(dec) : isAngle ? '0.5' : toDisp(0.2).toFixed(dec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const num = (s: string) => Number(s.replace(',', '.'));
  const apply = () => {
    if (!target) return;
    const n = num(nominal);
    const p = num(plus);
    const m = num(minus);
    if (![n, p, m].every(Number.isFinite)) return;
    extras.setTol(target.key, fromPlusMinus(toCanon(n), toCanon(p), toCanon(m)));
    onClose();
  };

  return (
    <Sheet open={!!target} onClose={onClose} title={t('tol.title', { label: target?.readout.label ?? '' })} testId="tol-sheet">
      <p className="mb-2 text-xs text-slate-400">{t('tol.hint')}</p>
      <Field label={`${t('tol.nominal')} (${sym})`}>
        <input className={inputCls} inputMode="decimal" value={nominal} onChange={(e) => setNominal(e.target.value)} data-testid="tol-nominal" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`+ ${t('tol.upper')} (${sym})`}>
          <input className={inputCls} inputMode="decimal" value={plus} onChange={(e) => setPlus(e.target.value)} data-testid="tol-plus" />
        </Field>
        <Field label={`− ${t('tol.lower')} (${sym})`}>
          <input className={inputCls} inputMode="decimal" value={minus} onChange={(e) => setMinus(e.target.value)} data-testid="tol-minus" />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Btn
          variant="ghost"
          className="flex-1"
          onClick={() => {
            if (target) extras.setTol(target.key, undefined);
            onClose();
          }}
        >
          {t('tol.clear')}
        </Btn>
        <Btn variant="primary" className="flex-1" onClick={apply} data-testid="tol-apply">
          {t('common.apply')}
        </Btn>
      </div>
    </Sheet>
  );
}
