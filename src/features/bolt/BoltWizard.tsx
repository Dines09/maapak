// Bolt Wizard UI (§6.6.2): head-type picker that starts the guided bolt recipe, and the result card.
import { useTranslation } from 'react-i18next';
import type { PartRecord } from '../../core/types';
import { formatNumber, MM_PER_INCH } from '../../core/units';
import { tpiFromPitch } from '../../core/standards/threads';
import { navigate } from '../../app/router';
import { Sheet } from '../../app/components/ui';
import { blankRecord, nextRecordName, saveRecord } from '../records/repo';
import { BOLT_HEADS, boltSummary, boltTitle, lengthIsOverall, type BoltHead } from './bolt';

/** Side-profile icon of each head type, with the length convention marked. */
function HeadIcon({ head }: { head: BoltHead }) {
  const shank = head === 'countersunk' ? 'M17 20h26v8H17' : 'M16 20h27v8H16';
  const heads: Record<BoltHead, string> = {
    hex: 'M6 14h10v20H6zM6 19h10M6 29h10',
    socket: 'M7 16h9v16H7z',
    countersunk: 'M8 13l9 7v8l-9 7z',
    button: 'M16 15c-6 0-9 4-9 9s3 9 9 9z',
    pan: 'M16 15c-6 0-8 2-8 4v10c0 2 2 4 8 4z',
    carriage: 'M16 13c-7 0-10 5-10 11s3 11 10 11zM16 20h4v8h-4',
  };
  const overall = lengthIsOverall(head);
  return (
    <svg
      viewBox="0 0 48 44"
      width="64"
      height="58"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <path d={heads[head]} strokeLinejoin="round" />
      <path d={shank} strokeLinejoin="round" />
      <path d="M24 21v6M28 21v6M32 21v6M36 21v6M40 21v6" strokeWidth="0.9" opacity="0.6" />
      <path
        d={`M${overall ? 8 : 16} 40H43M${overall ? 8 : 16} 37v6M43 37v6`}
        className="text-sky-400"
        stroke="#38bdf8"
      />
    </svg>
  );
}

export function BoltWizardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const start = async (head: BoltHead) => {
    const name = await nextRecordName('Bolt');
    const rec: PartRecord = { ...blankRecord(name), recipe: 'bolt', bolt: { head } };
    await saveRecord(rec);
    onClose();
    navigate(`/?into=${rec.id}&step=0`);
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('bolt.title')} testId="bolt-wizard">
      <p className="mb-2 text-xs text-slate-400">{t('bolt.pickHead')}</p>
      <div className="grid grid-cols-3 gap-2">
        {BOLT_HEADS.map((h) => (
          <button
            key={h}
            data-testid={`bolt-head-${h}`}
            onClick={() => void start(h)}
            className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 p-2 text-xs font-semibold text-slate-100 hover:bg-slate-700"
          >
            <HeadIcon head={h} />
            {t(`bolt.head.${h}`)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">{t('bolt.lengthRule')}</p>
    </Sheet>
  );
}

export function BoltCard({ rec, unit }: { rec: PartRecord; unit: string }) {
  const { t } = useTranslation();
  if (!rec.bolt) return null;
  const s = boltSummary(rec);
  const headName = t(`bolt.headBolt.${rec.bolt.head}`);
  const pct = s.id ? Math.round(s.id.confidence * 100) : 0;
  const verdict = s.id ? t(`thread.verdict.${s.id.system}`) : null;
  return (
    <section className="mb-3 rounded-2xl bg-slate-800/60 p-3" data-testid="bolt-card">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-300">{t('bolt.result')}</h2>
      {s.id ? (
        <>
          <p className="text-base font-bold text-white" data-testid="bolt-title">
            {boltTitle(s, headName)}
          </p>
          <p className="mt-0.5 text-xs text-slate-300">
            {verdict} · {t('bolt.confidence', { pct })}
            {s.P && (
              <>
                {' · '}P {formatNumber(s.P.value, 2)} mm ≈ {formatNumber(tpiFromPitch(s.P.value), 1)} TPI
              </>
            )}
          </p>
          {s.id.nominal && (
            <p className="mt-0.5 text-xs text-slate-400">
              {t('bolt.major', {
                d: formatNumber(s.d!.value, 2),
                nominal: s.id.nominal.size,
                nd: formatNumber(s.id.nominal.dMm, 2),
              })}
            </p>
          )}
          {s.id.alternatives.length > 0 && (
            <p className="mt-0.5 text-xs text-slate-400">
              {t('bolt.alternatives')}: {s.id.alternatives.join(' · ')}
            </p>
          )}
          <ul className="mt-1.5 space-y-0.5 text-xs text-slate-300">
            {s.nut && (
              <li>
                {t('bolt.nut')}: {s.nut}
              </li>
            )}
            <li>{t('bolt.washerNote')}</li>
            {!s.P && <li className="text-amber-300">{t('bolt.needPitch')}</li>}
            {unit !== 'mm' && s.L && <li>L = {formatNumber(s.L.value / MM_PER_INCH, 3)}″</li>}
          </ul>
        </>
      ) : (
        <p className="text-sm text-slate-400">{t('bolt.needDiameter')}</p>
      )}
    </section>
  );
}
