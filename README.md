# Maapak (मापक) — precision measuring toolkit for mobile

**Live app:** https://dines09.github.io/maapak/

Maapak is an installable web app (PWA) that turns a phone screen into a calibrated measuring kit for field engineers:

- thin ruler (both ends extend), L × W box, gap rulers and leapfrog chain
- vernier caliper (with Learn mode), protractor and two-line angle
- circle / O-ring / washer fits, hex nut with spanner suggestion, rectangle and polygon area

Every reading shows its uncertainty and never shows more decimals than the phone can deliver. Everything stays on the device and works offline.

The full product specification is in [MAAPAK_SPEC.md](MAAPAK_SPEC.md). Phases 0, 1 and 2 are built. See [CHANGELOG.md](CHANGELOG.md).

## Using it

1. Open the live link on an Android phone in Chrome (iPhone: Safari). Choose **Install** / *Add to Home Screen* for a full-screen app.
2. **Set up:** mark the flat part of the screen (curved edges, punch-hole), then calibrate with any bank/ID card or, for the best accuracy, a steel rule.
3. Put the part on the screen and drag the round knobs so the thick lines touch its edges. Drag the small ⇔ knobs at the ends to stretch or turn the scale. A lens magnifies the edge while you drag. Hold a second finger anywhere for ×0.1 precision.
4. The reading sits in a small pill at the top. Tap it for ZERO, HOLD, tolerance, repeat & average and Save.
5. Hold two fingers still on empty glass to drop two parallel rulers right there.

Before calibration a small **⚠** sits in the top bar (estimate only). If the display scale changes (browser zoom, Android "Display size"), measuring is disabled until you recalibrate.

## Development

Node 20.19 or newer.

```bash
npm install
npm run dev        # HTTPS dev server on the LAN; open https://<pc-ip>:5173 on the phone
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run e2e        # Playwright end-to-end tests (mobile emulation, uses installed Microsoft Edge)
npm run lint
npm run format
```

Debug Android through `chrome://inspect`.

### Layout

| Folder | Contents |
|---|---|
| `src/core/` | Pure math: units, calibration, uncertainty, colour, geometry |
| `src/render/` | Canvas stage, pointer manager / Ghost Touch Shield, loupe, ticks, skins |
| `src/tools/` | Measuring tools; each implements the `ToolInstance` interface |
| `src/features/` | Screens: measure, calibration, edges, records, settings, learn |
| `src/state/`, `src/db/` | Zustand stores and IndexedDB (Dexie) |
| `src/i18n/` | English and Hindi strings |
| `tests/unit`, `tests/e2e` | Vitest and Playwright tests; `tests/PHYSICAL.md` is the manual test protocol |

### Publishing

A push to `main` runs lint, type-check and unit tests, builds the app and deploys it to GitHub Pages (`.github/workflows/deploy.yml`).
