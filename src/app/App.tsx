import { Suspense, lazy, useEffect } from 'react';
import i18n from '../i18n';
import { useRoute } from './router';
import { useSettings } from '../state/settings';
import { Toaster } from './components/ui';
import { MeasureScreen } from '../features/measure/MeasureScreen';

// Only the measuring screen is in the core bundle; the rest load on first use (§17.1).
const CalibrateScreen = lazy(() =>
  import('../features/calibration/CalibrateScreen').then((m) => ({ default: m.CalibrateScreen })),
);
const EdgesScreen = lazy(() =>
  import('../features/edges/EdgesScreen').then((m) => ({ default: m.EdgesScreen })),
);
const RecordsScreen = lazy(() =>
  import('../features/records/RecordsScreen').then((m) => ({ default: m.RecordsScreen })),
);
const RecordDetailScreen = lazy(() =>
  import('../features/records/RecordDetailScreen').then((m) => ({ default: m.RecordDetailScreen })),
);
const SettingsScreen = lazy(() =>
  import('../features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);
const LearnScreen = lazy(() =>
  import('../features/learn/LearnScreen').then((m) => ({ default: m.LearnScreen })),
);
const CameraScreen = lazy(() =>
  import('../features/camera/CameraScreen').then((m) => ({ default: m.CameraScreen })),
);
const AlignScreen = lazy(() =>
  import('../features/camera/AlignScreen').then((m) => ({ default: m.AlignScreen })),
);
const WelcomeScreen = lazy(() =>
  import('../features/onboarding/WelcomeScreen').then((m) => ({ default: m.WelcomeScreen })),
);

export function App() {
  const route = useRoute();
  const loaded = useSettings((s) => s.loaded);
  const onboarded = useSettings((s) => s.onboarded);
  const language = useSettings((s) => s.language);

  useEffect(() => {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);

  if (!loaded) return <div className="min-h-dvh bg-slate-950" />;

  let screen: React.ReactNode;
  const [head, id, sub] = route.parts;
  if (!onboarded && !head) screen = <WelcomeScreen />;
  else if (head === 'records') screen = id ? <RecordDetailScreen id={id} /> : <RecordsScreen />;
  else if (head === 'calibrate') screen = <CalibrateScreen />;
  else if (head === 'camera' && id) screen = <CameraScreen recordId={id} />;
  else if (head === 'align' && id && sub) screen = <AlignScreen recordId={id} photoId={sub} />;
  else if (head === 'edges') screen = <EdgesScreen />;
  else if (head === 'settings') screen = <SettingsScreen />;
  else if (head === 'learn') screen = <LearnScreen />;
  else screen = <MeasureScreen />;

  return (
    <>
      <Suspense fallback={<div className="min-h-dvh bg-slate-950" />}>{screen}</Suspense>
      <Toaster />
    </>
  );
}
