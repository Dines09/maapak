// Undo/redo (50 steps) and crash-safe autosave of the measuring session (§4.10).
import { kvGet, kvSet } from '../db';

export const UNDO_LIMIT = 50;

export class UndoStack {
  private undoList: string[] = [];
  private redoList: string[] = [];
  current: string | null = null;

  reset(snapshot: string): void {
    this.undoList = [];
    this.redoList = [];
    this.current = snapshot;
  }

  /** Record a new state; returns false if nothing changed. */
  push(snapshot: string): boolean {
    if (snapshot === this.current) return false;
    if (this.current !== null) {
      this.undoList.push(this.current);
      if (this.undoList.length > UNDO_LIMIT) this.undoList.shift();
    }
    this.current = snapshot;
    this.redoList = [];
    return true;
  }

  undo(): string | null {
    const prev = this.undoList.pop();
    if (prev === undefined || this.current === null) return null;
    this.redoList.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.redoList.pop();
    if (next === undefined || this.current === null) return null;
    this.undoList.push(this.current);
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.undoList.length > 0;
  }
  get canRedo(): boolean {
    return this.redoList.length > 0;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function autosave(snapshot: string): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void kvSet('session', snapshot), 400);
}

export async function loadSession(): Promise<string | undefined> {
  return kvGet<string>('session');
}
