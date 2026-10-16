// Shared export helpers: Web Share with download fallback (§12), CSV, JSON, photo blobs.
import type { Measurement, PartRecord, PhotoRef } from '../../core/types';
import { formatNumber, fromMm, type LengthUnit } from '../../core/units';
import { decimalsFor } from '../../core/uncertainty';
import { db } from '../../db';

export async function shareOrDownload(
  blob: Blob,
  filename: string,
  title = 'Maapak',
): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'shared';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}

export function safeName(s: string): string {
  return (s || 'record').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60);
}

/** Value in the display unit with honest decimals (angles in degrees, areas in unit²). */
export function valueText(
  m: Pick<Measurement, 'kind' | 'value' | 'uncertainty'>,
  unit: LengthUnit,
): { v: string; u: string; unit: string } {
  const lu = unit === 'in-frac' ? 'in' : unit;
  if (m.kind === 'angle') {
    const d = m.uncertainty > 0 ? Math.min(1, Math.max(0, -Math.floor(Math.log10(m.uncertainty)))) : 1;
    return { v: formatNumber(m.value, d), u: formatNumber(m.uncertainty, d), unit: '°' };
  }
  if (m.kind === 'area') {
    const k = fromMm(1, lu) ** 2;
    const U = m.uncertainty * k;
    const d = U > 0 ? Math.min(4, Math.max(0, -Math.floor(Math.log10(U)))) : 1;
    return { v: formatNumber(m.value * k, d), u: formatNumber(U, d), unit: `${lu}²` };
  }
  const d = m.uncertainty > 0 ? decimalsFor(m.uncertainty, lu) : lu === 'mm' ? 1 : 3;
  return { v: formatNumber(fromMm(m.value, lu), d), u: formatNumber(fromMm(m.uncertainty, lu), d), unit: lu };
}

const csvCell = (s: string | number | undefined) => {
  const t = s === undefined ? '' : String(s);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Dimension table as CSV (single record or batch). Numbers use "." and plain ASCII minus. */
export function recordsToCsv(records: PartRecord[], unit: LengthUnit): string {
  const head = [
    'record',
    'part_no',
    'project',
    'tags',
    'label',
    'feature',
    'value',
    'U',
    'unit',
    'tol_nominal',
    'tol_lower',
    'tol_upper',
    'result',
    'repeats',
    'measured_by',
    'date',
    'calibration',
  ];
  const rows = [head.join(',')];
  for (const r of records) {
    for (const m of r.measurements) {
      const vt = valueText(m, unit);
      const tol = m.tolerance;
      const tv = (x?: number) =>
        x === undefined
          ? ''
          : m.kind === 'angle'
            ? formatNumber(x, 2)
            : formatNumber(fromMm(x, unit === 'in-frac' ? 'in' : unit), 3);
      rows.push(
        [
          r.name,
          r.partNo,
          r.project,
          r.tags.join(' '),
          m.label,
          m.kind,
          vt.v.replace('−', '-'),
          vt.u.replace('−', '-'),
          vt.unit,
          tv(tol?.nominal),
          tv(tol?.lower),
          tv(tol?.upper),
          tol?.result,
          m.repeats?.length,
          r.measuredBy,
          new Date(m.createdAt).toISOString(),
          r.calibrationLabel,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return rows.join('\n') + '\n';
}

export async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  });
}

export async function dataUrlToBlob(u: string): Promise<Blob> {
  return (await fetch(u)).blob();
}

export interface RecordFile {
  format: 'maapak-record';
  version: 1;
  record: PartRecord;
  photos: { key: string; dataUrl: string }[];
}

/** Full record as JSON, photos embedded (re-importable, §12). */
export async function recordToJson(r: PartRecord): Promise<string> {
  const photos: RecordFile['photos'] = [];
  for (const p of r.photos) {
    const row = await db.blobs.get(p.blobKey);
    if (row) photos.push({ key: p.blobKey, dataUrl: await blobToDataUrl(row.blob) });
  }
  const file: RecordFile = { format: 'maapak-record', version: 1, record: r, photos };
  return JSON.stringify(file, null, 1);
}

export function isRecordFile(x: unknown): x is RecordFile {
  const o = x as RecordFile;
  return !!o && o.format === 'maapak-record' && !!o.record && Array.isArray(o.record.measurements);
}

/** Import a record JSON; a record with the same id gets a new id instead of overwriting. */
export async function importRecordJson(text: string, newId: () => string): Promise<PartRecord> {
  const data: unknown = JSON.parse(text);
  if (!isRecordFile(data)) throw new Error('Not a Maapak record file');
  let rec = data.record;
  if (await db.records.get(rec.id)) rec = { ...rec, id: newId(), name: `${rec.name} (import)` };
  for (const p of data.photos) await db.blobs.put({ key: p.key, blob: await dataUrlToBlob(p.dataUrl) });
  rec = { ...rec, updatedAt: Date.now() };
  await db.records.put(rec);
  return rec;
}

export function photoForSheet(r: PartRecord): PhotoRef | undefined {
  return r.photos.find((p) => p.ghostToPhoto) ?? r.photos[0];
}
