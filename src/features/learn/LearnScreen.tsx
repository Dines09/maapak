import { useTranslation } from 'react-i18next';
import { navigate } from '../../app/router';
import { ScreenHeader, Section } from '../../app/components/ui';

const TOPICS = ['accuracy', 'calibration', 'parallax', 'tools', 'shield', 'limits', 'privacy'] as const;

export function LearnScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <ScreenHeader title={t('nav.learn')} onBack={() => navigate('/')} />
      <main className="mx-auto max-w-lg px-3 pb-12 text-sm leading-relaxed">
        {TOPICS.map((k) => (
          <Section key={k} title={t(`learn.${k}.title`)}>
            <p className="whitespace-pre-line text-slate-300">{t(`learn.${k}.body`)}</p>
          </Section>
        ))}
      </main>
    </div>
  );
}
