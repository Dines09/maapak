import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Trash2, Pencil } from 'lucide-react';
import type { PartRecord } from '../../core/types';
import { useSettings } from '../../state/settings';
import { navigate } from '../../app/router';
import { Btn, Field, ScreenHeader, inputCls, useToast } from '../../app/components/ui';
import { fmtReadout, fmtU } from '../../app/components/ReadoutHud';
import { addPhoto, deleteRecord, getRecord, photoUrl, saveRecord } from './repo';

export function RecordDetailScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const unit = useSettings((s) => s.unit);
  const den = useSettings((s) => s.fractionDen);
  const [rec, setRec] = useState<PartRecord | null | undefined>(undefined);
  const [urls, setUrls] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void getRecord(id).then((r) => setRec(r ?? null));
  }, [id]);

  useEffect(() => {
    if (!rec) return;
    let made: string[] = [];
    void Promise.all(rec.photos.map((p) => photoUrl(p.blobKey))).then((u) => {
      made = u.filter((x): x is string => !!x);
      setUrls(made);
    });
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [rec]);

  if (rec === undefined) return <div className="min-h-dvh bg-slate-950" />;
  if (rec === null) {
    return (
      <div className="min-h-dvh bg-slate-950 p-6 text-slate-200">
        <p>{t('records.notFound')}</p>
        <Btn className="mt-4" onClick={() => navigate('/records')}>
          {t('common.back')}
        </Btn>
      </div>
    );
  }

  const update = async (r: PartRecord) => {
    await saveRecord(r);
    setRec({ ...r, updatedAt: Date.now() });
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader
        title={rec.name}
        onBack={() => navigate('/records')}
        right={
          <button aria-label={t('common.edit')} className="p-2" onClick={() => setEditing((v) => !v)}>
            <Pencil size={18} />
          </button>
        }
      />
      <main className="mx-auto max-w-lg px-3 pb-10" data-testid="record-detail">
        {/* Photo on top, dimensions below (§9). */}
        {urls.length > 0 ? (
          <div className="mb-3 flex snap-x gap-2 overflow-x-auto">
            {urls.map((u, i) => (
              <img
                key={u}
                src={u}
                alt={`${rec.name} ${i + 1}`}
                className="max-h-72 w-full shrink-0 snap-center rounded-2xl object-contain"
              />
            ))}
          </div>
        ) : null}
        <label className="mb-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-800 text-sm font-semibold">
          <Camera size={18} /> {t('save.addPhoto')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await update(await addPhoto(rec, f));
              } catch {
                toast(t('save.failed'));
              }
            }}
          />
        </label>

        {editing ? (
          <EditFields
            rec={rec}
            onSave={async (r) => {
              await update(r);
              setEditing(false);
            }}
          />
        ) : (
          <div className="mb-3 text-sm text-slate-300">
            {[
              rec.partNo && `${t('record.partNo')}: ${rec.partNo}`,
              rec.project && `${t('record.project')}: ${rec.project}`,
              rec.measuredBy && `${t('record.measuredBy')}: ${rec.measuredBy}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {rec.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rec.tags.map((x) => (
                  <span key={x} className="rounded bg-slate-800 px-2 py-0.5 text-xs">
                    {x}
                  </span>
                ))}
              </div>
            )}
            {rec.notes && <p className="mt-2 whitespace-pre-wrap text-slate-400">{rec.notes}</p>}
          </div>
        )}

        <table className="tabular w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="py-1">{t('record.label')}</th>
              <th>{t('record.feature')}</th>
              <th className="text-right">{t('record.value')}</th>
              <th className="text-right">±</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rec.measurements.map((m) => (
              <tr key={m.id} className="border-t border-white/5">
                <td className="py-2 font-bold text-sky-300">{m.label}</td>
                <td className="text-slate-300">{t(`kind.${m.kind}`)}</td>
                <td className="text-right font-semibold">
                  {fmtReadout({ ...m, unit: 'length' }, unit, den)}
                </td>
                <td className="text-right text-xs text-slate-400">{fmtU(m.uncertainty, unit).slice(1)}</td>
                <td className="text-right">
                  <button
                    aria-label={t('common.delete')}
                    className="p-1.5 text-rose-300"
                    onClick={() =>
                      void update({ ...rec, measurements: rec.measurements.filter((x) => x.id !== m.id) })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">
          {t('record.calibration')}: {rec.calibrationLabel ?? '—'} ·{' '}
          {new Date(rec.createdAt).toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-slate-500">{t('record.exportLater')}</p>
        <Btn
          variant="danger"
          className="mt-6 w-full"
          onClick={async () => {
            if (!confirm(t('records.confirmDelete', { name: rec.name }))) return;
            await deleteRecord(rec.id);
            navigate('/records', true);
          }}
        >
          <Trash2 size={16} /> {t('records.delete')}
        </Btn>
      </main>
    </div>
  );
}

function EditFields({ rec, onSave }: { rec: PartRecord; onSave: (r: PartRecord) => void }) {
  const { t } = useTranslation();
  const [r, setR] = useState(rec);
  return (
    <div className="mb-3 rounded-2xl bg-slate-800/60 p-3">
      <Field label={t('record.name')}>
        <input className={inputCls} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('record.partNo')}>
          <input
            className={inputCls}
            value={r.partNo ?? ''}
            onChange={(e) => setR({ ...r, partNo: e.target.value || undefined })}
          />
        </Field>
        <Field label={t('record.project')}>
          <input
            className={inputCls}
            value={r.project ?? ''}
            onChange={(e) => setR({ ...r, project: e.target.value || undefined })}
          />
        </Field>
      </div>
      <Field label={t('record.tags')}>
        <input
          className={inputCls}
          value={r.tags.join(', ')}
          onChange={(e) =>
            setR({
              ...r,
              tags: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Field label={t('record.notes')}>
        <textarea
          className={`${inputCls} min-h-16 py-2`}
          value={r.notes ?? ''}
          onChange={(e) => setR({ ...r, notes: e.target.value || undefined })}
        />
      </Field>
      <Btn variant="primary" className="mt-2 w-full" onClick={() => onSave(r)}>
        {t('common.save')}
      </Btn>
    </div>
  );
}
