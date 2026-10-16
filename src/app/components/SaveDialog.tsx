import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera } from 'lucide-react';
import type { PartRecord } from '../../core/types';
import type { FractionDenominator, LengthUnit } from '../../core/units';
import type { ToolMeasurement } from '../../tools/base';
import {
  addPhoto,
  blankRecord,
  listRecords,
  nextRecordName,
  saveRecord,
  withMeasurements,
} from '../../features/records/repo';
import { useSettings } from '../../state/settings';
import { fmtReadout } from './ReadoutHud';
import { Btn, Field, Segmented, Sheet, inputCls, useToast } from './ui';
import { RECIPES, type RecipeId } from '../../features/records/recipes';
import { fmtU } from './ReadoutHud';

export function SaveDialog({
  open,
  onClose,
  measurements,
  calibrationId,
  calibrationLabel,
  unit,
  den,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  measurements: ToolMeasurement[];
  calibrationId: string;
  calibrationLabel: string;
  unit: LengthUnit;
  den: FractionDenominator;
  onSaved?: (r: PartRecord) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const measuredByDefault = useSettings((s) => s.measuredBy);
  const setSettings = useSettings((s) => s.set);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [records, setRecords] = useState<PartRecord[]>([]);
  const [targetId, setTargetId] = useState('');
  const [name, setName] = useState('');
  const [partNo, setPartNo] = useState('');
  const [project, setProject] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [by, setBy] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [recipe, setRecipe] = useState<RecipeId>('custom');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // The default name arrives async: never overwrite what the user has typed meanwhile.
    setName('');
    void nextRecordName().then((n) => setName((cur) => cur || n));
    void listRecords().then((r) => {
      setRecords(r.slice(0, 30));
      setTargetId(r[0]?.id ?? '');
    });
    setBy(measuredByDefault);
    setPhoto(null);
  }, [open, measuredByDefault]);

  const save = async () => {
    setBusy(true);
    try {
      let r: PartRecord;
      if (mode === 'existing' && targetId) {
        const found = records.find((x) => x.id === targetId);
        if (!found) throw new Error('missing');
        r = found;
      } else {
        r = {
          ...blankRecord(name.trim() || (await nextRecordName())),
          partNo: partNo.trim() || undefined,
          project: project.trim() || undefined,
          tags: tags
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          notes: notes.trim() || undefined,
          measuredBy: by.trim() || undefined,
          calibrationLabel,
          recipe: recipe === 'custom' ? undefined : recipe,
        };
      }
      r = withMeasurements(r, measurements, calibrationId);
      if (photo) r = await addPhoto(r, photo);
      await saveRecord(r);
      if (by.trim() && by.trim() !== measuredByDefault) setSettings({ measuredBy: by.trim() });
      toast(t('save.saved', { name: r.name }));
      onSaved?.(r);
      onClose();
    } catch {
      toast(t('save.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('save.title')} testId="save-dialog">
      <div className="mb-3 rounded-xl bg-slate-800 p-2 text-sm">
        {measurements.length === 0 && <p className="text-slate-400">{t('save.nothing')}</p>}
        {measurements.map((m, i) => (
          <div key={i} className="tabular flex justify-between py-0.5">
            <span className="text-slate-400">{t(`kind.${m.kind}`)}</span>
            <span className="font-semibold">
              {fmtReadout({ ...m, unit: 'length' }, unit, den)}{' '}
              <span className="text-xs text-slate-400">{fmtU(m.uncertainty, unit)}</span>
            </span>
          </div>
        ))}
      </div>
      <Segmented
        label={t('save.target')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'new', label: t('save.newRecord') },
          { value: 'existing', label: t('save.existing') },
        ]}
      />
      {mode === 'existing' ? (
        <Field label={t('save.record')}>
          {records.length ? (
            <select className={inputCls} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.measurements.length})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-400">{t('save.noRecords')}</p>
          )}
        </Field>
      ) : (
        <>
          <Field label={t('record.name')}>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="save-name"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('record.partNo')}>
              <input className={inputCls} value={partNo} onChange={(e) => setPartNo(e.target.value)} />
            </Field>
            <Field label={t('record.project')}>
              <input className={inputCls} value={project} onChange={(e) => setProject(e.target.value)} />
            </Field>
          </div>
          <Field label={t('recipe.partType')}>
            <select
              className={inputCls}
              value={recipe}
              onChange={(e) => setRecipe(e.target.value as RecipeId)}
              data-testid="save-recipe"
            >
              {(['custom', ...Object.keys(RECIPES)] as RecipeId[]).map((k) => (
                <option key={k} value={k}>
                  {t(`recipe.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('record.tags')}>
            <input
              className={inputCls}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="bolt, pump-3"
            />
          </Field>
          <Field label={t('record.measuredBy')}>
            <input className={inputCls} value={by} onChange={(e) => setBy(e.target.value)} />
          </Field>
          <Field label={t('record.notes')}>
            <textarea
              className={`${inputCls} min-h-16 py-2`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </>
      )}
      <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-slate-800 px-3 text-sm">
        <Camera size={18} />
        <span className="flex-1">{photo ? photo.name : t('save.addPhoto')}</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className="mt-1 text-xs text-slate-500">{t('save.photoNote')}</p>
      <div className="mt-4 flex gap-2">
        <Btn variant="ghost" className="flex-1" onClick={onClose}>
          {t('common.cancel')}
        </Btn>
        <Btn
          variant="primary"
          className="flex-1"
          disabled={busy || measurements.length === 0 || (mode === 'existing' && !targetId)}
          onClick={save}
          data-testid="save-confirm"
        >
          {t('common.save')}
        </Btn>
      </div>
    </Sheet>
  );
}
