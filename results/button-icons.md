# In-game button icons (direct request): completion summary

**Status:** Complete. The four supplied `public/button-icons/*.png` files are now shown inside the four `/play` header actions. Labels, actions and accessibility names are unchanged; the header wraps cleanly down to 320 px with no horizontal overflow.

## Files created or changed

| File | Change | Why |
| --- | --- | --- |
| `app/play/page.tsx` | Added the local `HeaderIcon` helper (transparent `next/image`, 1536×1024 source, `sizes="36px"`, `h-6 w-9 object-contain`, decorative `aria-hidden`). Each header action now contains its icon plus its existing `<span>` label: **Cambiar modo** → `change-mode.png`, **Nueva partida** → `new-game.png`, **Sonido** → `sound.png`, **Volver al inicio** → `house.png`. The buttons became `flex items-center gap-2`; all keep `select-none` and their existing handlers/forms. | Wires the user-supplied icons into the in-game header without changing button behaviour. |
| `components/game/game-result-overlay.tsx` | Added `sizes="32px"` to the two result-action icons so the optimizer serves the small rendered size instead of the full 1536 px source. | Keeps the overlay icons efficient as well. |
| `public/button-icons/*.png` | **User-supplied** transparent 1536×1024 hand-drawn assets: `change-mode.png`, `new-game.png`, `sound.png`, `house.png`. | Requested icon set; all four are now used. |
| `architecture.md` | Updated the structure, playable-game header description, current status and last-updated line. | Living documentation required by `AGENTS.md`. |
| `results/button-icons.md` | **New.** This summary. | Required by `AGENTS.md`. |

No files were deleted. The existing button copy, `aria-label="Ajustes de sonido"` on the Sonido trigger, `data-sound-trigger`, form actions and focus/feedback callbacks were left intact.

## Behaviour and design

- **Icons are decorative:** each image has `alt=""` and `aria-hidden="true"`; the accessible name is still the visible text (`Sonido` keeps its explicit `aria-label` for the sound dialog).
- **Header fit:** icons use the supplied 3:2 artwork in a 36×24 px box with `object-contain`, so the wide gamepad/speaker art is not cropped. The buttons remain flex items with `gap-2`; the header uses `flex-wrap`.
- **Responsive wrapping:** at 390 px the four actions occupy three rows (Cambiar modo; Nueva partida + Sonido; Volver al inicio). At 320 px they occupy four single-button rows. `document.documentElement.scrollWidth` equals the viewport width at both sizes.
- **Optimizer:** `sizes="36px"` makes the browser request the small `/_next/image` variant; the observed header icons are served as 36×24 natural-size images (`w=48` candidate). The original transparent PNGs remain in the offline precache for the existing fallback.
- **Existing actions preserved:** Sonido still opens/closes the settings dialog, Nueva partida still resets, Cambiar modo still submits its native form to `/alone`, and Volver al inicio still navigates to `/`.
- **Result overlay reuses the same set:** its actions already use `new-game.png` and `house.png` (inverted for the dark overlay); this header pass uses all four in their normal black-on-paper form.

## Verification

Toolchain: Next.js 16.4.2 (Turbopack), Bun 1.4.4, Node 24.5.0, Chrome 156.0.8078.80 headless with SwiftShader.

| Command/check | Result |
| --- | --- |
| `bun run lint` | Exit 0. |
| `npx tsc --noEmit` | Exit 0. |
| `bun test` | **106 passed, 0 failed, 4,752 assertions** across 9 files. |
| `bun run build` | Exit 0. Service worker regenerated with **101 entries, 60.7 MiB**, revision `MphfnOT8QHvFMV5bkO870`. |
| Headless Chrome, desktop `/play` | Four matching header buttons, each with one loaded icon (`/button-icons/change-mode.png`, `new-game.png`, `sound.png`, `house.png`); visible labels unchanged; icons rendered at 36×24 natural size. |
| Headless Chrome, 390×844 | All four icons loaded; `scrollWidth === 390`; no horizontal overflow; buttons wrap to three rows. |
| Headless Chrome, 320×700 | All four icons loaded; `scrollWidth === 320`; no horizontal overflow; buttons wrap to four rows. |
| Sonido button | Opened the settings dialog (`aria-expanded` state/test) and Escape closed it; icon did not interfere with the trigger. |
| Nueva partida button | Reset without a result overlay; board remained visible. |
| Cambiar modo button | Native form submitted and landed on `/alone` with heading **Jugar solo**. |
| Volver al inicio button | Navigated to `/` with heading **Parchís Stars**. |
| Console/exception capture | No exceptions and no error-level console entries. |
| Offline assets | The button icons were already part of the all-public service-worker precache; the offline result test confirmed the `new-game` icon optimizer URL loads offline (cached WebP), and the existing original-image fallback remains for widths that were never cached. |

## Deviations and follow-ups

- The header labels remain visible beside the icons; this is not an icon-only header. The request was to add the icons to the buttons, not to replace the text.
- The mobile header is taller because the wider buttons wrap to more rows (three rows at 390 px, four at 320 px). The page remains vertical-scroll only and the board below is unaffected.
- The supplied icons are used as-is; no recolouring or CSS filters are applied in the header. The result overlay inverts `new-game`/`house` to white for contrast on its dark full-screen dialog.
- No new dependencies were added.
