import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/settings';
import { navigate } from '../../app/router';
import { Btn, Segmented } from '../../app/components/ui';

/** Welcome → Edge Setup → Calibration → Verify → tour → Ready (§5). Every step is skippable. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-slate-100">
      <div className="flex justify-end">
        <Segmented
          size="sm"
          label={t('settings.language')}
          value={s.language}
          onChange={(language) => s.set({ language })}
          options={[
            { value: 'en', label: 'EN' },
            { value: 'hi', label: 'हिं' },
          ]}
        />
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <img
          src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
          alt=""
          className="mb-5 h-20 w-20 rounded-2xl"
        />
        <h1 className="text-3xl font-extrabold">
          Maapak <span className="text-sky-300">मापक</span>
        </h1>
        <p className="mt-2 text-lg text-slate-300">{t('welcome.tagline')}</p>
        <ol className="mt-6 space-y-2 text-sm text-slate-300">
          <li>1. {t('welcome.step1')}</li>
          <li>2. {t('welcome.step2')}</li>
          <li>3. {t('welcome.step3')}</li>
        </ol>
        <p className="mt-6 rounded-xl bg-slate-800/70 p-3 text-xs text-slate-400">{t('welcome.tip')}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Btn
          variant="primary"
          className="min-h-12 text-base"
          onClick={() => navigate('/edges?onboarding=1')}
          data-testid="welcome-start"
        >
          {t('welcome.start')}
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            s.set({ onboarded: true });
            navigate('/', true);
          }}
          data-testid="welcome-skip"
        >
          {t('welcome.skip')}
        </Btn>
      </div>
    </div>
  );
}
