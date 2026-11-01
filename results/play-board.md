# Play board (`/play`) — completion summary

**Status:** Complete. `/play` now renders the supplied square Parchís reference board with PixiJS: 68 numbered cells, four 7×7 flower homes, four seven-cell corridors, a diagonal-split centre goal, and free-hand ink borders throughout. The board is player-relative: the selected colour's home is always in the bottom-left corner and its start square is always number 1. The page chrome is drawably; the board is entirely PixiJS. Shared physical and view-aware position APIs return every current cell, corridor, yard, and goal position.

## Files created / changed / deleted

| File | Change | Why |
| --- | --- | --- |
| `lib/parchis/board-geometry.ts` | Rewritten | Replaces the old 19×19 portrait model with the supplied reference board on a 21×21 unit play surface. Defines all 68 track polygons, eight chamfered inner-corner cells, the colour corridors, goal triangles, 7×7 yards, starts/entrances/safe marks, progress anchors, pixel conversions, frame composition, and physical/view-aware position APIs. Adds the player-view rotation and start-relative numbering. |
| `lib/parchis/board-geometry.test.ts` | Rewritten | Verifies the geometry contract: closed loop, shared boundaries, chamfers, special squares, corridor order/adjacency, yards/slots, progress anchors, pixels/frame/positions, player-view rotation/renumbering, and validation. |
| `components/game/board-drawing.ts` | Rewritten | New Pixi renderer: walnut table, oak frame with mitres, cream wood surface and procedural grain, flower homes, corridors, special cells, goal triangles, Open Runde numerals rotated by side, and seeded rough borders merged per shared line. The whole play area is rotated as a container and the numerals are renumbered for the selected player colour. |
| `components/game/parchis-board.tsx` | Updated | Square Pixi host (instead of the old portrait 1:2 host), resize handling, dynamic Pixi import, a `playerColor` prop that redraws the view, an accessible Spanish label naming the view colour, and no highlight/explorer props. |
| `app/play/page.tsx` | Rewritten | Removed the old explorer, start buttons, legend, and side panel. Added a drawably “Juegas como” colour selector (Verde/Amarillo/Rojo/Azul) that rotates and renumbers the board, around the large wooden board card. All copy is Spanish. |
| `architecture.md` | Updated | Structure, routes, Play-board section, engine cross-references, and current status now describe the 21×21 reference board, its APIs, and the remaining engine reconciliation. |
| `results/play-board.md` | This summary | Required completion summary for this direct request (no `tasks/NN-*.md` brief exists for it). |

No files were deleted; the previous board implementation was overwritten.

`package.json` and `bun.lock` were already modified in the working tree by the earlier board attempt (PixiJS and `@types/bun`); this task added or removed no dependencies.

## Board model

- **Player view:** the selected colour's home is rotated to the bottom-left corner (blue 0°, green −90°, yellow 180°, red +90°); the table and frame stay fixed. Labels are relative to that colour: its start is **1**, numbers continue in play order, its home entrance is **64**, and 65–68 are the four squares after the entrance. The view rotation and numbering are pure geometry (`getBoardView`, `getViewSquareNumber`).
- **Play surface:** 21×21 units. Four 7×7 homes; a top and bottom arm seven units wide split into three lanes; left and right strips three rows tall; a 5×5 central goal; and the 68-square track.
- **Physical numbering:** 1–8 down the top-left lane; 9–16 leftward; 17 at the left tip; 18–25 rightward; 26–33 down the bottom-left lane; 34 at the bottom tip; 35–42 up the bottom-right lane; 43–50 rightward; 51 at the right tip; 52–59 leftward; 60–67 up the top-right lane; 68 at the top tip. The loop is continuous and closes from 68 back to 1. This is the physical artwork numbering; the visible labels are renumbered per player view.
- **Chamfers:** cells 8, 9, 25, 26, 42, 43, 59, and 60 are cut by the goal X, exactly as in the photograph. In particular, there is no horizontal border between 8/9 or 60/59; the diagonal is the shared edge. An independent pixel audit caught the two top chamfers, which were corrected.
- **Number orientation:** top lane 180°, bottom lane 0°, left strip 90°, right strip −90°; labels sit near the corridor/centre-facing corner of each cell.
- **Colours:** green top-left (start 5, entrance 68), yellow top-right (56/51), red bottom-right (39/34), blue bottom-left (22/17). Start cells use the corridor paint; cells 12/29/46/63 are brown safe marks; cells 17/34/51/68 are darker brown entrance tips. Corridors contain seven unnumbered cells each.
- **Goal:** the 5×5 centre is split by both diagonals into green/blue/yellow/red triangles. The diagonals continue to the four home corners.

## Position API

- `getBoardPositions(playSize, originX?, originY?)` → all track squares (polygon, centre, label), corridors, yards with four slots, goals, and the centre, in pixels.
- `getBoardPositionsForCanvas(canvasSize, originX?, originY?)` → the same result using the shared canvas composition; this is the simplest entry point for a future token layer that only knows the canvas size.
- `getBoardFrameLayout(canvasSize)` → table margin, frame width, board/play size, play origin, and unit size. The renderer consumes the same function.
- Player-view helpers: `getBoardView(color)` → rotation and physical start; `getViewSquareNumber(color, square)` → 1-based player-relative label; `getViewSquarePosition(color, square, playSize, …)` → rotated polygon/centre/label with `viewSquare`; `getViewBoardPositionsForCanvas(canvasSize, color, …)` → all numbered squares in the view.
- Single-value physical helpers: `getSquarePosition`, `squareToPoint`, `unitToPixel`, `unitPointToPixel`, `progressToSquare`, `getProgressAnchor`, `getProgressPoint`, `getYardSlotAnchor`, `getYardRect`, `getCorridorCells`, `getGoalTriangle`, `wrapSquare`.
- Invalid square numbers, progress values, slots, and sizes throw `RangeError`.

