# Changelog

## 0.2.0 — Phase 2 + UI redesign (2026-10-16)

### UI redesign (from field feedback)

- **Thin scale.** The ruler is now a 7 mm band instead of a thick rule. Both ends have handles and can be dragged anywhere, so the scale extends in either direction and turns, with snapping to 15° and to 90° against other tools.
- **Solid, high-contrast lines.** Marker lines are solid across the whole usable area, with no dashed parts. They are thick and drawn in the colour with the most contrast against the background, with a 1-device-px coloured centre for exact alignment.
- **Compact reading.** The readout is a small pill with only the value and its ±U. Tap it to open the full panel: ZERO, HOLD, MIN/MAX, TOL, REP, Copy and Add. Speak was removed.
- **Calibration status.** "Not calibrated" is a small ⚠ icon that opens a popover. A banner appears only when measuring is actually blocked.
- **No floating labels.** On-canvas value labels are removed by default. Settings → Display can turn them back on.
- **Layout.** A slim top bar, a vertical action rail on the side (left for left-handed users), and one slim scrollable dock. Tool options open in a compact sheet. All chrome fades while a handle is dragged, so a scale under a menu can still be seen and grabbed. New tools are placed clear of the bars and the rail.
- **L × W replaces T-square.** Four solid lines go around the part, and two thin scales ride on the lines (zero at the left and bottom lines). It gives length, width, area and diagonal in one setup. Split dual-unit mode was removed.
- **Two-finger gap.** Hold two fingers still on empty glass for a moment and two parallel gap rulers appear exactly there. This is off in Strict shield mode.
- **Leapfrog.** A large MARK button with Undo and a running total. Lines ① (start or last mark) and ② (pencil mark here) are labelled on the canvas.
- **Lens.** "Loupe" is now called Lens. The pinned lens can be moved with the arrow pad (or Alt+arrow keys) and zoomed with +/−.

### Phase 2 — Core tools

- Vernier caliper (§6.2):
  - Beam and main scale, with outside jaws (OD, W, L) and inside knife jaws (ID).
  - The vernier plate is rendered from the jaw position, and the coinciding line is highlighted.
  - Least counts 0.1, 0.05 and 0.02 mm, and 0.001″.
  - Vernier, dial and digital skins. The digital readout keeps honest decimals.
  - Thumb wheel and Learn mode, which checks the student's reading and explains it.
  - Laid along the long axis on portrait phones.
- Protractor (§6.3):
  - Half-moon 0–180° with the double scale, and a 360° mode.
  - Ruler arms, plus complementary, supplementary and reflex angles.
  - Snap 0.5/1/5/15°, and an angle uncertainty from the arm lengths.
  - Two-line angle mode (works when the lines meet off-screen).
- Circle / ring (§6.4):
  - Squeeze-to-fit: N/E/S/W sides move independently and the circle re-centres.
  - Centre → radius knob.
  - 3-point and multi-point fits (Kåsa start, then Gauss–Newton) with ovality and RMS.
  - Ring mode with a concentric lock: OD, ID, CS, mean Ø and annulus area.
- Hex overlay (§6.6.1):
  - Squeeze handle on every flat, plus rotation. AF and AC (AF × 2/√3); square-nut mode with diagonal (AF × √2).
  - Nearest metric and inch spanners from sourced tables (`src/data/standards`, every row has `source` and `verified: false`).
  - A metric-vs-inch verdict that says "too close to tell" when it is (e.g. 19 mm vs 3/4″).
- Rectangle / square piece (§6.7):
  - Edge and corner handles, square lock, corner radius and rotation.
  - L, W, diagonal, area and perimeter (corner radius taken into account).
- Polygon (§6.7):
  - Add or remove vertices, open or closed.
  - Shoelace area, perimeter, segment lengths and interior angles.
- Quick shapes (§4.3): hex nut, square nut, O-ring, washer, square piece, rectangle plate, rod/pipe. Nut-Bolt (Bolt Wizard) and Gasket are shown for Phase 4.
- Tolerance go/no-go (§7.5): green when inside by more than U, amber within U of a limit, red when out. Saved with the measurement.
- Repeat & average (§7.7): the random part shrinks with √n, the calibration part does not. The mean, U and samples are saved.

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
