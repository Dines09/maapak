# Maapak (मापक) — Precision Measuring Toolkit for Mobile

### Product & Technical Specification · v1.0 · written for implementation with Claude Code

> **Working name:** Maapak (Hindi "मापक" = measurer). Rename freely.
> **Type:** Mobile-first Progressive Web App (PWA), installable, works offline.
> **Primary target:** Android (Chrome, Samsung Internet). **Secondary:** iOS Safari, tablets.
> **Users:** Field engineers (mechanical, electrical, civil), technicians, maintenance staff, purchase/stores staff, students.

---

## 0. Instructions for Claude Code (read first)

1. Read this entire file before writing any code. Build in the phases in **§20**. Finish, test and commit a phase before starting the next.
2. The **Accuracy Invariants in §3 are non-negotiable.** If any design choice conflicts with them, stop and ask.
3. **Never invent engineering-standard values** (O-ring sizes, nut sizes, gauges, flanges). Use the values in **§18** (verify each before release) or source them from the actual standard. Every row in `src/data/standards/*.json` must carry a `source` field. If unsure, leave it out and add a `TODO`.
4. **Mobile first.** Design at a 360×800 CSS-px viewport. Test on a real Android phone over HTTPS (see §17.4).
5. Keep the core small and fast. **Lazy-load** heavy modules (camera vision, PDF export, ArUco, OpenCV).
6. Every measuring tool implements the shared **`ToolInstance` interface (§16.3)**. That single interface is what makes a tool automatically work with the readout, records, the camera ghost overlay, and the engineering drawing. Do not build tools as one-offs.
7. Write unit tests for all math (§19). Keep a `CHANGELOG.md`. Tick the checklist boxes in §20 as features land.
8. All UI strings go through i18n from day one (English + हिंदी).

### 0.1 Requirement traceability (original brief → section)

| # | Original requirement (from the brief) | Where |
|---|---|---|
| 1 | Dynamic ruler, user can drag/extend it as far as the screen allows | §6.1 |
| 2 | Curved screen edges: user drags ruler borders inward, then they **lock**; re-adjust only from Settings | §5.1 |
| 3 | Units: mm, cm, inch | §4.4, §7, §14 |
| 4 | Place any object (rectangle, cuboid, bolt…) on screen and measure length, breadth, width | §6.1, §6.2, §6.7 |
| 5 | Colour science: user changes background so a black bolt is not on black, white on white, etc. | §8 |
| 6 | Ruler modes: single, two-sided (top+bottom with live numbers between), split (one up, one down), plus innovative ones | §6.1 |
| 7 | Angles 0–180° | §6.3 |
| 8 | Circles for O-rings: draw from centre, **or** start big and squeeze in from all four sides onto the ring; ID and OD | §6.4 |
| 9 | Rings, O-rings, gaskets, washers | §6.4, §6.5 |
| 10 | Nut-bolt: capture length, then head (hexagonal); tool icons for nut-bolt, O-ring, square piece, gasket | §4.3, §6.6 |
| 11 | Save as photo / screenshot | §9, §12 |
| 12 | Level (gyroscope/accelerometer) — after the scale tools | §6.9, Phase 4 |
| 13 | Scales must look like real, original, high-accuracy scales | §4.5 |
| 14 | Vernier caliper mode with outer and inner measurement | §6.2 |
| 15 | Zoom to see scale borders clearly | §7.1 |
| 16 | Errors from viewing angle (side vs top view) — innovative correction | §2.3, §7.8 |
| 17 | Calibration mode using any known object | §5.2 |
| 18 | Save measurements with name and photo; photo on top, dimensions below; dimensions drawn on the photo like an engineering drawing (EGD) — OD, ID, distances | §9, §11 |
| 19 | Export to PDF, JPG / image | §12 |
| 20 | Camera mode: measured shape appears as a guide on the viewfinder; user aligns object; guide turns **green** when matched | §10 |
| 21 | Fast, lag-free, reliable, error-free, innovative | §16, §17, §19 |
| 22 | Web app so it runs on Android, iOS, any phone; Android is the primary focus | §2, §17.3 |

---

## 1. Vision

A field engineer opens one app and gets a **complete pocket metrology kit**: steel rule, vernier caliper, protractor, O-ring and gasket sizer, nut-bolt identifier, thread gauge, radius gauge, wire gauge, level and inclinometer. Every reading is **honest about its accuracy**, can be **saved with a photo**, turned into a clean **engineering-style dimensioned sheet**, and **exported as PDF/JPG/DXF** — fully offline, on any phone.

**Design pillars**

1. **Trustworthy accuracy** — calibrated, uncertainty shown, never fake precision.
2. **Built for fingers and fields** — big handles, loupe, fine-adjust, works with one hand, in sunlight, offline.
3. **Measure → Identify → Document** — not just a number: "this is an M8×1.25×40 hex bolt, 13 AF", with a drawing and photo.
4. **Instant** — opens in under 2 seconds, drags at full frame rate.

---

## 2. The physics of measuring on a phone screen (why the design looks like this)

### 2.1 Browsers do not know physical size
- CSS physical units are fake: `1in` is always 96 CSS px, whatever the screen. **Never use CSS `mm/cm/in` for measuring.**
- `devicePixelRatio` maps CSS px → device px, but **device pixels per millimetre are unknown** (phones range roughly 300–550 ppi).
- Therefore **calibration is mandatory**. The scale is stored as **device pixels per mm** for each physical screen axis.
- Before calibration, use a rough estimate: on Android 1 CSS px ≈ 1/160 inch ≈ 0.159 mm (can be off by 15–20%). Show a persistent **"Not calibrated — estimate only"** banner until calibrated.

### 2.2 Resolution limit
- One device pixel ≈ 0.05–0.08 mm. With the loupe, realistic alignment is about **±0.1–0.3 mm**. The app must never display more decimals than it can deliver (§7.6).

### 2.3 Parallax (viewing-angle error)
- Pixels sit under the cover glass (plus any screen protector). Apparent depth ≈ t / n (glass n ≈ 1.5). Error ≈ (t / n) · tan θ. Example: t = 1.0 mm, θ = 30° → ≈ 0.38 mm.
- The **bigger** source is **tall objects**: if the user aligns to the *top* edge of an object of height h instead of its base, error ≈ h · tan θ (a 10 mm tall bolt head viewed at 20° → ≈ 3.6 mm).
- When both edges of a feature are viewed at the same angle, both shift the same way and the error largely cancels for widths — so the fix is to view **straight down over the centre of the feature**.
- Mitigations built into the app: top-down coaching, edge sighting lines, loupe, footprint guidance, screen-protector setting, and an experimental eye-position assist (§7.8).

### 2.4 Touch with objects on the screen
- Metal objects (bolts, nuts) can create **phantom touches** on capacitive screens, especially when also touched by a hand → **Ghost Touch Shield** (§4.6).
- Fingers cover the edge being aligned → handles are **offset** from the finger and a **loupe** shows the hidden area (§7.1).
- Hard objects can scratch screens → one-time gentle-placement tip.

### 2.5 Curved edges, rounded corners, notches, punch-holes
- Usable flat area differs per phone → **Edge Setup** (§5.1), locked after setting.

### 2.6 Things that silently break the scale
- Browser pinch-zoom, Android "Display size" change, browser change, moving to another device. The app detects all of these (§3, item 7).

---

## 3. Accuracy Invariants (non-negotiable)