## Rendering and page

- **Pixi layer:** one square `Application` mounted by `parchis-board.tsx`; the Pixi module is imported dynamically in the client effect. The canvas is resized to the host square and redrawn on `ResizeObserver`. No DOM/SVG/drawably element draws game pixels.
- **Visual treatment:** walnut table grain, light oak frame with mitre lines, cream wood surface with layered grain, painted homes/corridors/special cells/goal, large procedural flowers (16 alternating long/short petals, eight-point star, scalloped ring, centre disk), and dark brown Open Runde numerals. The play area is a rotated Pixi container; the frame/table stay fixed and the visible numbers are renumbered for the current player.
- **Free-hand borders:** deterministic seeded rough strokes. Axis-aligned cell/home/corridor/goal edges are collected and merged into continuous line runs so shared borders are sketched once; the goal diagonals are drawn as two full X strokes to the home corners. The frame and goal X use heavier strokes.
- **Page:** large board card (up to 860 CSS px, rounded and shadowed), scrollable page, Spanish title “Tablero de Parchís”, a drawably “Juegas como” selector with `select-none` buttons and `aria-pressed`, a “Volver al inicio” drawably button, Spanish caption, and a Spanish `role="img"` label naming the view colour. No old explorer, inputs, start buttons, or legend remain.
- **Responsive:** at 390×844 the board is 358×358, the selector becomes a 2×2 grid, the page has no horizontal overflow (`scrollWidth === 390`), and the header wraps. Desktop and board screenshots were captured with headless Chrome using SwiftShader because the default headless WebGL path produced corrupted captures. All four views (verde, amarillo, rojo, azul) were exercised; each puts that colour's home at the bottom-left and shows its start as 1.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test lib/parchis/board-geometry.test.ts` | 21 tests passed, 1850 assertions. Adds player-view rotation, start=1/entrance=64 numbering, and rotated view positions to the geometry, corridor, yard, pixel, and validation coverage. |
| `bun test` (full repo after rebase) | 70 tests passed, 4638 assertions across board geometry, engine, and engine simulation files. |
| `bunx tsc --noEmit` | Passed. |
| `bun run lint` | Passed. |
| `bun run build` | Passed. `/`, `/play`, and `/manifest.webmanifest` are statically prerendered. |
| Headless Chrome, 1440×1400 | Full board rendered; no console errors. |
| Headless Chrome / CDP, 1280×800 | Board measured 860×860 via CDP; page scrolls vertically; `scrollWidth === 1280`, no horizontal overflow. All four colour views were captured and checked. |
| CDP mobile emulation, 390×844 | Board measured 358×358; selector becomes a 2×2 grid; `scrollWidth === 390`; header wraps; no horizontal overflow. |

The earlier headless screenshots at the default GPU path were garbled; all verification captures used `--disable-gpu --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`. The final board screenshot was checked against the reference for layout, numbering, rotations, corridor placement, special-cell colours, and the chamfered corners.

## Deviations, unresolved issues, and follow-ups

- **Procedural art, not a photo texture.** The layout, colours, motifs, grain, frame, and typography are reproduced procedurally. The grain pattern and flower motif are close approximations, not pixel copies of the photographed wood.
- **Painted safe marks vs. engine rule.** The reference paints each colour's `start + 7` square brown (12/29/46/63) and its entrance tip darker brown (17/34/51/68; five squares before that colour's start). The now-implemented engine defines 12 safe squares at starts +4/+11. The geometry exposes the painted kinds but does not change the engine rule; board-to-engine integration must reconcile the rule or remap the marks before gameplay.
- **Engine colour IDs.** The artwork’s physical corner order is green/yellow/red/blue; the engine brief’s starts are red 0, blue 17, yellow 34, green 51. The geometry uses the artwork mapping; integration must map engine colour IDs explicitly.
- **Number orientation after rotation.** The artwork's numerals keep their per-side orientation. Because each colour's home is rotated to the bottom-left, that colour's numbered side is the left edge; its labels (including 1) are therefore sideways on a front-facing screen, exactly as they would face a player seated on that side. They were not forced upright, to preserve the reference's side-facing numbering.
- **Relative numbering.** The visible labels are 1…68 from the selected colour's start; its home entrance is 64, and 65–68 are the four squares after the entrance. The physical artwork numbers remain unchanged in the geometry for engine mapping.
- **Selector is local.** The “Juegas como” selector is a preview. Future game state should pass the assigned colour to `ParchisBoard`; no networking or player state exists yet.
- **drawably variant workaround.** drawably 0.4.2 does not remove the previous `drawably-button--solid` class when a button changes to `outline`, leaving its label invisible (paper text on paper). The selector remounts buttons when the active state flips via a key, and restores focus to the newly selected button after the remount.
- **Static board.** There are no tokens, dice, highlights, hover/click selection, animations, networking, or persistence yet. `getProgressPoint`, corridor positions, yard slots, and the view-aware square positions are ready for the future token layer.
- **Small mobile type.** At a 358 px board the numerals are necessarily small (approximately 7–9 px); the board remains complete and overflow-free. A future zoom/fullscreen control would improve phone legibility.
- **Vertical page scroll.** The board is intentionally allowed to be 860 px tall rather than being forced into the viewport, trading page fit for readable numerals.
