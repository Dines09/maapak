# Physical test protocol (§19.3)

Automated tests cannot check real millimetres. Run this on real phones before each release and record the results below.

## Reference set

- ID-1 card (bank/ID card, 85.60 × 53.98 mm)
- 150 mm steel rule
- M6, M8 and M10 bolts and nuts, each measured with a real caliper first
- A printed 1:1 template (once the print export exists, Phase 3)

## Phones

At least 3: one with curved edges, one budget phone, one iPhone.

## Procedure

1. Fresh install. Edge Setup → lock. Calibrate with the card → Verify. Note the residual.
2. Recalibrate with the steel rule (10 → 140 mm on the long axis, 10 → 50 mm on the short axis). Verify with the card.
3. For each feature, measure 5 times, re-placing the markers each time, using the loupe and looking straight down:
   - Steel rule span of 100 mm (Classic ruler)
   - Card long and short edges (Gap ruler, L × W)
   - Bolt shank length and head width
4. Place a metal bolt on the screen next to a marker (Shield = Normal). The marker must not move.
5. Change Android Settings → Display size, then reopen. The "Display scale changed" banner must appear.
6. Turn on airplane mode and reopen the app. It must work.

## Acceptance (§19.4)

- Length up to 100 mm: error ≤ ±0.3 mm, repeatability σ ≤ 0.1 mm
- Calibration and edges survive an app restart

## Results

| Date | Phone | Calibration | Feature | Mean error (mm) | σ (mm) | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