1. **Canonical units:** all geometry is stored and computed in **millimetres (float64)** and **degrees**. Convert only for display. `1 in = 25.4 mm` exactly.
2. **One transform:** the active `CalibrationProfile` gives device px per mm per physical axis. All drawing goes through `mmToDevicePx()` / `devicePxToMm()`. No other scale factors anywhere.
3. **No CSS physical units** in measuring code.
4. **Canvas backing store = CSS size × devicePixelRatio.** Draw in device-pixel coordinates. Re-create the backing store when DPR or size changes. Never scale the measuring canvas with CSS transforms.
5. **No cumulative error:** every tick position is computed independently from the origin: `x = origin + n · step · pxPerMm`, then snapped for crispness. Never `x += step`.
6. **Crisp lines:** 1-device-px lines drawn on half-pixel offsets; tick lengths defined in mm so they look identical on every phone.
7. **Scale-change guard:** if `visualViewport.scale ≠ 1`, or `devicePixelRatio`, `screen.width/height` or device key differ from the calibration's key → **measuring is disabled** with a banner: "Display scale changed — reset zoom or recalibrate."
8. **Page zoom is disabled** (viewport meta + `touch-action: none` on the stage). Magnification is provided by the **loupe** (§7.1), never by scaling the 1:1 canvas. (Photo-measurement mode, §13, may zoom freely because scale there comes from a reference.)
9. **Honest precision:** displayed decimals are derived from the uncertainty estimate (§7.6).
10. **Orientation-safe:** calibration is stored in the device's **natural (portrait) axes**; rotation only remaps axes.
11. **Sourced standards data only** (§18).

---

## 4. App shell & global UX

### 4.1 Main measuring screen (portrait)

```
┌──────────────────────────────────────┐
│ [mm│cm│in]   ● Calibrated ±0.2   ⚙   │ ← top bar (auto-hides in Focus mode)
│ ┊                                  ┊ │ ← locked usable-area edges (faint)
│ ┊ 0    10    20    30    40    50  ┊ │
│ ┊ ||||||||||||||||||||||||||||||||| ┊ │ ← 1:1 measuring canvas
│ ┊        ▓▓▓▓▓▓▓▓▓▓ (object)        ┊ │
│ ┊             ┌───────────────┐     ┊ │
│ ┊             │   42.3 mm  L1 │     ┊ │ ← Readout HUD (draggable)
│ ┊             │ 4.23cm 1 43/64│     ┊ │
│ ┊             └───────────────┘     ┊ │
│ 🔒  🎨  🔍  ↶  ↷  ⓘ           [+ Save]│ ← action row
│ 📏  ⟛  ◠  ◯  ⬡  ▭  ◎  ⋯              │ ← tool dock (thumb zone)
└──────────────────────────────────────┘
```

- Full-bleed canvas. All chrome lives at the top bar and a bottom dock in the thumb zone.
- **Focus mode** (tap 🔍-eye or double-tap empty area): hides everything except tool handles and the readout, to give maximum surface for the object.
- **Lock (🔒):** freezes all tools so placing/removing the object cannot move anything; only the readout stays interactive.
- **Left-handed layout** option mirrors the dock and HUD.
- **Large handles** option (field/gloves) increases hit targets from 48 to 64 CSS px.

### 4.2 Navigation
Routes: `/` (Measure), `/records`, `/records/:id`, `/camera/:recordId`, `/photo-measure`, `/calibrate`, `/edges`, `/settings`, `/learn`.

### 4.3 Tool dock & quick-shape palette
Dock: **Ruler · Caliper · Protractor · Circle/O-ring · Hex/Nut-Bolt · Rectangle/Square piece · Gasket · More (Thread gauge, Radius gauge, Wire gauge, Grid, Area/Polygon, Datum XY, Leapfrog, Level, Photo-measure)**.

**Quick shapes** (long-press the dock or tap "Shapes"): Nut-Bolt, Hex nut, O-ring, Washer, Gasket, Square piece, Rectangle plate, Rod/Pipe. Tapping one places that tool **pre-configured** (e.g., O-ring = concentric circle pair) at a sensible default size in the centre, ready to squeeze-fit. Choosing **Nut-Bolt** starts the **Bolt Wizard** (§6.6.2): length first, then head, etc. — each captured feature is kept and added to the same record.

### 4.4 Readout HUD
- Big primary value in the selected unit; secondary line shows the other units (mm, cm, decimal inch, fractional inch with nearest 1/16, 1/32 or 1/64 and its error).
- Feature label (L1, W1, Ø1, AF1, A1…), uncertainty chip (±0.2 mm), tolerance state colour (§7.5).
- Buttons: **ZERO/INC**, **HOLD**, **Copy**, **Add to record**, **Speak** (Speech Synthesis readout for hands-busy use).
- Draggable; auto-moves away from the active handle so it never covers the edge being aligned.
- Tabular (monospace-digit) font so numbers don't jitter while dragging.

### 4.5 "Original-looking" scales (visual quality)
- **Skins:** Steel rule (brushed metal, etched black ticks), Engineer white, Transparent acrylic, Classic yellow, Night (luminous ticks on dark). Skins never reduce tick contrast (§8).
- **Tick hierarchy (defined in mm, so identical on all phones):**
  - Metric: 1 mm → 2.5 mm long, 5 mm → 4 mm long, 10 mm → 6 mm long + number. 0.5 mm sub-ticks appear only inside the loupe.
  - Inch: 1/16 → shortest, 1/8, 1/4, 1/2, 1 in → longest + number; 1/32 and 1/64 appear in the loupe.
- Numbers: every 10 mm in mm mode (10, 20, 30…), every 1 cm in cm mode (1, 2, 3…), every inch in inch mode; optional fraction labels.
- Tick widths: 1 device px (minor), 2 device px (major).

### 4.6 Ghost Touch Shield
- A pointer is accepted **only if it starts on a handle, tool body, or UI control**. Contacts that start on empty canvas are ignored for tool manipulation.
- Ignore contacts that stay stationary while another contact is active and did not start on a handle.
- Where available, ignore contacts with very large `radiusX/radiusY` (palm/object footprint).
- Strictness setting: Off / Normal / Strict (Strict = only handles respond; body-drag disabled).

### 4.7 Gestures

| Gesture | Action |
|---|---|
| Drag handle | Move that edge/point (with loupe) |
| Drag tool body | Move whole tool |
| Two-finger twist on tool | Rotate (snaps to 0/15/30/45/90° with haptic) |
| Second finger held anywhere while dragging a handle | **Precision mode**: handle moves at 1/10 speed |
| Double-tap empty canvas | Toggle Focus mode |
| Long-press handle | Handle menu: set as zero, type exact value, lock this handle |
| Two-finger tap | Undo |

### 4.8 Haptics & sound
Vibration pulses on snaps, on "level" and on "match" (Android). Visual pulse fallback where vibration is unsupported (iOS). Optional soft clicks.

### 4.9 Fullscreen, orientation, screen-on
- Request Fullscreen on first measuring interaction (Android). Offer "Install app" (PWA standalone) for a chrome-free experience everywhere.
- Orientation lock button (where supported); otherwise a rotate hint.
- Screen Wake Lock while a tool is active.

### 4.10 Session safety
Undo/redo stack (50 steps). Current session autosaves to IndexedDB every change (debounced) and restores after a crash or reload.

---

## 5. First run: Edge Setup & Calibration

Onboarding flow: **Welcome → Edge Setup → Calibration → Verify → 60-second interactive tour → Ready.** Every step is skippable, but skipped calibration keeps the "Not calibrated" banner.

### 5.1 Edge Setup (usable flat area)
- Shows the whole screen with **four draggable boundary lines** (top, bottom, left, right), defaulting to `env(safe-area-inset-*)` plus 2 mm.
- User drags each line inward to just inside where the glass starts to curve or where rounded corners begin. Loupe shows the edge while dragging.
- Optional **corner radius** handle (excludes rounded corners) and **exclusion circle** for punch-hole/notch.
- **Lock** button → stored per device. Lines appear faintly on the measuring screen; tools cannot be dragged outside the usable area.
- Re-adjust only via **Settings → Screen edges** (with an explicit "Unlock" step).
- Stored in the device's natural portrait axes in CSS px; converted to mm after calibration. After calibration, show: "Your usable area: 66.8 × 148.2 mm".

### 5.2 Calibration
**Methods (in order of recommendation):**

