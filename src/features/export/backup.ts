// Backup / restore: one .maapak.zip with JSON + images (§9). Loaded on demand.
import { db } from '../../db';

interface Manifest {
  format: 'maapak-backup';
  version: 1;
  exportedAt: number;
  counts: { records: number; profiles: number; images: number };
}

export async function exportBackup(): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const [records, profiles, kv, blobs] = await Promise.all([
    db.records.toArray(),
    db.profiles.toArray(),
    db.kv.toArray(),
    db.blobs.toArray(),
  ]);
  zip.file('records.json', JSON.stringify(records));
  zip.file('profiles.json', JSON.stringify(profiles));
  zip.file('kv.json', JSON.stringify(kv.filter((k) => k.key !== 'session')));
  const imgs = zip.folder('images')!;
  for (const b of blobs) imgs.file(`${b.key}.jpg`, b.blob);
  const manifest: Manifest = {
    format: 'maapak-backup',
    version: 1,
    exportedAt: Date.now(),
    counts: { records: records.length, profiles: profiles.length, images: blobs.length },
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 1));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

/** Restore: records, profiles, settings and images are merged (same ids are replaced). */
export async function importBackup(file: Blob): Promise<Manifest['counts']> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const man = JSON.parse((await zip.file('manifest.json')?.async('string')) ?? '{}') as Manifest;
  if (man.format !== 'maapak-backup') throw new Error('Not a Maapak backup');
  const records = JSON.parse((await zip.file('records.json')?.async('string')) ?? '[]');
  const profiles = JSON.parse((await zip.file('profiles.json')?.async('string')) ?? '[]');
  const kv = JSON.parse((await zip.file('kv.json')?.async('string')) ?? '[]');
  let images = 0;
  const imgFiles = zip.folder('images');
  const tasks: Promise<void>[] = [];
  imgFiles?.forEach((path, f) => {
    tasks.push(
      f.async('blob').then(async (blob) => {
        await db.blobs.put({
          key: path.replace(/\.jpg$/, ''),
          blob: new Blob([blob], { type: 'image/jpeg' }),
        });
        images++;
      }),
    );
  });
  await Promise.all(tasks);
  await db.records.bulkPut(records);
  await db.profiles.bulkPut(profiles);
  await db.kv.bulkPut(kv);
  return { records: records.length, profiles: profiles.length, images };
}
