import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun } from 'lucide-react';
import { BG_PRESETS, SOLID_BG_COLORS, type BackgroundSpec } from '../../render/background';
import { bestBackgroundFor, contrastRatio, deltaE, hsvToHex } from '../../core/color';
import { Btn, Sheet, cx, useToast } from './ui';

/** Typical part colours for auto-contrast (§8). */
const OBJECT_COLORS: { id: string; hex: string }[] = [
  { id: 'black', hex: '#141414' },
  { id: 'darkGrey', hex: '#4a4d50' },
  { id: 'steel', hex: '#a8adb3' },
  { id: 'white', hex: '#f4f4f2' },
  { id: 'brass', hex: '#c9a64b' },
  { id: 'copper', hex: '#b5652d' },
  { id: 'red', hex: '#c62828' },
  { id: 'orange', hex: '#ef6c00' },
  { id: 'yellow', hex: '#f2cc28' },
  { id: 'green', hex: '#2e7d32' },
  { id: 'blue', hex: '#1565c0' },
  { id: 'brown', hex: '#5d4037' },
];

export function nextPreset(current: BackgroundSpec): BackgroundSpec {
  const i = BG_PRESETS.findIndex((p) => p.spec.color === current.color && p.spec.pattern === current.pattern);
  return { ...BG_PRESETS[(i + 1) % BG_PRESETS.length].spec };
}

export function BackgroundPanel({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: BackgroundSpec;
  onChange: (b: BackgroundSpec) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const [h, setH] = useState(200);
  const [sat, setSat] = useState(0.6);
  const [v, setV] = useState(0.9);
  const custom = hsvToHex(h, sat, v);

  const auto = (obj: string, name: string) => {
    const bg = bestBackgroundFor(obj, SOLID_BG_COLORS);
    onChange({ color: bg, pattern: 'none' });
    const preset = BG_PRESETS.find((p) => p.spec.color === bg && p.spec.pattern === 'none');
    toast(
      t('bg.autoChosen', { obj: name, bg: preset ? t(preset.labelKey) : bg, de: deltaE(obj, bg).toFixed(2) }),
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('bg.title')} testId="bg-panel">
      <p className="mb-2 text-xs text-slate-400">{t('bg.presets')}</p>
      <div className="grid grid-cols-4 gap-2">
        {BG_PRESETS.map((p) => {
          const on = p.spec.color === value.color && p.spec.pattern === value.pattern && !value.lightTable;
          return (
            <button
              key={p.id}
              onClick={() => onChange({ ...p.spec })}
              className={cx(
                'flex flex-col items-center gap-1 rounded-xl p-1.5 text-[11px]',
                on ? 'bg-sky-500/30 ring-2 ring-sky-400' : 'bg-slate-800',
              )}
            >
              <span
                className="h-9 w-full rounded-lg border border-white/20"
                style={{
                  background:
                    p.spec.pattern === 'grid'
                      ? `repeating-linear-gradient(0deg,#ccc 0 1px,transparent 1px 8px),repeating-linear-gradient(90deg,#ccc 0 1px,#fff 1px 8px)`
                      : p.spec.pattern === 'stripes'
                        ? 'repeating-linear-gradient(45deg,#ccc 0 2px,#fff 2px 7px)'
                        : p.spec.color,
                }}
              />
              {t(p.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">{t('bg.lightTable')}</span>
          <Btn
            variant={value.lightTable ? 'primary' : 'default'}
            onClick={() => {
              onChange({ color: '#ffffff', pattern: 'none', lightTable: !value.lightTable });
              if (!value.lightTable) toast(t('bg.brightnessTip'));
            }}
          >
            <Sun size={16} /> {value.lightTable ? t('common.on') : t('common.off')}
          </Btn>
        </div>
        <p className="text-xs text-slate-400">{t('bg.lightTableHint')}</p>
      </div>

      <p className="mb-2 mt-4 text-xs text-slate-400">{t('bg.objectColour')}</p>
      <div className="grid grid-cols-6 gap-2">
        {OBJECT_COLORS.map((o) => (
          <button
            key={o.id}
            aria-label={t(`obj.${o.id}`)}
            title={t(`obj.${o.id}`)}
            onClick={() => auto(o.hex, t(`obj.${o.id}`))}
            className="flex flex-col items-center gap-1 text-[10px] text-slate-300"
          >
            <span className="h-9 w-9 rounded-full border-2 border-white/30" style={{ background: o.hex }} />
            {t(`obj.${o.id}`)}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
        {t('bg.pickObject')}
        <input
          type="color"
          className="h-9 w-14 rounded"
          onChange={(e) => auto(e.target.value, e.target.value)}
        />
      </label>

      <p className="mb-1 mt-4 text-xs text-slate-400">{t('bg.custom')}</p>
      <div className="space-y-1 rounded-xl bg-slate-800 p-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="w-16">{t('bg.hue')}</span>
          <input
            type="range"
            min={0}
            max={360}
            value={h}
            onChange={(e) => setH(Number(e.target.value))}
            className="flex-1"
            style={{ background: 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)' }}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-16">{t('bg.saturation')}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(sat * 100)}
            onChange={(e) => setSat(Number(e.target.value) / 100)}
            className="flex-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-16">{t('bg.brightness')}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(v * 100)}
            onChange={(e) => setV(Number(e.target.value) / 100)}
            className="flex-1"
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <span className="h-9 flex-1 rounded-lg border border-white/20" style={{ background: custom }} />
          <span className="tabular text-slate-400">
            {t('bg.inkContrast')}{' '}
            {Math.max(contrastRatio(custom, '#000'), contrastRatio(custom, '#fff')).toFixed(1)}:1
          </span>
          <Btn variant="primary" onClick={() => onChange({ color: custom, pattern: 'none' })}>
            {t('common.apply')}
          </Btn>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{t('bg.brightnessNote')}</p>
    </Sheet>
  );
}