| Method | How | Notes |
|---|---|---|
| **A. ID-1 card** (credit/debit card, many ID/PVC cards) | Card outline appears with fixed top-left corner marks. User places the card on it, drags the right edge and bottom edge handles to the card's edges. | 85.60 × 53.98 mm. On portrait phones the long edge (85.60) goes along the **long axis (Y)** and the short edge (53.98) along X, because 85.6 mm does not fit across a portrait phone. Default for most users. |
| **B. Real ruler** (most accurate) | User places a real steel rule along the long axis, aligns two virtual lines to two real graduations as far apart as fit (e.g., 10 and 140 mm), enters the real distance; repeat along the short axis. | Longest baseline → smallest scale error. Recommended for engineers. |
| **C. Coin** | Squeeze-fit a circle around a coin (or multi-point fit), choose a preset or type its diameter. | Presets must be verified (§18). Many countries (including India) have several coin series in circulation with different diameters, so the UI must ask for the specific series/design. |
| **D. Any known object** | User aligns two lines to any object and types its known size. | Custom, saved to "My references". |
| **E. Device estimate** | Optional starting guess from the device model (Android UA client hints) + a small bundled screen-size table. | Estimate only; never shown as "Calibrated". |

**Math:** `pxPerMmY = alignedDevicePx_Y / 85.60`, `pxPerMmX = alignedDevicePx_X / 53.98` (for card). If the two axes agree within 0.5%, average them (reduces noise). If they differ by more than 1%, keep per-axis values and warn the user (possible misalignment; repeat).

**Verify step:** "Measure your card again" (or any known object). Residual is stored. If residual > 0.3 mm, suggest recalibrating.

**Profiles:** keyed by `${screen.width}x${screen.height}@${devicePixelRatio}|${model?}|${browser}`. Multiple profiles allowed (e.g., with/without screen protector). Invalidation per §3 item 7.

**Confidence label:** Estimate / Good (card or coin) / Excellent (ruler method, verified residual ≤ 0.1 mm). Shown on the top-bar chip and recorded in every saved measurement.

**Screen protector setting:** None / Film / Tempered glass → feeds the parallax term of the uncertainty (§7.6).

---

## 6. Measuring tools

Common to every tool: move, rotate, lock, snap, loupe, precision mode, type-exact-value, label, add to record, ghost shape for camera (§10), drawing entities for EGD (§11).

### 6.1 Ruler (Scale) — five modes

**Common:** extend the ruler by dragging its end cap up to the usable-area limit (including the diagonal for the longest reach); move, rotate, flip direction (measure right-to-left), set zero anywhere, start/end markers with live length, multiple rulers on screen (max 4).

| Mode | Description |
|---|---|
| **A. Classic** | Single straight scale with start & end markers; reads the distance between them. |
| **B. Parallel / Gap rulers** (two-sided, top + bottom) | Two parallel rulers spanning the screen, each draggable perpendicular to its length. The object sits between them. A live dimension line in the middle shows the **gap (= width/breadth)**; markers along the rulers give **length**. One setup gives **L × W** of a rectangular piece or cuboid footprint. |
| **C. Split dual-unit** (one up, one down) | Like a real steel rule: **metric on the top edge, imperial on the bottom edge**, a shared cursor line across both, readout in both units at once. Variant: both edges metric, top numbered left→right and bottom right→left, so the user can measure from either end. |
| **D. Leapfrog (chain) ruler** | For objects **longer than the screen**. Place the phone beside the object, align zero with the start, tap **Mark** at the far end of the screen (user marks the object with a pencil/nail), slide the phone, align zero to the mark, repeat. App sums the segments and grows the uncertainty as √N. |
| **E. Free / T-square** | Any number of rulers placed and rotated freely; snap two at 90° to form a T-square or set-square; measure diagonals. |

**Acceptance:** after card calibration on a ~400 ppi phone, a 100 mm span on a real steel rule reads 100.0 ± 0.3 mm; tick 0 and tick N stay exactly where they were after 1,000 drag operations (no drift).

### 6.2 Vernier Caliper

- **Visual:** realistic caliper — main beam with main scale, sliding jaw with vernier plate, **outside jaws** (large, for OD/length/width) and **inside jaws** (small knife edges, for ID of rings/holes). The depth rod is **not** included (not meaningful on a screen); say so in Learn mode.
- **Use:** OD mode — object between the outside jaws; ID mode — inside jaws placed inside the hole of a ring/washer lying flat, then opened until they touch. On screen both are parallel jaw lines; the mode switches which edges are highlighted and how the feature is labelled (OD/ID/W/L).
- **Scales:** metric least count 0.1 / 0.05 / 0.02 mm; inch 0.001″ (25 vernier divisions over 0.600″). The vernier plate is **rendered from the jaw position**, with the coincident line highlighted.
- **Skins:** Vernier, Dial, Digital (LCD with ON/ZERO, mm/in, HOLD, ABS/INC buttons).
- **Thumb wheel:** a caliper-style wheel at the bottom moves the jaw in 0.05 mm (or 1 device px) detents with haptic ticks.
- **Rotatable** to any angle; length limited to the usable area.
- **Learn mode:** hides the digital value; the student reads the vernier and types the reading; the app checks it and explains main-scale + vernier coincidence.
- **Honesty:** the digital readout still follows §7.6 decimals even if the visual least count is 0.02 mm.

### 6.3 Protractor & Angles

- **Classic half-moon protractor 0–180°** with double scale (inner and outer rows, like a real protractor), movable vertex crosshair, baseline arm, and measuring arm.
- **360° mode**, reflex angles, complementary/supplementary values.
- **Two-line angle:** draw two lines anywhere along two edges of the object; the angle between them is computed even if they intersect off-screen.
- **Ruler arms:** arms carry mm ticks, so arm lengths are measured too (useful for chamfers: angle + leg lengths).
- Set-square overlays (45-45-90, 30-60-90) as templates.
- Snap: 0.5°, 1°, 5°, 15° (toggle). Readout to 0.1° (honesty-limited).
- **Camera angle finder** (Phase 3+): protractor overlay on a photo or live camera for angles of real-world things (angles in a photo are scale-free when the view is perpendicular; warn otherwise).

### 6.4 Circle · O-ring · Washer · Ring

**Creation modes**

1. **Centre → radius:** tap centre, drag outward.
2. **Squeeze-to-fit:** a large circle appears around the object with **four handles (N, E, S, W)**. Dragging one handle moves only that side inward (the opposite side stays put), so the circle shrinks and re-centres until it touches the ring on all four sides — like pinching a selection onto it.
3. **3-point:** tap three points on the rim → exact circle.
4. **Multi-point best fit:** tap 4+ rim points → least-squares fit; shows **ovality** (max − min diameter).
5. **Ellipse fit:** for deformed/stretched rings; shows major, minor and mean diameter.
6. **Arc fit (bigger than the screen):** place points on the visible arc of a large ring/flange; the app estimates the full diameter, with uncertainty that grows as the visible arc angle shrinks.

**Ring mode (concentric pair):** outer and inner circles, each squeeze-fit independently. Concentric lock on by default (inner centre follows outer); unlock for eccentric parts.

**Readouts:** OD, ID, CS (cross-section) = (OD − ID)/2, mean Ø = (OD + ID)/2, radius, circumference (πD), area, annulus area.

**O-ring finder:** nearest standard sizes from **AS568** (inch) and **ISO 3601-1** (metric) by ID and CS, with Δ and a confidence label. Notes in UI: O-rings lying free may be stretched or twisted; for best CS accuracy, measure the cord thickness with the caliper.

**Washer finder:** nearest plain washers (e.g., ISO 7089) — data only from sourced tables.

### 6.5 Gasket & Flange (bolt circle / PCD)

