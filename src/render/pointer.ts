// Ghost Touch Shield (§4.6) decisions, kept pure so they can be unit-tested.

export type ShieldMode = 'off' | 'normal' | 'strict';

/** Contacts wider than this (mm) are treated as a palm or an object footprint. */
export const BIG_CONTACT_MM = 14;

export interface ContactInfo {
  pointerType: string;
  /** Contact width/height in mm (0 when the browser does not report it). */
  widthMm: number;
  heightMm: number;
}

/** Large-footprint filter: ignore touches whose contact geometry is palm/object sized. */
export function isBigContact(c: ContactInfo, mode: ShieldMode): boolean {
  if (mode === 'off' || c.pointerType !== 'touch') return false;
  return Math.max(c.widthMm, c.heightMm) > BIG_CONTACT_MM;
}

export type HitKind = 'handle' | 'body' | 'none';

export type ContactRole = 'drag' | 'twist' | 'precision' | 'empty' | 'ignore';

/**
 * Role of a new contact.
 * - Only contacts that START on a handle/body may manipulate a tool (strict: handles only).
 * - While a drag is active, a second contact on the same tool twists it; a fresh contact anywhere else
 *   (that began after the drag started) enables precision mode. Contacts already present when the
 *   drag began (an object resting on the glass) are never promoted.
 */
export function classifyContact(args: {
  mode: ShieldMode;
  big: boolean;
  hit: HitKind;
  sameToolAsDrag: boolean;
  dragActive: boolean;
  locked: boolean;
}): ContactRole {
  const { mode, big, hit, sameToolAsDrag, dragActive, locked } = args;
  if (big) return 'ignore';
  if (dragActive) {
    if (hit !== 'none' && sameToolAsDrag && mode !== 'strict') return 'twist';
    return 'precision';
  }
  if (locked) return hit === 'none' ? 'empty' : 'ignore';
  if (hit === 'handle') return 'drag';
  if (hit === 'body') return mode === 'strict' ? 'ignore' : 'drag';
  return 'empty';
}

/** Precision mode: handle moves at 1/10 of finger speed. */
export const PRECISION_FACTOR = 0.1;
