import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import hi from '../../src/i18n/hi.json';

function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('Hindi has exactly the English keys', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });
  it('keeps interpolation placeholders', () => {
    const flat = (o: object) =>
      Object.fromEntries(
        keys(o).map((k) => [
          k,
          k.split('.').reduce((a: unknown, p) => (a as Record<string, unknown>)[p], o as unknown),
        ]),
      );
    const e = flat(en);
    const h = flat(hi);
    for (const k of Object.keys(e)) {
      const ph = (s: unknown) => (String(s).match(/\{\{\w+\}\}/g) ?? []).sort();
      expect(ph(h[k]), k).toEqual(ph(e[k]));
    }
  });
});