- **Gasket builder:** outer profile (circle, rectangle, rounded rectangle, obround) + inner cut-out(s) + hole pattern. Each part fitted with the same squeeze/handle mechanics.
- **PCD finder:** place small circles on 3 or more bolt holes → fit a circle through their centres → **PCD**, hole count N, angular pitch (360/N), hole Ø, and uniformity check (angular deviation per hole).
- **Datum XY** (also standalone, §6.7): hole positions relative to a corner/edge for rectangular gaskets.
- **Large gaskets** beyond the screen → arc fit (§6.4) or photo-measurement (§13).
- **Flange suggestion** (later): ASME B16.5/B16.21, EN 1092-1 — sourced data only.

### 6.6 Hex · Nut · Bolt

#### 6.6.1 Hex overlay
- Regular hexagon; three pairs of flat-handles for squeeze-fit; rotation handle.
- Readouts: **AF** (across flats = spanner/wrench size), **AC** (across corners = AF × 2/√3), suggested wrench sizes (metric and inch) with nearest match and Δ.
- Square-nut mode: AF and diagonal (AF × √2).

#### 6.6.2 Bolt Wizard (guided "recipe")
1. **Head type** (icons): hex, socket cap, countersunk, button, pan, carriage.
2. **Shank diameter** — gap ruler or caliper. Note: the measured major diameter of an external thread is slightly below nominal (e.g., an M8 typically measures about 7.76–7.97 mm); match to nominal with a tolerance band and show alternatives.
3. **Length** — a small diagram shows the convention for the selected head type (most heads: from under the head to the tip; countersunk: overall length).
4. **Head** — hex overlay for AF; head height with the ruler.
5. **Thread pitch** (§6.8.1).
6. **Result card:** e.g., **"M8 × 1.25 × 40 — Hex head bolt, 13 AF"**, with confidence, metric-vs-inch verdict, matching nut and washer suggestions.
7. Saved as one record with all features (L1, Ø1, AF1, k1, P1) and an auto-generated drawing (front + top view).

### 6.7 Rectangle · Square piece · Free shapes · Area · Datum XY

- **Rectangle:** 4 edge handles, 4 corner handles, rotation; readouts L, W, diagonal, area, perimeter; **square lock** (1:1); corner-radius handle.
- **Polyline / polygon:** tap vertices → segment lengths, total length, interior angles, closed area (shoelace).
- **Freehand trace** for irregular outlines → smoothing → perimeter and area.
- **Datum XY (coordinate mode):** set origin and X-axis along a datum edge, tap features → X/Y table (like a mini coordinate-measuring machine). Exportable.

### 6.8 Specialty gauges

#### 6.8.1 Thread pitch gauge
- **Virtual comb:** a saw-tooth overlay with selectable pitch (metric mm and TPI). Slide it over the threads; cycle pitches until teeth sit in every thread root.
- **Crest-count method (more accurate):** mark the first crest and the Nth crest → pitch = span / N.
- **Metric vs inch detector:** compares the measured pitch to both families and reports the best fit.

#### 6.8.2 Radius (fillet) gauge
Concave and convex radius templates to match a corner, or 3-point arc fit → radius.

#### 6.8.3 Wire gauge (electrical)
Measure conductor diameter → **AWG** (by formula, Appendix A), **SWG** (sourced table), cross-section **mm²**, nearest common cable size (e.g., 1, 1.5, 2.5, 4, 6, 10 mm²). UI notes: measure the bare conductor; stranded conductors read larger than their equivalent solid diameter.

#### 6.8.4 Grid paper
True-scale 1/5/10 mm grids or 1/8″, 1/4″ grids for quick sizing and outlining.

#### 6.8.5 Rod / drill size
Circle tool preset with nearest standard drill (metric 0.1 mm steps; fractional; number/letter drills only from sourced tables).

**Out of scope (state in Learn mode):** thickness/depth measurement (the screen is 2D).

### 6.9 Level & Inclinometer (Phase 4 — after the scale tools)
- **Modes:** tube bubble (horizontal/vertical), bullseye (surface level), inclinometer readout in **degrees, % slope, mm per metre, ratio 1:x**, angle finder (phone edge on a surface), plumb.
- **Hold**, **relative zero** (set current angle as 0), **two-position reversal calibration** (measure, rotate the phone 180° on the same surface, measure; offset = average) to cancel sensor bias.
- **Slope presets** for civil/plumbing (user-editable list; do not hard-code code requirements).
- Sound/haptic when level.
- **Sensor processing:** `DeviceMotionEvent.accelerationIncludingGravity` (or Generic Sensor `GravitySensor` / `Accelerometer` where available) → low-pass filter; fuse gyroscope with a complementary filter (α ≈ 0.98) for a steady display; median of recent samples. Display 0.1°; real accuracy is measured per device after reversal calibration, not promised.
- iOS: call `DeviceMotionEvent.requestPermission()` from a tap.

### 6.10 "What is this?" Part Identifier
A universal button that checks the current measurements against all standards tables (nuts, bolts, washers, O-rings, wires, drills) and lists likely matches with Δ and confidence. Powered by the same data files as the individual finders.

---

## 7. Precision aids

### 7.1 Loupe (the answer to "zoom")
- Appears automatically while dragging a handle, about 80 CSS px above the finger (flips below near the top edge).
- Magnification 2×–8× (pinch inside the loupe to change). **Vector re-render**, not bitmap scaling: shows 0.5 mm / 1/32″ sub-ticks, the handle line and a crosshair, so edges are crisp.
- **Pinned loupe:** keep a movable magnifier window open at a chosen spot (e.g., over one jaw).
- The main canvas always stays 1:1 (invariant §3.8).

### 7.2 Fine adjust
- Precision mode (second finger held → 1/10 speed).
- Thumb wheel (§6.2) available for any selected handle.
- Nudge buttons ◀ ▶ ▲ ▼ (1 device px or 0.05 mm per tap; long-press repeats).
- Keyboard arrows on desktop/tablet with keyboard.

### 7.3 Snapping
To ticks (1 mm / 0.5 mm / 1/16″ — toggle), to other handles/centres, to angles. Haptic on snap. Global toggle.

### 7.4 Zero · Hold · Incremental · Min/Max
Like a digital caliper: ZERO sets the current reading as 0 (INC mode shows difference), HOLD freezes the display, Min/Max tracks extremes while adjusting.

### 7.5 Tolerance (Go / No-Go)
User enters nominal and ± tolerance (or limits). Readout turns green (within), amber (within uncertainty of a limit), red (out). Saved with the measurement.

### 7.6 Uncertainty & honest precision
- `u_total = √(u_res² + u_align² + (L · r_cal)² + u_parallax²)`
  - `u_res` = half a device pixel per edge, combined for two edges.
  - `u_align` = default 1 device px per edge with loupe (2 px without), combined.
  - `r_cal` = relative calibration uncertainty ≈ (√2 × edge alignment error) / calibration baseline.
  - `u_parallax` = (apparent glass depth) × tan(assumed 10°), larger with a tempered-glass protector.
- Display expanded uncertainty **U = 2 · u_total**, rounded up to one significant figure (e.g., "±0.2 mm").
- **Decimals shown** = max(0, −floor(log10 U)) in mm (U = 0.2 → one decimal; U = 0.06 → two). User can enable "show raw value" in settings, shown in a muted style.

### 7.7 Repeat & Average
Measure the same feature 3–5 times (re-placing handles each time); the app shows mean, spread and a reduced uncertainty. Simple, real accuracy gain.

### 7.8 Parallax assist
- **Top-down coach:** a short animation on first use of each tool showing "look straight down over the edge".
- **Edge sighting lines:** handle lines extend well beyond the object so the user can sight along them.
- **Footprint hint:** for tall objects, a note to align to the edge **touching the glass**.
- **Experimental eye-position assist (Phase 5, opt-in):** front camera + a lazy-loaded face-landmark model estimates where the user's eyes are relative to the screen; shows an arrow ("move your head left") and can correct the readout for glass parallax. Disabled automatically if the object covers the front camera.

