import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/settings';
import { useCalibration } from '../../state/calibration';
import { db } from '../../db';
import { navigate } from '../../app/router';
import { SKIN_IDS } from '../../render/skins';
import { formatNumber } from '../../core/units';
import { Btn, ScreenHeader, Section, Segmented, Toggle } from '../../app/components/ui';

export function SettingsScreen() {
  const { t } = useTranslation();
  const s = useSettings();
  const cal = useCalibration();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  const clearAll = async () => {
    if (!confirm(t('settings.confirmClear'))) return;
    await db.delete();
    localStorage.clear();
    location.reload();
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader title={t('nav.settings')} onBack={() => navigate('/')} />
      <main className="mx-auto max-w-lg px-3 pb-12">
        <Section title={t('settings.units')}>
          <Row label={t('settings.defaultUnit')}>
            <Segmented
              size="sm"
              label={t('settings.defaultUnit')}
              value={s.unit}
              onChange={(unit) => s.set({ unit })}
              options={[
                { value: 'mm', label: 'mm' },
                { value: 'cm', label: 'cm' },
                { value: 'in', label: 'in' },
                { value: 'in-frac', label: 'in ⅛' },
              ]}
            />
          </Row>
          <Row label={t('settings.fraction')}>
            <Segmented
              size="sm"
              label={t('settings.fraction')}
              value={s.fractionDen}
              onChange={(fractionDen) => s.set({ fractionDen })}
              options={[
                { value: 16, label: '1/16' },
                { value: 32, label: '1/32' },
                { value: 64, label: '1/64' },
              ]}
            />
          </Row>
          <Toggle
            label={t('settings.secondary')}
            checked={s.secondaryUnits}
            onChange={(v) => s.set({ secondaryUnits: v })}
          />
          <Toggle
            label={t('settings.showRaw')}
            hint={t('settings.showRawHint')}
            checked={s.showRaw}
            onChange={(v) => s.set({ showRaw: v })}
          />
        </Section>

        <Section title={t('settings.calibration')}>
          <p className="mb-2 text-xs text-slate-400">
            {t('settings.profilesCount', { n: cal.profiles.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => navigate('/calibrate')}>{t('settings.recalibrate')}</Btn>
          </div>
        </Section>

        <Section title={t('settings.edges')}>
          <p className="mb-2 text-xs text-slate-400">{t('settings.edgesHint')}</p>
          <Btn onClick={() => navigate('/edges')} data-testid="settings-edges">
            {t('settings.adjustEdges')}
          </Btn>
        </Section>

        <Section title={t('settings.display')}>
          <Row label={t('settings.skin')}>
            <select
              className="min-h-10 rounded-lg bg-slate-700 px-2 text-sm"
              value={s.skin}
              onChange={(e) => s.set({ skin: e.target.value as typeof s.skin })}
            >
              {SKIN_IDS.map((k) => (
                <option key={k} value={k}>
                  {t(`skin.${k}`)}
                </option>
              ))}
            </select>
          </Row>
          <Toggle
            label={t('settings.largeHandles')}
            hint={t('settings.largeHandlesHint')}
            checked={s.largeHandles}
            onChange={(v) => s.set({ largeHandles: v })}
          />
          <Toggle
            label={t('settings.leftHanded')}
            checked={s.leftHanded}
            onChange={(v) => s.set({ leftHanded: v })}
          />
          <Toggle label={t('settings.loupe')} checked={s.loupe} onChange={(v) => s.set({ loupe: v })} />
          <Row label={t('settings.loupeZoom')}>
            <Segmented
              size="sm"
              label={t('settings.loupeZoom')}
              value={s.loupeZoom}
              onChange={(loupeZoom) => s.set({ loupeZoom })}
              options={[2, 4, 6, 8].map((z) => ({ value: z, label: `${z}×` }))}
            />
          </Row>
        </Section>

        <Section title={t('settings.behaviour')}>
          <Toggle
            label={t('settings.snapTicks')}
            checked={s.snapTicks}
            onChange={(v) => s.set({ snapTicks: v })}
          />
          <Toggle
            label={t('settings.snapHalf')}
            checked={s.snapHalfMm}
            onChange={(v) => s.set({ snapHalfMm: v })}
          />
          <Toggle
            label={t('settings.snapHandles')}
            checked={s.snapHandles}
            onChange={(v) => s.set({ snapHandles: v })}
          />
          <Toggle
            label={t('settings.snapAngles')}
            checked={s.snapAngles}
            onChange={(v) => s.set({ snapAngles: v })}
          />
          <Toggle label={t('settings.haptics')} checked={s.haptics} onChange={(v) => s.set({ haptics: v })} />
          <Row label={t('settings.shield')}>
            <Segmented
              size="sm"
              label={t('settings.shield')}
              value={s.shield}
              onChange={(shield) => s.set({ shield })}
              options={[
                { value: 'off', label: t('settings.off') },
                { value: 'normal', label: t('settings.normal') },
                { value: 'strict', label: t('settings.strict') },
              ]}
            />
          </Row>
          <p className="text-xs text-slate-400">{t('settings.shieldHint')}</p>
          <Row label={t('settings.nudgeStep')}>
            <Segmented
              size="sm"
              label={t('settings.nudgeStep')}
              value={s.nudgeStep}
              onChange={(nudgeStep) => s.set({ nudgeStep })}
              options={[
                { value: 'px', label: t('settings.onePixel') },
                { value: '0.05', label: '0.05 mm' },
              ]}
            />
          </Row>
          <Toggle
            label={t('settings.keepOn')}
            checked={s.keepScreenOn}
            onChange={(v) => s.set({ keepScreenOn: v })}
          />
          <Toggle
            label={t('settings.fullscreen')}
            hint={t('settings.fullscreenHint')}
            checked={s.fullscreen}
            onChange={(v) => s.set({ fullscreen: v })}
          />
        </Section>

        <Section title={t('settings.language')}>
          <Segmented
            label={t('settings.language')}
            value={s.language}
            onChange={(language) => s.set({ language })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'hi', label: 'हिंदी' },
            ]}
          />
        </Section>

        <Section title={t('settings.data')}>
          {usage && (
            <p className="tabular text-sm text-slate-300">
              {t('settings.storage', {
                used: formatNumber(usage.used / 1e6, 1),
                quota: formatNumber(usage.quota / 1e6, 0),
              })}
            </p>
          )}
          {persisted !== null && (
            <p className="text-xs text-slate-400">
              {persisted ? t('settings.persisted') : t('settings.notPersisted')}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">{t('settings.backupLater')}</p>
          <Btn variant="danger" className="mt-3" onClick={() => void clearAll()}>
            {t('settings.clear')}
          </Btn>
        </Section>

        <Section title={t('settings.about')}>
          <p className="text-sm text-slate-300">Maapak (मापक) v{__APP_VERSION__}</p>
          <p className="mt-1 text-xs text-slate-400">{t('settings.privacy')}</p>
          <Btn variant="ghost" className="mt-2 px-0" onClick={() => navigate('/learn')}>
            {t('nav.learn')} →
          </Btn>
        </Section>
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-1">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}
