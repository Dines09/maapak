import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  Trash2,
  Pencil,
  ImagePlus,
  Download,
  Copy,
  GitCompare,
  Crosshair,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import type { PartRecord } from '../../core/types';
import { useSettings } from '../../state/settings';
import { navigate } from '../../app/router';
import { Btn, Field, ScreenHeader, Sheet, inputCls, cx, useToast } from '../../app/components/ui';
import { fmtReadout, fmtU, fmtUFor } from '../../app/components/ReadoutHud';
import { addPhoto, deleteRecord, duplicateRecord, getRecord, photoUrl, saveRecord } from './repo';
import { recordViews } from '../drawing/model';
import { BoltCard } from '../bolt/BoltWizard';
import { drawingSvg } from '../drawing/svg';
import { annotatedPhotoSvg } from '../drawing/annotate';
import { RECIPES, recipeProgress, type RecipeId } from './recipes';
import { TOOL_REGISTRY } from '../../tools/registry';
import { recordToJson, recordsToCsv, safeName, shareOrDownload } from '../export/common';

export function RecordDetailScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const settings = useSettings();
  const { unit, fractionDen: den } = settings;
  const [rec, setRec] = useState<PartRecord | null | undefined>(undefined);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getRecord(id).then((r) => setRec(r ?? null));
  }, [id]);

  useEffect(() => {
    if (!rec) return;
    const made: string[] = [];
    void Promise.all(rec.photos.map(async (p) => [p.id, await photoUrl(p.blobKey)] as const)).then(
      (pairs) => {
        const m: Record<string, string> = {};
        for (const [pid, u] of pairs) {
          if (u) {
            m[pid] = u;
            made.push(u);
          }
        }
        setUrls(m);
      },
    );
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [rec]);

  const views = useMemo(() => (rec ? recordViews(rec) : []), [rec]);
  const drawing = useMemo(
    () =>
      views.length
        ? drawingSvg(views, {
            unit,
            den,
            projection: settings.projection,
            note: t('drawing.note', { unit: unit === 'in-frac' ? 'in' : unit }),
          })
        : '',
    [views, unit, den, settings.projection, t],
  );

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

  const progress = recipeProgress(rec);
  const sheetText = {
    label: t('record.label'),
    feature: t('record.feature'),
    value: t('record.value'),
    tol: t('record.tolerance'),
    notes: t('record.notes'),
    units: t('drawing.units'),
    date: t('drawing.date'),
    by: t('record.measuredBy'),
    calibration: t('record.calibration'),
    partNo: t('record.partNo'),
    projection: t(`drawing.projection.${settings.projection}`),
    scale: t('drawing.scale'),
    pass: t('tol.pass'),
    warn: t('tol.warn'),
    fail: t('tol.fail'),
  };
  const sheetOpts = {
    unit,
    den,
    paper: settings.paper,
    projection: settings.projection,
    company: settings.company,
    engineer: settings.engineer,
    text: sheetText,
    featureName: (k: string) => t(`kind.${k}`),
  };

  const run = async (what: string) => {
    setBusy(true);
    const base = safeName(rec.name);
    try {
      if (what === 'pdf') {
        const { recordPdf } = await import('../export/sheets');
        await shareOrDownload(await recordPdf(rec, sheetOpts), `${base}.pdf`);
      } else if (what === 'jpg' || what === 'png') {
        const { recordCard } = await import('../export/sheets');
        await shareOrDownload(
          await recordCard(rec, sheetOpts, what === 'jpg' ? 'image/jpeg' : 'image/png'),
          `${base}.${what}`,
        );
      } else if (what === 'svg') {
        await shareOrDownload(new Blob([drawing], { type: 'image/svg+xml' }), `${base}.svg`);
      } else if (what === 'csv') {
        await shareOrDownload(new Blob([recordsToCsv([rec], unit)], { type: 'text/csv' }), `${base}.csv`);
      } else if (what === 'json') {
        await shareOrDownload(
          new Blob([await recordToJson(rec)], { type: 'application/json' }),
          `${base}.maapak.json`,
        );
      } else if (what === 'dxf') {
        const { recordDxf } = await import('../export/dxf');
        await shareOrDownload(
          new Blob([recordDxf(views, unit, den)], { type: 'application/dxf' }),
          `${base}.dxf`,
        );
      } else if (what === 'match') {
        navigate(`/?template=${rec.id}`);
      } else if (what === 'template-svg' || what === 'template-pdf') {
        const { templateSvg, templatePdf } = await import('../export/sheets');
        const svg = templateSvg(rec, { unit, den }, t('export.printNote'));
        if (what === 'template-svg')
          await shareOrDownload(new Blob([svg], { type: 'image/svg+xml' }), `${base}-1to1.svg`);
        else await shareOrDownload(await templatePdf(svg, settings.paper), `${base}-1to1.pdf`);
      }
      setExportOpen(false);
    } catch {
      toast(t('export.failed'));
    } finally {
      setBusy(false);
    }
  };

  const measureStep = (i: number) => navigate(`/?into=${rec.id}&step=${i}`);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader
        title={rec.name}
        onBack={() => navigate('/records')}
        right={
          <>
            <button
              aria-label={t('export.title')}
              className="p-2"
              onClick={() => setExportOpen(true)}
              data-testid="export-btn"
            >
              <Download size={18} />
            </button>
            <button aria-label={t('common.edit')} className="p-2" onClick={() => setEditing((v) => !v)}>
              <Pencil size={18} />
            </button>
          </>
        }
      />
      <main className="mx-auto max-w-lg px-3 pb-12" data-testid="record-detail">
        {/* Photo on top, dimensions drawn on it (§9, §11 a). */}
        {rec.photos.length > 0 && (
          <div className="mb-3 flex snap-x gap-2 overflow-x-auto">
            {rec.photos.map((p) => (
              <div key={p.id} className="relative w-full shrink-0 snap-center">
                {urls[p.id] &&
                  (p.ghostToPhoto ? (
                    <div
                      className="w-full overflow-hidden rounded-2xl bg-black [&>svg]:h-auto [&>svg]:w-full"
                      data-testid="annotated-photo"
                      dangerouslySetInnerHTML={{ __html: annotatedPhotoSvg(rec, p, urls[p.id], unit, den) }}
                    />
                  ) : (
                    <img src={urls[p.id]} alt="" className="max-h-80 w-full rounded-2xl object-contain" />
                  ))}
                <div className="absolute bottom-2 right-2 flex gap-1">
                  {p.matchScore !== undefined && (
                    <span className="rounded bg-slate-900/80 px-1.5 text-[10px]">
                      {t('camera.match')} {p.matchScore}
                    </span>
                  )}
                  <button
                    className="flex items-center gap-1 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px]"
                    onClick={() => navigate(`/align/${rec.id}/${p.id}`)}
                  >
                    <Crosshair size={12} /> {t('camera.align')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Btn onClick={() => navigate(`/camera/${rec.id}`)} data-testid="open-camera">
            <Camera size={18} /> {t('camera.open')}
          </Btn>
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-700/80 px-4 text-sm font-semibold">
            <ImagePlus size={18} /> {t('camera.gallery')}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="gallery-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r2 = await addPhoto(
                  rec,
                  f,
                  {},
                  { quality: settings.photoQuality, keepOriginal: settings.keepOriginal },
                );
                await saveRecord(r2);
                navigate(`/align/${rec.id}/${r2.photos[r2.photos.length - 1].id}`);
              }}
            />
          </label>
        </div>

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

        <BoltCard rec={rec} unit={unit} />

        {progress.length > 0 && (
          <section className="mb-3 rounded-2xl bg-slate-800/60 p-3" data-testid="recipe">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-300">
              {t(`recipe.${rec.recipe}`)}
            </h2>
            {progress.map(({ step, done }, i) => {
              const available = !!TOOL_REGISTRY[step.tool];
              return (
                <div key={i} className="flex min-h-10 items-center gap-2 text-sm">
                  {done ? (
                    <CheckCircle2 size={18} className="text-emerald-400" />
                  ) : (
                    <Circle size={18} className="text-slate-500" />
                  )}
                  <span className="flex-1">{t(step.nameKey)}</span>
                  {!done &&
                    (available ? (
                      <Btn
                        className="min-h-8 px-3 text-xs"
                        onClick={() => measureStep(i)}
                        data-testid={`recipe-step-${i}`}
                      >
                        {t('recipe.measure')}
                      </Btn>
                    ) : (
                      <span className="rounded bg-slate-700 px-1.5 text-[10px] font-bold text-slate-400">
                        P4
                      </span>
                    ))}
                </div>
              );
            })}
          </section>
        )}

        {drawing && (
          <section className="mb-3 rounded-2xl bg-white p-2" data-testid="drawing">
            <div
              className="[&>svg]:h-auto [&>svg]:max-h-72 [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: drawing }}
            />
          </section>
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
            {rec.measurements.map((m) => {
              const r = {
                ...m,
                unit:
                  m.kind === 'angle'
                    ? ('angle' as const)
                    : m.kind === 'area'
                      ? ('area' as const)
                      : ('length' as const),
              };
              return (
                <tr key={m.id} className="border-t border-white/5">
                  <td className="py-2 font-bold text-sky-300">{m.label}</td>
                  <td className="text-slate-300">
                    {t(`kind.${m.kind}`)}
                    {m.tolerance?.result && (
                      <span
                        className={cx(
                          'ml-1 rounded px-1 text-[10px] font-bold',
                          m.tolerance.result === 'pass'
                            ? 'bg-emerald-600'
                            : m.tolerance.result === 'warn'
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-rose-600',
                        )}
                      >
                        {t(`tol.${m.tolerance.result}`)}
                      </span>
                    )}
                    {m.repeats && (
                      <span className="ml-1 text-[10px] text-slate-500">x̄{m.repeats.length}</span>
                    )}
                  </td>
                  <td className="text-right font-semibold">{fmtReadout(r, unit, den)}</td>
                  <td className="text-right text-xs text-slate-400">
                    {(r.unit === 'length' ? fmtU(m.uncertainty, unit) : fmtUFor(r, unit)).slice(1)}
                  </td>
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
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">
          {t('record.calibration')}: {rec.calibrationLabel ?? '—'} ·{' '}
          {new Date(rec.createdAt).toLocaleString()}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Btn
            onClick={async () => {
              const d = duplicateRecord(rec, t('records.copySuffix'));
              await saveRecord(d);
              navigate(`/records/${d.id}`);
            }}
          >
            <Copy size={16} /> {t('records.duplicate')}
          </Btn>
          <Btn onClick={() => navigate(`/records?compare=${rec.id}`)}>
            <GitCompare size={16} /> {t('records.compare')}
          </Btn>
        </div>
        <Btn
          variant="danger"
          className="mt-3 w-full"
          onClick={async () => {
            if (!confirm(t('records.confirmDelete', { name: rec.name }))) return;
            await deleteRecord(rec.id);
            navigate('/records', true);
          }}
        >
          <Trash2 size={16} /> {t('records.delete')}
        </Btn>
      </main>

      <Sheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t('export.title')}
        testId="export-sheet"
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['pdf', 'export.pdf'],
              ['jpg', 'export.jpg'],
              ['png', 'export.png'],
              ['svg', 'export.svg'],
              ['csv', 'export.csv'],
              ['json', 'export.json'],
              ['template-pdf', 'export.templatePdf'],
              ['template-svg', 'export.templateSvg'],
              ['dxf', 'export.dxf'],
              ['match', 'export.match'],
            ] as const
          ).map(([k, label]) => (
            <Btn
              key={k}
              disabled={
                busy ||
                (!views.length && (k === 'svg' || k === 'dxf' || k === 'match' || k.startsWith('template')))
              }
              onClick={() => void run(k)}
              data-testid={`export-${k}`}
            >
              {t(label)}
            </Btn>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">{t('export.hint')}</p>
      </Sheet>
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
      <Field label={t('recipe.partType')}>
        <select
          className={inputCls}
          value={r.recipe ?? 'custom'}
          onChange={(e) => setR({ ...r, recipe: e.target.value as RecipeId })}
          data-testid="recipe-select"
        >
          {(['custom', ...Object.keys(RECIPES)] as RecipeId[]).map((k) => (
            <option key={k} value={k}>
              {t(`recipe.${k}`)}
            </option>
          ))}
        </select>
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