### 7.9 Template / Match mode
Overlay any saved shape at **true 1:1 scale** on screen. Place a new part on it to check whether it matches (instant go/no-go for O-rings, gaskets, nuts, spare parts).

---

## 8. Background & colour science

- **One-tap contrast cycle** button (🎨) plus a full panel.
- **Presets:** White, Black, Mid-grey, Chroma green, Blue, Yellow, plus pattern backgrounds (fine grid, stripes) that make edges easier to see.
- **Colour picker** (hue wheel + brightness).
- **Auto-contrast from object colour:** user picks the object's colour from a swatch wheel **or samples it with the rear camera** (point at the part, tap). The app chooses the background that maximises perceptual difference (ΔE in OKLab/CIELAB) from the object colour.
- **Ticks and labels auto-adapt:** tick colour chosen for ≥ 7:1 contrast (WCAG luminance) against the current background/skin.
- **Light-table (silhouette) mode:** full white background, recommend maximum brightness — dark/opaque objects become crisp silhouettes, and **holes in gaskets show as bright cut-outs**. Also great for photos.
- Colour-blind-safe accent palette for handles, tolerance states and multiple features.
- Note: web apps cannot set screen brightness — show a tip to raise it.
- Remember the last background per tool.

---

## 9. Records (saving measurements)

- **Quick history:** the last 50 readings, auto-kept; tap to add to a record.
- **Record** = one physical part/job. Fields: name, part number, project/folder, tags, notes, measured-by, date/time, optional location (opt-in), calibration profile used, overall uncertainty, photos, measurements, drawing settings.
- Measurements get **auto-labels** by type (L1, W1, Ø1, ID1, OD1, CS1, AF1, A1, P1, PCD1…), editable.
- **Records list:** thumbnails, search, filter by project/tag/date/type, sort, folders/projects.
- **Duplicate**, **compare two records** side by side (Δ per feature), **batch/inventory mode** (auto-names "Bolt-01, Bolt-02…" for sorting many parts quickly; export CSV).
- **Guided recipes:** predefined feature lists per part type (Bolt: L, Ø, AF, k, P · O-ring: ID, CS · Gasket: OD, ID, PCD, N, hole Ø · Washer: ID, OD). The recipe walks the user through each feature so records are consistent.
- **Storage:** IndexedDB (Dexie). Photos as Blobs, compressed to ~2048 px JPEG 0.85 by default ("keep original" option). Request `navigator.storage.persist()`. Show storage usage and quota warnings.
- **Backup/restore:** one `.maapak.zip` (JSON + images).
- **Privacy:** everything stays on the device. No account, no analytics by default.

---

## 10. Camera: guided capture with "ghost" overlay

The user has already measured the part. Now they open the camera from the record to take a photo.

1. **Rear camera** via `getUserMedia({ video: { facingMode: 'environment', width/height ideal high } })`. Torch toggle where supported; tap-to-focus where supported.
2. **View picker:** Top / Side / Front.
3. **Ghost overlay:** generated from the record's measured geometry via each tool's `toGhost(view)`:
   - Bolt top view → hexagon (AF, AC) + shank circle; side view → head rectangle + shank + thread hatch.
   - O-ring/washer top → two concentric circles.
   - Gasket → outline + inner cut-out + holes.
   - Rectangle piece → rectangle with true aspect ratio.
   The ghost keeps **true proportions** and is scaled to fill ~60–70% of the frame, centred.
4. **Tilt bubble:** top view needs the phone flat (screen up, camera down); side view needs it vertical. Uses the same sensor service as the level.
5. **Match intelligence** (in a Web Worker, on a downscaled ~320 px frame, ~10–15 fps):
   - Grayscale → blur → edge map (Sobel/Canny) → distance transform → **chamfer score** of the ghost's edge points against the edge map → 0–100.
   - Coarse search over small shifts/scales/rotations gives **directional hints**: "move closer", "move left", "rotate 10° clockwise", "hold steady", "too dark — torch on".
   - States: red (< 50), amber (50–84), **green (≥ 85, tilt within ±3°, sharp, stable for 400 ms)** → haptic + chime.
   - **Auto-capture** option when green. **Best-frame pick:** keep the last few frames and save the sharpest (Laplacian variance).
6. **Payoff — scale-locked photo:** because the ghost had known mm dimensions and the object matched it, the saved photo stores the ghost→photo transform. The object plane in the photo now has a **known mm/px**, so dimension lines are **auto-placed exactly on the part** in the photo (§11), and further approximate measurements can be taken on it.
7. **Fallbacks:** camera denied or unsupported → pick from gallery (`<input type="file" accept="image/*" capture="environment">`) and align the ghost manually (move/scale/rotate) — same result.
8. Release camera tracks immediately on leaving the screen.

---

## 11. Engineering drawing & dimensioned photo (EGD style)

Two outputs per record:

**(a) Annotated photo:** dimension lines drawn directly on the photo — OD, ID, length, AF, angles — positioned from the ghost alignment.

