# Changelog

## 0.1.0 — Phase 0 + Phase 1 (2026-10-16)

### Phase 0 — Foundation

- Vite 8 + TypeScript (strict) + React 19 + Tailwind 4 + Zustand + Dexie + vite-plugin-pwa + i18next (English, हिंदी).
- HTTPS LAN dev server (`npm run dev`, via `@vitejs/plugin-basic-ssl`), ESLint (no `any` in `core/`), Prettier, Vitest, Playwright (mobile emulation).
- `core/units`: exact 25.4 mm/in, cm, decimal and fractional inch (1/16, 1/32, 1/64) with the fraction error.
- `core/calibration`: device key (orientation-independent), calibration math (card, single axis, combining two axes), estimate profile, the single mm ↔ device-px transform with portrait-axis remapping, the scale guard (pinch zoom, DPR, "Display size", browser), and edge insets remapped on rotation.
- `core/uncertainty`: u = √(u_res² + u_align² + (L·r_cal)² + u_par²), U = 2u rounded up to 1 s.f., decimals = max(0, −⌊log₁₀ U⌋).
- `core/color`: WCAG contrast, OKLab ΔE, best background for an object colour, ink colour of at least 7:1.

### Phase 1 — Precision engine and rulers

- Canvas stage: backing store = CSS size × DPR, dirty-flag rAF loop, crisp 1-device-px lines, independent tick positions (no drift).
- Pointer manager with Ghost Touch Shield (Off / Normal / Strict, large-contact filter), precision mode (second finger → ×0.1, or the ×0.1 toggle), two-finger twist rotate with 15° snaps, long-press handle menu (set zero, type exact value), double-tap → Focus mode, two-finger tap → Undo.
- Loupe while dragging (vector re-render 2–8×, 0.5 mm and 1/64″ sub-ticks, crosshair) and a pinned loupe.
- Rulers: A Classic, B Gap (L × W and area), C Split dual-unit (metric/inch or metric numbered from both ends), D Leapfrog (√N uncertainty growth), E Free / T-square (up to 4 rulers, parallel/perpendicular and end snapping).
- Skins: steel, engineer white, acrylic, classic yellow, night; ticks always at least 7:1 against the body.
- Nudge pad (1 device px or 0.05 mm, long-press repeat, ±0.5° rotation), keyboard arrows, snapping to ticks, handles and angles, haptics with a visual pulse fallback.
- Readout HUD: honest decimals, ±U chip, secondary units and fraction with error, ZERO/INC, HOLD, MIN/MAX, Copy, Speak, Add; draggable and moves away from the active handle.
- Background & contrast: presets, grid/stripes, custom HSV colour, auto background from object colour (OKLab ΔE), light-table mode, remembered per tool.
- Edge Setup: four boundary lines, corner radius, punch-hole exclusions, lock; re-adjust from Settings with an explicit unlock.
- Calibration: ID-1 card, steel rule (both axes, or one axis), any known object ("My references"), verify step with residual, profiles per device, screen-protector setting, confidence label.
- Quick history (last 50, auto-kept), basic records (name, part no., project, tags, notes, measured by, photo compressed to 2048 px JPEG), record list with search, record detail.
- Undo/redo (50 steps), crash-safe session autosave, Wake Lock, fullscreen on Android, PWA offline.
- Welcome → Edges → Calibration → Verify → tour onboarding, every step skippable.

### Known gaps / decisions

- "Lock this handle" from the handle menu is not built yet.
- The ruler tick layer is not cached on an offscreen canvas. Ticks are drawn as two batched paths per ruler, which is already well within the frame budget, and caching rotated bitmaps would break the crisp-line rule.
- Sampling the object colour with the rear camera arrives with the camera work in Phase 3. The swatch wheel and colour picker work now.
- Coin calibration is intentionally missing until coin diameters are verified from official sources (§18).
- The UI chrome uses a dark theme only. The measuring canvas follows the chosen background.
