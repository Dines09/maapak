import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the app from /maapak/. Override with BASE=/ for other hosts.
const base = process.env.BASE ?? '/maapak/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? base : '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    // HTTPS on the LAN dev server so camera, sensors and the service worker work on a phone (§17.4).
    ...(command === 'serve' && !isPreview && process.env.HTTP !== '1' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        name: 'Maapak — Precision Measuring Toolkit',
        short_name: 'Maapak',
        description: 'Calibrated on-screen ruler, caliper and measuring tools for field engineers.',
        lang: 'en',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { host: true },
  build: { target: 'es2022', sourcemap: false },
}));