**(b) Clean 2D drawing:** vector views generated from the measured parametric model (each tool's `toDrawing()`).

**Conventions** (ISO 129-1 style; compatible with BIS SP 46 practice):
- Thin continuous dimension and extension lines; extension lines start with a small gap from the outline and extend ~2 mm beyond the dimension line; filled arrowheads (~3:1).
- Text above the dimension line, aligned or unidirectional (setting).
- Symbols: **Ø** diameter, **R** radius, **□** square, **AF** across flats, angles with an arc and °.
- Units note ("All dimensions in mm"), optional tolerance display, uncertainty note.
- **Projection:** first-angle by default (BIS SP 46 recommends first-angle), third-angle option; projection symbol in the title block.

**Auto-layout:** dimensions placed outside the outline, stacked with consistent spacing, overlap-free (greedy layout); user can drag text/offset, show/hide individual dimensions, change colour, line weight, text size, and enable a text halo for readability on photos.

**Record sheet (A4):**
```
┌───────────────────────────────┐
│   PHOTO with dimension overlay │
├───────────────────────────────┤
│   2D DRAWING (views)           │
├───────────────────────────────┤
│ Label │ Feature │ Value │ ± │ Tol │
│ OD1   │ Outer Ø │ 32.4  │0.2│ ✓   │
├───────────────────────────────┤
│ Notes        │ TITLE BLOCK     │
│              │ name, part no., │
│              │ date, by, units,│
│              │ calibration, ⌀⊕ │
└───────────────────────────────┘
```
Title block defaults (company, engineer, logo) set in Settings.

---

## 12. Export & share

| Format | Content |
|---|---|
| **PDF** | Record sheet, A4/Letter, portrait/landscape. Vector drawing (jsPDF + svg2pdf.js). |
| **JPG / PNG** | Single "measurement card" image (phone-friendly 1080×1350, or A4 at 300 dpi). |
| **SVG** | Drawing only. |
| **DXF** (R12 ASCII: LINE, CIRCLE, ARC, TEXT) | 1:1 in mm — opens in AutoCAD/LibreCAD/Fusion. |
| **CSV** | Dimension table (single record or batch). |
| **JSON** | Full record (re-importable). |
| **1:1 print template** | SVG/PDF at true scale with a 100 mm verification bar and "Print at 100% / Actual size" note — for gasket cutting, hole templates. |
| **Screen snapshot** | Render of the measuring screen (tools + readout) to PNG. Note in UI: the physical object can't be captured from the screen — use the camera for the object photo. |

**Share** via Web Share API (files) with download fallback.

---

## 13. Photo-based measurement (Phase 5) — for objects bigger than the screen

- Put a **reference** in the same plane as the object: ID-1 card, A4 sheet, or the **Maapak printable mat**.
- **Maapak mat generator:** A4 PDF with 4 ArUco markers at known positions, a light 10 mm grid and 100 mm verification bars on both axes. User prints at "Actual size" and checks the bars with a ruler.
- Detect reference corners/markers → **homography** (4-point DLT, own implementation) → rectified top view with known mm/px.
- All tools work on the rectified photo; **pinch-zoom is allowed here**; handles get **magnetic edges** (snap to the strongest nearby image gradient).
- Accuracy notes in UI: object must be flat and in the reference plane; objects with height cause offset; lens distortion near frame edges. Uncertainty estimated from reprojection error.
- Libraries: js-aruco2 (lightweight, lazy); OpenCV.js only if needed (lazy, cached by the service worker).

---

## 14. Settings

- **Units:** default unit, fraction denominator (1/16, 1/32, 1/64), decimals (auto/manual), secondary units on/off.
- **Calibration:** profiles, recalibrate, verify, screen protector type, show uncertainty.
- **Screen edges:** unlock & re-adjust, corner radius, exclusion zones.
- **Display:** theme (light/dark/auto), ruler skin, background, label size, large handles, left-handed layout, Focus mode auto-hide delay.
- **Behaviour:** snapping, haptics, sounds, Ghost Touch Shield strictness, keep screen on, speak readout.
- **Camera:** auto-capture, match threshold, torch default, keep original photo, photo quality.
- **Drawing & export:** projection (first/third angle), dimension style, paper size, title-block defaults, logo.
- **Language:** English / हिंदी.
- **Data:** backup, restore, storage usage, clear data.
- **About:** version, accuracy statement, privacy statement, open-source licences.

---

## 15. Data model (TypeScript)

```ts
type LengthUnit = 'mm' | 'cm' | 'in' | 'in-frac';
type ToolId =
  | 'ruler' | 'gapRuler' | 'splitRuler' | 'leapfrog' | 'caliper' | 'protractor'
  | 'circle' | 'ring' | 'gasket' | 'hex' | 'rect' | 'polygon' | 'datumXY'
  | 'threadGauge' | 'radiusGauge' | 'wireGauge' | 'grid' | 'level';

interface DeviceKey { screenW: number; screenH: number; dpr: number; model?: string; browser: string; }

interface CalibrationProfile {
  id: string;
  name: string;                    // "Default", "With tempered glass"
  deviceKey: DeviceKey;
  pxPerMmX: number;                // DEVICE px per mm, natural portrait X axis
  pxPerMmY: number;                // DEVICE px per mm, natural portrait Y axis
  method: 'card' | 'ruler' | 'coin' | 'custom' | 'estimate';
  referenceLabel: string;
  baselineMm: { x: number; y: number };
  alignmentErrorPx: number;
  verifyResidualMm?: number;
  screenProtector: 'none' | 'film' | 'tempered';
  confidence: 'estimate' | 'good' | 'excellent';
  createdAt: number;
}

interface EdgeInsets {               // natural portrait axes, CSS px
  top: number; right: number; bottom: number; left: number;
  cornerRadius: number;
  exclusions: { cx: number; cy: number; r: number }[];
  locked: boolean;
}

type FeatureKind =
  | 'length' | 'width' | 'diameter' | 'innerDiameter' | 'outerDiameter' | 'crossSection'
  | 'radius' | 'angle' | 'acrossFlats' | 'acrossCorners' | 'pitch' | 'pcd'
  | 'area' | 'perimeter' | 'coordinate' | 'slope';

interface Measurement {
  id: string;
  recordId?: string;
  tool: ToolId;
  kind: FeatureKind;
  label: string;                   // "OD1"
  value: number;                   // mm, mm², or degrees (canonical)
  uncertainty: number;             // expanded U, same unit as value
  tolerance?: { nominal: number; lower: number; upper: number; result?: 'pass' | 'warn' | 'fail' };
  repeats?: number[];              // repeat & average samples
  toolState: unknown;              // serialized ToolInstance (re-open & edit)
  calibrationId: string;
  createdAt: number;
}

interface Annotation {               // dimension placed on a photo or drawing
  measurementId: string;
  anchorA: [number, number]; anchorB?: [number, number];
  offset: number; textPos?: [number, number]; visible: boolean;
  style?: { color?: string; weight?: number; textSize?: number; halo?: boolean };
}

interface PhotoRef {
  id: string;
  blobKey: string; originalBlobKey?: string;
  width: number; height: number;
  view: 'top' | 'side' | 'front' | 'free';
  ghostToPhoto?: number[];         // 3x3 homography, row-major
  mmPerPx?: number;                // valid only in the matched object plane
  matchScore?: number;
  annotations: Annotation[];
  takenAt: number;
}

interface PartRecord {
  id: string;
  name: string; partNo?: string; project?: string; tags: string[];
  notes?: string; measuredBy?: string;
  recipe?: 'bolt' | 'nut' | 'oring' | 'washer' | 'gasket' | 'rect' | 'custom';
  identification?: { label: string; standard?: string; confidence: number }[];
  measurements: Measurement[];
  photos: PhotoRef[];
  drawing: { projection: 'first' | 'third'; views: ('front' | 'top' | 'side')[] };
  location?: { lat: number; lng: number; accuracy: number };
  createdAt: number; updatedAt: number;
}
```

---

## 16. Architecture & stack

### 16.1 Stack

| Concern | Choice |
|---|---|
| Build | Vite + TypeScript (strict) |
| UI | React (latest stable) — or Preact via compat if bundle size demands |
| State | Zustand (tool state mutated outside React during drags) |
| Measuring render | Single Canvas 2D stage, custom engine (§16.4) |
| UI styling | Tailwind CSS (chrome only) |
| Storage | Dexie.js (IndexedDB) |
| PWA/offline | vite-plugin-pwa (Workbox) |
| PDF | jsPDF + svg2pdf.js (lazy) |
| Backup | JSZip (lazy) |
| i18n | i18next + react-i18next (en, hi) |
| Vision | Own Sobel/distance-transform/homography in a Worker; js-aruco2 (lazy); OpenCV.js only if needed (lazy) |
| Tests | Vitest (unit), Playwright (mobile emulation E2E) |
| Quality | ESLint + Prettier, strict TS, no `any` in `core/` |

### 16.2 Folder structure

```
src/
  app/            routes, shell, top bar, dock, HUD, onboarding
  core/
    units/        conversions, fraction formatting
    calibration/  profiles, deviceKey, scale guard, transforms
    geometry/     circle fits, ellipse fit, hexagon, polygon area, intersections, homography
    uncertainty/  error model, decimals rule
    standards/    loaders + matchers (o-ring, nut, bolt, thread, wire, washer, drill)
  render/         CanvasStage, layers, tick renderer, loupe, hit-testing, pointer manager
  tools/          ruler/ gapRuler/ splitRuler/ leapfrog/ caliper/ protractor/ circle/ ring/
                  gasket/ hex/ rect/ polygon/ datumXY/ threadGauge/ radiusGauge/ wireGauge/ grid/
  features/
    records/  camera/  drawing/  export/  photoMeasure/  level/  settings/  learn/
  sensors/        orientation/motion service (shared by level + camera)
  workers/        vision.worker.ts
  data/standards/ *.json (each row has "source")
  db/             Dexie schema & migrations
  i18n/           en.json, hi.json
tests/
  unit/  e2e/
```

### 16.3 Tool plugin interface

```ts
interface RenderContext {
  ctx: CanvasRenderingContext2D;
  mmToPx(p: [number, number]): [number, number];   // device px
  pxToMm(p: [number, number]): [number, number];
  pxPerMm: number; dpr: number;
  theme: ThemeTokens; unit: LengthUnit; inLoupe: boolean; loupeZoom: number;
}

interface Handle { id: string; posMm: [number, number]; kind: 'point' | 'edge' | 'rotate' | 'body'; }

interface Readout { label: string; kind: FeatureKind; value: number; uncertainty: number; primary?: boolean; }

interface GhostShape { paths: Path2DLike[]; edgeSamples: [number, number][]; boundsMm: [number, number, number, number]; }

interface DrawingEntities { views: Record<'front' | 'top' | 'side', { outline: Entity[]; dims: DimSpec[] }>; }

interface ToolInstance {
  readonly id: string;
  readonly tool: ToolId;
  hitTest(pMm: [number, number], tolMm: number): Handle | null;
  onDragStart(h: Handle, pMm: [number, number]): void;
  onDragMove(h: Handle, pMm: [number, number], precision: boolean): void;
  onDragEnd(h: Handle): void;
  render(rc: RenderContext): void;            // main canvas and loupe
  readouts(): Readout[];
  toMeasurements(): Omit<Measurement, 'id' | 'createdAt' | 'calibrationId'>[];
  toGhost(view: 'top' | 'side' | 'front'): GhostShape | null;
  toDrawing(): DrawingEntities;
  serialize(): unknown;
}

interface ToolDefinition {
  tool: ToolId; icon: string; labelKey: string;
  create(init?: Partial<unknown>): ToolInstance;
  deserialize(state: unknown): ToolInstance;
}
```

### 16.4 Render engine
- One `<canvas>` stage, backing store = CSS size × DPR; layers drawn in order: background → scales → tools → handles → overlays/guides.
- **Dirty-flag `requestAnimationFrame` loop**: paint only when something changed.
- Static ruler tick layer cached on an offscreen canvas; re-built only when transform/unit/skin changes.
- Pointer Events with `setPointerCapture`; one pointer manager implements the Ghost Touch Shield, precision mode and gesture recognition.
- Hit-testing priority: handles > tool body > nothing. Hit tolerance in CSS px (48 default, 64 large mode) converted to mm.
- The React HUD subscribes to readouts **throttled to one update per frame**; dragging never triggers React re-renders of the stage.

### 16.5 Sensors service
Single service exposing filtered gravity vector, pitch/roll and a "steady" flag; used by the level and the camera tilt bubble; handles iOS permission prompts.

---

## 17. Performance, offline & platform notes

### 17.1 Budgets
- Core JS ≤ 180 KB gzipped (camera vision, PDF, ArUco, OpenCV lazy).
- Interactive in ≤ 2.5 s on a mid-range Android over 4G; instant from cache afterwards.
- Drag → paint ≤ 16 ms (≤ 8 ms on 120 Hz screens). No long tasks (> 50 ms) on the main thread while dragging or in camera mode.
- Vision worker ≤ 50 ms per downscaled frame.

### 17.2 PWA / offline
Installable manifest (icons, maskable icon, `display: standalone`, theme colour). Service worker precaches the app shell; lazy chunks cached on first use. Everything except first-time downloads works offline.

### 17.3 Platform capabilities (always feature-detect; verify at implementation time)

| Capability | Android Chrome | iOS Safari | Fallback |
|---|---|---|---|
| Fullscreen API | Yes | iPhone: no | Install as PWA (standalone) |
| Orientation lock | Yes (fullscreen/installed) | No | Rotate hint |
| Vibration | Yes | No | Visual pulse |
| Screen Wake Lock | Yes | Recent versions | Tip to adjust auto-lock |
| Motion/orientation sensors | Yes | Needs permission from a tap | Disable level, manual tilt |
| Camera torch | Many devices (track constraint `torch`) | No | Hide button |
| Web Share with files | Yes | Yes | Download |
| UA model hints | Yes | No | Skip device estimate |

### 17.4 Development setup
- HTTPS is required for camera, sensors and the service worker. Use `@vitejs/plugin-basic-ssl` (or mkcert) and `vite --host` to open the dev server on a phone over the local network.
- Debug Android via `chrome://inspect`; iOS via Safari Web Inspector.

### 17.5 HTML/CSS hardening
- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`
- Stage: `touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;`
- `overscroll-behavior: none` on `html, body` (prevents pull-to-refresh); prevent `contextmenu` on the stage.
- Detect `visualViewport` resize/scale and DPR changes (`matchMedia('(resolution: …dppx)')`) → re-check the scale guard.

---

## 18. Standards & reference data

**Rule:** values below are provided as a starting point and **must be verified against the cited standard before release**. Each JSON row stores `{ value…, source, verified: boolean }`. Full tables (e.g., the complete AS568 list, ISO 3601-1, ISO 7089, flanges, SWG) must be sourced from the standard or the manufacturer's published charts — **do not generate them**.

**Calibration references**
- ISO/IEC 7810 ID-1 card: 85.60 × 53.98 mm, corner radius ≈ 3.18 mm.
- Coins (verify): US quarter 24.26 mm, US nickel 21.21 mm, US dime 17.91 mm, US cent 19.05 mm; €1 23.25 mm, €2 25.75 mm, 50c 24.25 mm. **Indian coins: add only after verifying current-series diameters from official RBI/mint sources; ask for series in the UI.**

**ISO metric coarse thread pitch (mm):** M1.6 0.35 · M2 0.4 · M2.5 0.45 · M3 0.5 · M4 0.7 · M5 0.8 · M6 1.0 · M8 1.25 · M10 1.5 · M12 1.75 · M14 2.0 · M16 2.0 · M18 2.5 · M20 2.5 · M22 2.5 · M24 3.0 · M27 3.0 · M30 3.5.
**Common metric fine pitches:** M8×1.0 · M10×1.25, 1.0 · M12×1.5, 1.25 · M14×1.5 · M16×1.5 · M20×1.5 · M24×2.0.

**Hex AF for nuts/bolts (mm), ISO vs DIN where they differ:** M3 5.5 · M4 7 · M5 8 · M6 10 · M8 13 · M10 16 (ISO) / 17 (DIN) · M12 18 (ISO) / 19 (DIN) · M14 21 (ISO) / 22 (DIN) · M16 24 · M18 27 · M20 30 · M22 34 (ISO) / 32 (DIN) · M24 36 · M27 41 · M30 46.

**UNC / UNF threads per inch:** #4 40/48 · #6 32/40 · #8 32/36 · #10 24/32 · 1/4″ 20/28 · 5/16″ 18/24 · 3/8″ 16/24 · 7/16″ 14/20 · 1/2″ 13/20 · 9/16″ 12/18 · 5/8″ 11/18 · 3/4″ 10/16 · 7/8″ 9/14 · 1″ 8/12.

**Inch hex bolt head AF (ASME B18.2.1, verify):** 1/4″→7/16″ · 5/16″→1/2″ · 3/8″→9/16″ · 7/16″→5/8″ · 1/2″→3/4″ · 9/16″→13/16″ · 5/8″→15/16″ · 3/4″→1-1/8″ · 7/8″→1-5/16″ · 1″→1-1/2″.

**O-ring cross-sections:** AS568 series −0xx 0.070″ (1.78 mm) · −1xx 0.103″ (2.62 mm) · −2xx 0.139″ (3.53 mm) · −3xx 0.210″ (5.33 mm) · −4xx 0.275″ (6.99 mm). Common metric CS: 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 5.7, 7.0 mm. Full ID tables must be sourced.

**SWG (verify):** 10 → 3.251 mm · 12 → 2.642 · 14 → 2.032 · 16 → 1.626 · 18 → 1.219 · 20 → 0.914 · 22 → 0.711.
**AWG:** formula (Appendix A), no table needed.

**External thread major diameter note:** e.g., M8 6g major diameter ≈ 7.760–7.972 mm — use tolerance bands from ISO 965 for the nominal-size matcher.

---

## 19. Testing & acceptance

### 19.1 Unit tests (Vitest) — required
Unit conversion & fractions · tick position generation (no drift over 10,000 ticks) · calibration math & scale guard · uncertainty and decimals rule · 3-point circle · least-squares circle (known noisy points) · ellipse fit · arc-fit uncertainty growth · hexagon AF↔AC · shoelace area · line-line intersection · homography (synthetic points) · AWG formula · standards matchers (O-ring, nut AF, pitch metric-vs-inch) · DXF writer output parses · PDF export smoke test.

### 19.2 E2E (Playwright, mobile emulation)
Onboarding → edges lock → calibration persists across reload · scale guard triggers on simulated DPR change · each tool: create, drag, read, save to record · record with photo (mocked camera) → export PDF/JPG/CSV · offline reload works · Hindi language switch.

### 19.3 Physical test protocol (manual, documented in `tests/PHYSICAL.md`)
Reference set: ID-1 card, 150 mm steel rule, known coins, M6/M8/M10 bolts and nuts measured with a real caliper, two O-rings of known size, a printed 1:1 template. Measure each feature 5 times on at least 3 phones (one curved-edge, one budget, one iPhone). Record mean error and spread.

### 19.4 Acceptance criteria (after card calibration, ~400 ppi phone, with loupe)
- Length up to 100 mm: error ≤ ±0.3 mm; repeatability (σ) ≤ 0.1 mm.
- Circle Ø (10–60 mm): error ≤ ±0.3 mm.
- Angle: ≤ ±0.5°.
- A metal bolt resting on the screen never moves a handle (Shield = Normal).
- Handle follows the finger with no visible lag on a mid-range Android.
- Calibration and edges survive app restart; changing Android "Display size" triggers the recalibration banner.
- Exported PDF opens in a standard viewer and its values match the record exactly.
- The app works fully in airplane mode after the first load (except first-use lazy downloads).

---

## 20. Roadmap (build in this order)

### Phase 0 — Foundation
- [x] Vite + TS + React + Tailwind + Zustand + Dexie + PWA + i18n scaffolding
- [x] HTTPS LAN dev setup, lint, format, Vitest, Playwright
- [x] `core/units`, `core/calibration` (transforms, deviceKey, scale guard) with tests

### Phase 1 — Precision engine & Ruler (MVP)
- [x] Canvas stage, dirty-flag loop, pointer manager, Ghost Touch Shield
- [x] Edge Setup with lock (§5.1)
- [x] Calibration: card, ruler, custom object, verify step, profiles (§5.2)
- [x] Ruler modes A–E, skins, tick renderer (§6.1, §4.5)
- [x] Loupe, precision mode, nudge, snapping (§7.1–7.3)
- [x] Readout HUD with units/fractions, ZERO/HOLD (§4.4, §7.4)
- [x] Background & contrast panel, auto tick contrast, light-table mode (§8)
- [x] Uncertainty model & decimals rule (§7.6)
- [x] Quick history + basic record save

### Phase 2 — Core tools
- [x] Vernier caliper with skins, thumb wheel, Learn mode (§6.2)
- [x] Protractor 0–180/360, two-line angle (§6.3)
- [x] Circle: centre-radius, squeeze-fit, 3-point, multi-point, ring mode (§6.4)
- [x] Hex overlay with wrench suggestion (§6.6.1)
- [x] Rectangle/square piece, polygon, area (§6.7)
- [x] Quick-shape palette (§4.3), tolerance go/no-go (§7.5), repeat & average (§7.7)

### Phase 3 — Records, camera, drawing, export
- [x] Full records: list, search, folders, tags, recipes, compare, batch (§9)
- [x] Camera with ghost overlay, tilt bubble, match score, green state, auto-capture, best frame (§10)
- [x] Gallery fallback with manual ghost alignment
- [x] Annotated photo + 2D drawing with auto-layout dimensions (§11)
- [x] Export PDF / JPG / PNG / SVG / CSV / JSON, Web Share, 1:1 print template (§12)
- [x] Backup/restore; Hindi strings complete

### Phase 4 — Specialty & sensors
- [x] Bolt Wizard, thread pitch gauge, metric-vs-inch detector (§6.6.2, §6.8.1)
- [x] O-ring finder, washer finder, Part Identifier (§6.4, §6.10) — sourced data only (O-ring ID and washer tables not sourced yet)
- [x] Gasket builder & PCD finder, arc fit (§6.5)
- [x] Radius gauge, wire gauge, grid, Datum XY, Leapfrog (§6.7, §6.8)
- [x] Level & inclinometer with reversal calibration (§6.9)
- [x] Template/Match mode (§7.9), DXF export

### Phase 5 — World-class extras
- [ ] Photo-based measurement with card/A4/printable ArUco mat, magnetic edges (§13)
- [ ] Experimental eye-position parallax assist (§7.8)
- [ ] Camera angle finder
- [ ] Optional Play Store packaging via Trusted Web Activity (TWA)

---

## 21. Backlog / future ideas
- QR code on exported sheets carrying the record JSON (scan to import on another phone).
- Voice notes attached to records.
- Voice commands ("Hold", "Save", "Next feature").
- Team sharing/sync (optional cloud, end-to-end encrypted).
- Flange and pipe-size identifier (sourced ASME/EN/BSP tables).
- Spare-part matching against a user's own inventory catalogue.
- AR measurement (WebXR) for room-scale distances on supported Android devices.

---

## Appendix A — Formulas

- **Units:** in = mm / 25.4; cm = mm / 10. Fraction: n = round(in × D) / D for D ∈ {16, 32, 64}; show error = |in − n/D| × 25.4 mm.
- **Calibration:** pxPerMm = alignedDevicePx / referenceMm (per axis).
- **Hexagon:** AC = AF × 2/√3 ≈ 1.1547 × AF. **Square:** diagonal = AF × √2.
- **Circle through 3 points** (x1,y1),(x2,y2),(x3,y3):
  D = 2[x1(y2−y3) + x2(y3−y1) + x3(y1−y2)]
  cx = [(x1²+y1²)(y2−y3) + (x2²+y2²)(y3−y1) + (x3²+y3²)(y1−y2)] / D
  cy = [(x1²+y1²)(x3−x2) + (x2²+y2²)(x1−x3) + (x3²+y3²)(x2−x1)] / D
- **Least-squares circle:** algebraic (Kasa) fit as the start, refined with geometric Gauss–Newton (minimise Σ(√((x−cx)²+(y−cy)²) − r)²). Ovality = max − min of 2·(radial distance).
- **Ring:** CS = (OD − ID)/2; mean Ø = (OD + ID)/2; annulus area = π(OD² − ID²)/4.
- **Polygon area (shoelace):** A = ½ |Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|.
- **PCD:** least-squares circle through hole centres; angular pitch = 360°/N.
- **Thread pitch (crest count):** P = span / N; TPI = 25.4 / P.
- **AWG:** d(mm) = 0.127 × 92^((36 − n)/39); n = 36 − 39 · log₉₂(d / 0.127). Area mm² = π d² / 4.
- **Parallax:** e ≈ (t / n_glass) · tan θ; tall-edge error ≈ h · tan θ.
- **Uncertainty:** u_total = √(u_res² + u_align² + (L·r_cal)² + u_par²); U = 2·u_total; decimals = max(0, −⌊log₁₀ U⌋).
- **Vernier:** least count = 1 main-scale division − 1 vernier division (e.g., 50 vernier divisions over 49 mm → 0.02 mm; inch: 25 over 0.600″ → 0.001″).
- **Slope:** % = tan θ × 100; mm/m = tan θ × 1000; ratio 1:x with x = 1/tan θ.
- **Level reversal calibration:** offset = (a₁ + a₂)/2 with readings at 0° and 180° placement.
- **Homography:** 4-point DLT with coordinate normalisation; reprojection error → uncertainty.
- **Chamfer match:** score = mean distance-transform value sampled at the ghost's edge points; map to 0–100.

## Appendix B — Glossary
**AF** across flats (spanner size) · **AC** across corners · **OD/ID** outer/inner diameter · **CS** O-ring cross-section · **PCD** pitch circle diameter (bolt circle) · **TPI** threads per inch · **LC** least count · **ΔE** perceptual colour difference · **DPR** device pixel ratio · **EGD** engineering graphics/drawing · **PWA** progressive web app · **TWA** trusted web activity (Play Store wrapper).
