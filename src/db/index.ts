// IndexedDB via Dexie (§9). Everything stays on the device.
import Dexie, { type Table } from 'dexie';
import type { CalibrationProfile } from '../core/calibration';
import type { FeatureKind, PartRecord, ToolId } from '../core/types';
import type { ReadoutUnit } from '../render/types';

export interface KV {
  key: string;
  value: unknown;
}

export interface HistoryEntry {
  seq?: number;
  createdAt: number;
  toolInstanceId: string;
  tool: ToolId;
  kind: FeatureKind;
  label: string;
  value: number;
  uncertainty: number;
  unit?: ReadoutUnit;
  calibrationId: string;
  toolState: unknown;
}

export interface BlobRow {
  key: string;
  blob: Blob;
}

export class MaapakDB extends Dexie {
  profiles!: Table<CalibrationProfile, string>;
  kv!: Table<KV, string>;
  records!: Table<PartRecord, string>;
  history!: Table<HistoryEntry, number>;
  blobs!: Table<BlobRow, string>;

  constructor(name = 'maapak') {
    super(name);
    this.version(1).stores({
      profiles: 'id, createdAt',
      kv: 'key',
      records: 'id, name, project, updatedAt, *tags',
      history: '++seq, createdAt',
      blobs: 'key',
    });
  }
}

export const db = new MaapakDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await db.kv.get(key))?.value as T | undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await db.kv.put({ key, value });
  } catch {
    /* storage unavailable (private mode) — app keeps working in memory */
  }
}

export const HISTORY_LIMIT = 50;

/** Quick history (§9): last 50 readings; a reading from the same tool within 10 s replaces the previous one. */
export async function pushHistory(e: HistoryEntry): Promise<void> {
  try {
    const last = await db.history.orderBy('seq').last();
    if (last && last.toolInstanceId === e.toolInstanceId && e.createdAt - last.createdAt < 10_000) {
      await db.history.update(last.seq!, { ...e });
    } else {
      await db.history.add(e);
    }
    const n = await db.history.count();
    if (n > HISTORY_LIMIT) {
      const old = await db.history
        .orderBy('seq')
        .limit(n - HISTORY_LIMIT)
        .primaryKeys();
      await db.history.bulkDelete(old);
    }
  } catch {
    /* ignore */
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
