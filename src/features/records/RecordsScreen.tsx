import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageIcon, Search } from 'lucide-react';
import type { PartRecord } from '../../core/types';
import { navigate } from '../../app/router';
import { ScreenHeader, inputCls } from '../../app/components/ui';
import { listRecords, photoUrl } from './repo';

export function RecordsScreen() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<PartRecord[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    void listRecords().then(setRecords);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!records) return [];
    if (!s) return records;
    return records.filter((r) =>
      [r.name, r.partNo, r.project, r.notes, ...r.tags].some((x) => x?.toLowerCase().includes(s)),
    );
  }, [records, q]);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader title={t('nav.records')} onBack={() => navigate('/')} />
      <main className="mx-auto max-w-lg px-3 pb-10">
        <label className="relative mb-3 block">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className={`${inputCls} pl-10`}
            placeholder={t('records.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {records && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">{t('records.empty')}</p>
        )}
        <ul className="space-y-2" data-testid="records-list">
          {filtered.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => navigate(`/records/${r.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl bg-slate-800 p-2.5 text-left hover:bg-slate-700"
              >
                <Thumb record={r} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.name}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {[r.partNo, r.project, ...r.tags].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t('records.count', { n: r.measurements.length })} ·{' '}
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function Thumb({ record }: { record: PartRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const key = record.photos[0]?.blobKey;
    if (!key) return;
    let u: string | null = null;
    void photoUrl(key).then((x) => {
      u = x;
      setUrl(x);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [record]);
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-700">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon size={22} className="text-slate-500" />
      )}
    </span>
  );
}
