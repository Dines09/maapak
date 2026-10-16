// Records (§9): basic create / list / update / delete, with compressed photos as Blobs.
import { db } from '../../db';
import { nextLabel, type Measurement, type PartRecord, type PhotoRef } from '../../core/types';
import { newId } from '../../tools/base';
import type { ToolMeasurement } from '../../tools/base';

export async function listRecords(): Promise<PartRecord[]> {
  try {
    return await db.records.orderBy('updatedAt').reverse().toArray();
  } catch {
    return [];
  }
}

export async function getRecord(id: string): Promise<PartRecord | undefined> {
  return db.records.get(id);
}

export async function saveRecord(r: PartRecord): Promise<void> {
  await db.records.put({ ...r, updatedAt: Date.now() });
}

export async function deleteRecord(id: string): Promise<void> {
  const r = await db.records.get(id);
  if (r)
    await db.blobs.bulkDelete(
      r.photos.flatMap((p) => [p.blobKey, p.originalBlobKey].filter((k): k is string => !!k)),
    );
  await db.records.delete(id);
}

/** "Part-01", "Part-02", … */
export async function nextRecordName(prefix = 'Part'): Promise<string> {
  const n = (await db.records.count().catch(() => 0)) + 1;
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

export function blankRecord(name: string): PartRecord {
  const now = Date.now();
  return {
    id: newId('rec'),
    name,
    tags: [],
    measurements: [],
    photos: [],
    drawing: { projection: 'first', views: ['front', 'top'] },
    createdAt: now,
    updatedAt: now,
  };
}

/** Add tool measurements to a record with auto-labels unique within the record (L1, W1, …). */
export function withMeasurements(r: PartRecord, ms: ToolMeasurement[], calibrationId: string): PartRecord {
  const used = r.measurements.map((m) => m.label);
  const added: Measurement[] = ms.map((m) => {
    const label = nextLabel(m.kind, used);
    used.push(label);
    return { ...m, id: newId('m'), recordId: r.id, label, calibrationId, createdAt: Date.now() };
  });
  return { ...r, measurements: [...r.measurements, ...added] };
}

/** Compress to ~2048 px JPEG 0.85 (§9). */
export async function compressImage(
  file: Blob,
  maxPx = 2048,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', quality),
  );
  return { blob, width: w, height: h };
}

export async function addPhoto(r: PartRecord, file: Blob): Promise<PartRecord> {
  const { blob, width, height } = await compressImage(file);
  const key = newId('img');
  await db.blobs.put({ key, blob });
  const photo: PhotoRef = {
    id: newId('ph'),
    blobKey: key,
    width,
    height,
    view: 'free',
    annotations: [],
    takenAt: Date.now(),
  };
  return { ...r, photos: [...r.photos, photo] };
}

export async function photoUrl(key: string): Promise<string | null> {
  const row = await db.blobs.get(key);
  return row ? URL.createObjectURL(row.blob) : null;
}
