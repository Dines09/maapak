import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './i18n';
import { App } from './app/App';
import { useSettings } from './state/settings';
import { useCalibration } from './state/calibration';
import { loadModelHint, startEnvWatch } from './state/env';
import { requestPersistence } from './db';

async function boot() {
  await Promise.all([loadModelHint(), useSettings.getState().load(), useCalibration.getState().load()]);
  startEnvWatch();
  void requestPersistence();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (import.meta.env.PROD) registerSW({ immediate: true });
}

void boot();
