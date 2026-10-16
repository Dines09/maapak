import { defineConfig, devices } from '@playwright/test';

// Uses the installed Microsoft Edge (no browser download needed). CI uses bundled Chromium.
const channel = process.env.CI ? undefined : 'msedge';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    channel,
    baseURL: 'http://localhost:4173/maapak/',
    permissions: ['camera'],
    // Fake camera for the ghost-capture tests.
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/maapak/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
