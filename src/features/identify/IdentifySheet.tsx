// "What is this?" Part Identifier (§6.10): the current readouts against every sourced standards table.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { identify } from '../../core/standards/identify';
import type { Readout } from '../../render/types';
import { Sheet } from '../../app/components/ui';

const USED = new Set(['diameter', 'outerDiameter', 'innerDiameter', 'crossSection', 'acrossFlats', 'pitch']);

export function IdentifySheet({
  open,
  onClose,
  readouts,
}: {
  open: boolean;
  onClose: () => void;
  readouts: Readout[];
}) {
  const { t } = useTranslation();
  const matches = useMemo(() => {
    if (!open) return [];
    const rs = readouts
      .filter((r) => USED.has(r.kind) && (r.unit === 'length' || r.kind === 'pitch') && r.value > 0)
      .map((r) => ({ kind: r.kind, value: r.value, uncertainty: r.uncertainty }));
    return identify(rs).sort((a, b) => b.confidence - a.confidence);
  }, [open, readouts]);
  return (
    <Sheet open={open} onClose={onClose} title={t('identify.title')} testId="identify">
      {matches.length === 0 ? (
        <p className="text-sm text-slate-400">{t('identify.empty')}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="identify-list">
          {matches.map((m, i) => (
            <li key={i} className="rounded-xl bg-slate-800 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {t(`identify.cat.${m.category}`)}
                </span>
                <span className="tabular text-xs text-slate-400">{Math.round(m.confidence * 100)}%</span>
              </div>
              <div className="text-sm font-semibold text-white">{m.title}</div>
              <div className="tabular text-xs text-slate-300">{m.detail}</div>
              <div className="mt-1 h-1 rounded bg-slate-700">
                <div
                  className="h-1 rounded bg-sky-400"
                  style={{ width: `${Math.round(m.confidence * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">{t('identify.note')}</p>
    </Sheet>
  );
}
