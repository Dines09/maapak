import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ImageIcon,
  Search,
  FileDown,
  FileUp,
  Archive,
  ArchiveRestore,
  GitCompare,
  Layers,
} from 'lucide-react';
import type { PartRecord } from '../../core/types';
import { navigate, useRoute } from '../../app/router';
import { Btn, Field, ScreenHeader, Sheet, Toggle, cx, inputCls, useToast } from '../../app/components/ui';
import { useSettings } from '../../state/settings';
import { listRecords, photoUrl } from './repo';
import { importRecordJson, recordsToCsv, shareOrDownload, valueText } from '../export/common';
import { newId } from '../../tools/base';

type Sort = 'date' | 'name';

export function RecordsScreen() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const settings = useSettings();
  const route = useRoute();
  const [records, setRecords] = useState<PartRecord[] | null>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [tool, setTool] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('date');
  const [compareA, setCompareA] = useState<string | null>(route.query.get('compare'));
  const [compareB, setCompareB] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const reload = () => void listRecords().then(setRecords);
  useEffect(reload, []);

  const facets = useMemo(() => {
    const all = records ?? [];
    return {
      projects: [...new Set(all.map((r) => r.project).filter((x): x is string => !!x))].sort(),
      tags: [...new Set(all.flatMap((r) => r.tags))].sort(),
      tools: [...new Set(all.flatMap((r) => r.measurements.map((m) => m.tool)))].sort(),
    };
  }, [records]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = (records ?? []).filter(
      (r) =>
        (!s || [r.name, r.partNo, r.project, r.notes, ...r.tags].some((x) => x?.toLowerCase().includes(s))) &&
        (!project || r.project === project) &&
        (!tag || r.tags.includes(tag)) &&
        (!tool || r.measurements.some((m) => m.tool === tool)),
    );
    list = [...list].sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : b.updatedAt - a.updatedAt,
    );
    return list;
  }, [records, q, project, tag, tool, sort]);

  const tap = (r: PartRecord) => {
    if (compareA && compareA !== r.id) {
      setCompareB(r.id);
      return;
    }
    navigate(`/records/${r.id}`);
  };

  const backup = async () => {
    const { exportBackup } = await import('../export/backup');
    await shareOrDownload(await exportBackup(), `maapak-${new Date().toISOString().slice(0, 10)}.maapak.zip`);
  };
  const restore = async (f?: File) => {
    if (!f) return;
    try {
      const { importBackup } = await import('../export/backup');
      const n = await importBackup(f);
      toast(t('backup.restored', { n: n.records }));
      reload();
    } catch {
      toast(t('backup.failed'));
    }
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const r = await importRecordJson(await f.text(), () => newId('rec'));
      toast(t('records.imported', { name: r.name }));
      reload();
    } catch {
      toast(t('records.importFailed'));
    }
  };

  const A = records?.find((r) => r.id === compareA);
  const B = records?.find((r) => r.id === compareB);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader title={t('nav.records')} onBack={() => navigate('/')} />
      <main className="mx-auto max-w-lg px-3 pb-10">
        <label className="relative mb-2 block">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className={`${inputCls} pl-10`}
            placeholder={t('records.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="records-search"
          />
        </label>

        {(facets.projects.length > 0 || facets.tags.length > 0 || facets.tools.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1" data-testid="facets">
            {facets.projects.map((p) => (
              <Chip key={`p${p}`} on={project === p} onClick={() => setProject(project === p ? null : p)}>
                📁 {p}
              </Chip>
            ))}
            {facets.tags.map((x) => (
              <Chip key={`t${x}`} on={tag === x} onClick={() => setTag(tag === x ? null : x)}>
                #{x}
              </Chip>
            ))}
            {facets.tools.map((x) => (
              <Chip key={`o${x}`} on={tool === x} onClick={() => setTool(tool === x ? null : x)}>
                {t(`tool.${x}`)}
              </Chip>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <select
            className="min-h-9 rounded-lg bg-slate-800 px-2 text-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label={t('records.sort')}
          >
            <option value="date">{t('records.sortDate')}</option>
            <option value="name">{t('records.sortName')}</option>
          </select>
          <SmallBtn
            on={!!compareA}
            onClick={() =>
              compareA ? (setCompareA(null), setCompareB(null)) : toast(t('records.compareHint'))
            }
          >
            <GitCompare size={14} /> {t('records.compare')}
          </SmallBtn>
          <SmallBtn on={settings.batch.on} onClick={() => setBatchOpen(true)} testId="batch-btn">
            <Layers size={14} /> {t('batch.title')}
          </SmallBtn>
          <SmallBtn
            onClick={() =>
              void shareOrDownload(
                new Blob([recordsToCsv(filtered, settings.unit)], { type: 'text/csv' }),
                'maapak-records.csv',
              )
            }
            testId="csv-all"
          >
            <FileDown size={14} /> CSV
          </SmallBtn>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg bg-slate-800 px-2 text-xs font-semibold">
            <FileUp size={14} /> {t('records.importJson')}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => void importJson(e.target.files?.[0])}
              data-testid="import-json"
            />
          </label>
          <SmallBtn onClick={() => void backup()} testId="backup">
            <Archive size={14} /> {t('backup.export')}
          </SmallBtn>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg bg-slate-800 px-2 text-xs font-semibold">
            <ArchiveRestore size={14} /> {t('backup.import')}
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={(e) => void restore(e.target.files?.[0])}
              data-testid="restore"
            />
          </label>
        </div>

        {compareA && (
          <p className="mb-2 rounded-xl bg-sky-500/15 p-2 text-xs text-sky-200">
            {t('records.compareWith', { name: A?.name ?? '' })}
          </p>
        )}
        {records && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">{t('records.empty')}</p>
        )}
        <ul className="space-y-2" data-testid="records-list">
          {filtered.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => tap(r)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-2xl p-2.5 text-left',
                  r.id === compareA ? 'bg-sky-900/60 ring-1 ring-sky-400' : 'bg-slate-800 hover:bg-slate-700',
                )}
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

      <Sheet
        open={!!(A && B)}
        onClose={() => setCompareB(null)}
        title={t('records.compareTitle')}
        testId="compare"
      >
        {A && B && <CompareTable a={A} b={B} />}
      </Sheet>

      <Sheet open={batchOpen} onClose={() => setBatchOpen(false)} title={t('batch.title')}>
        <p className="mb-2 text-xs text-slate-400">{t('batch.hint')}</p>
        <Toggle
          label={t('batch.on')}
          checked={settings.batch.on}
          onChange={(on) => settings.set({ batch: { ...settings.batch, on } })}
        />
        <Field label={t('batch.prefix')}>
          <input
            className={inputCls}
            value={settings.batch.prefix}
            onChange={(e) => settings.set({ batch: { ...settings.batch, prefix: e.target.value || 'Part' } })}
            data-testid="batch-prefix"
          />
        </Field>
        <Btn variant="primary" className="mt-2 w-full" onClick={() => setBatchOpen(false)}>
          {t('common.apply')}
        </Btn>
      </Sheet>
    </div>
  );
}

/** Side-by-side comparison with Δ per feature (§9). Features pair up by label, then by kind. */
function CompareTable({ a, b }: { a: PartRecord; b: PartRecord }) {
  const { t } = useTranslation();
  const unit = useSettings((s) => s.unit);
  const used = new Set<string>();
  const rows = a.measurements.map((ma) => {
    const mb =
      b.measurements.find((x) => !used.has(x.id) && x.label === ma.label) ??
      b.measurements.find((x) => !used.has(x.id) && x.kind === ma.kind);
    if (mb) used.add(mb.id);
    return { ma, mb };
  });
  return (
    <table className="tabular w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-400">
          <th>{t('record.label')}</th>
          <th className="text-right">{a.name}</th>
          <th className="text-right">{b.name}</th>
          <th className="text-right">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ ma, mb }) => {
          const va = valueText(ma, unit);
          const vb = mb ? valueText(mb, unit) : null;
          const d = mb
            ? valueText(
                {
                  ...ma,
                  value: mb.value - ma.value,
                  uncertainty: Math.hypot(ma.uncertainty, mb.uncertainty),
                },
                unit,
              )
            : null;
          const significant = mb
            ? Math.abs(mb.value - ma.value) > Math.hypot(ma.uncertainty, mb.uncertainty)
            : false;
          return (
            <tr key={ma.id} className="border-t border-white/5">
              <td className="py-1.5 font-bold text-sky-300">{ma.label}</td>
              <td className="text-right">{va.v}</td>
              <td className="text-right">{vb?.v ?? '—'}</td>
              <td
                className={cx('text-right font-semibold', significant ? 'text-amber-300' : 'text-slate-400')}
              >
                {d ? `${d.v.startsWith('−') ? '' : '+'}${d.v}` : ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-full px-2.5 py-1 text-xs font-semibold',
        on ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-300',
      )}
    >
      {children}
    </button>
  );
}

function SmallBtn({
  on,
  onClick,
  children,
  testId,
}: {
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold',
        on ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-100',
      )}
    >
      {children}
    </button>
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
