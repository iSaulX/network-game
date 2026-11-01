# Game result overlay (direct request): completion summary

**Status:** Complete. The under-board winner card was removed. A finished game now opens a full-screen, 10 px-backdrop-blurred result dialog with the supplied win/loser artwork, Spanish copy derived from the engine's winner, and bottom **Jugar de nuevo** / **Volver al inicio** actions. Both outcomes, reset/home navigation, mobile layout and offline loading were verified.

## Files created or changed

| File | Change | Why |
| --- | --- | --- |
| `components/game/game-result.ts` | **New.** Pure result summary helper: human win → trophy (`/game-results/win.png`, “¡Has ganado!”, “Tus cuatro fichas han llegado a la meta. ¡Buen juego!”); human loss → crying face (`/game-results/loser.png`, “Has perdido”, “{winner} ha ganado la partida. ¡La próxima será tuya!”), with “El rival” fallback for a blank winner name. | Keeps the win/loss copy and artwork deterministic and testable. |
| `components/game/game-result.test.ts` | **New.** Three tests for win copy/artwork, loss copy naming the winner, and blank-winner fallback. | Covers the “description based on the game's output” requirement. |
| `components/game/game-result-overlay.tsx` | **New.** Full-screen drawably result `alertdialog`: fixed inset-0 overlay, `backdrop-filter: blur(10px)`, win/loser `next/image` art, dynamic Spanish title/description, safe-area padding, responsive layout, focus trap, and two drawably action buttons using the supplied `new-game.png` / `house.png` icons. | Delivers the requested whole-screen result state and dismiss actions. |
| `app/play/page.tsx` | Removed the inline `WinnerPanel` card and its render below the board; removed the now-unused `AvatarVisual` import; derived `gameResult` from `game.phase === "finished"` and `game.winnerId === setup.human.id`; added the overlay with `onPlayAgain={handleReset}` and `onGoHome` (tap feedback + `router.push("/")`); reset closes the sound popover and the sound popover is suppressed while the result is open. | Removes the old bottom win state and wires the new result screen into the game lifecycle. |
| `public/game-results/win.png` | **User-supplied** 1536×1024 transparent-background trophy illustration. | Win artwork requested by the user. |
| `public/game-results/loser.png` | **User-supplied** 1536×1024 transparent-background crying-face illustration. | Loss artwork requested by the user. |
| `public/button-icons/new-game.png` | **User-supplied** transparent hand-drawn “new game” icon; used inverted on the solid result button. | Play-again action icon. |
| `public/button-icons/house.png` | **User-supplied** transparent hand-drawn house icon; used inverted on the outline result button. | Home action icon. |
| `public/button-icons/change-mode.png`, `public/button-icons/sound.png` | **User-supplied** transparent hand-drawn icons; used in the in-game header by the follow-up request. | Header action icons; see `results/button-icons.md`. |
| `architecture.md` | Updated the playable-game, accessibility, test, PWA-precache, structure and current-status sections. | Living documentation required by `AGENTS.md`. |
| `results/game-result-overlay.md` | **New.** This summary. | Required by `AGENTS.md`. |

No source files were deleted. The removed `WinnerPanel` was an inline component in `app/play/page.tsx`.

## Behaviour and design

- **Trigger:** the overlay renders when `game.phase === "finished"`. `humanWon` is true only when the engine winner is the human seat (`setup.human.id`); any bot winner produces the loss illustration.
- **Full screen:** `position: fixed; inset: 0; z-index: 100`, a dark translucent wash (`rgba(18, 14, 10, 0.62)`) and `backdrop-filter: blur(10px)` with `-webkit-` fallback. The Pixi board remains behind the overlay, blurred; the board is still PixiJS, never re-rendered as DOM.
- **Artwork and copy:** `win.png` + “¡Has ganado!” / “Tus cuatro fichas han llegado a la meta. ¡Buen juego!” for a human win; `loser.png` + “Has perdido” / “{winnerName} ha ganado la partida. ¡La próxima será tuya!” for a bot win. The alt text is “Trofeo de victoria” / “Cara triste de derrota”. The old “Sus cuatro fichas llegaron a la meta.” card copy is gone.
- **Buttons:** bottom-centered/stacked drawably actions. **Jugar de nuevo** is solid with the inverted `new-game.png` icon and calls `handleReset`; **Volver al inicio** is an outline button with the inverted `house.png` icon, paper-coloured sketch/text and calls `router.push("/")` after tap feedback. Both carry `select-none`.
- **Accessibility:** labelled `alertdialog` with `aria-modal`, `aria-labelledby` / `aria-describedby`, initial focus on **Jugar de nuevo**, and a two-button Tab focus trap. No Escape dismissal: the result requires an explicit action. The buttons use native text plus decorative `aria-hidden` icons. Safe-area padding is applied to the fixed overlay.
- **Motion:** no new animation; the blur is static and drawably already respects `prefers-reduced-motion`.
- **Sound settings:** if the sound popover was open when the game ended, it is not rendered behind the result overlay; **Jugar de nuevo** also clears its open state. Auto-play remains checked across replay, matching the existing **Nueva partida** behaviour.
- **Offline:** the new public assets are automatically included by the existing all-public precache walk. A rebuild reports **101 precache entries / 60.7 MiB**; the overlay images and icons are therefore available on a cold offline reload. `next/image` uses its existing offline original-image fallback for uncached optimizer sizes.

## Verification

Toolchain: Next.js 16.4.2 (Turbopack, Cache Components + Partial Prefetching), Bun 1.4.4, Node 24.5.0, Chrome 156.0.8078.80 headless with SwiftShader.

| Command/check | Result |
| --- | --- |
| `bun run lint` | Exit 0. |
| `npx tsc --noEmit` | Exit 0. |
| `bun test` | **106 passed, 0 failed, 4,752 assertions** across 9 files, including the three new result-summary tests. |
| `bun run build` | Exit 0. Routes `/`, `/_not-found`, `/alone`, `/manifest.webmanifest`, `/offline`, `/play` static. Service worker regenerated: **101 entries, 60.7 MiB**, revision `MphfnOT8QHvFMV5bkO870`. |
| Headless Chrome, 1v1 auto-played win | Overlay title **¡Has ganado!**, description **Tus cuatro fichas han llegado a la meta. ¡Buen juego!**, image `/_next/image?url=%2Fgame-results%2Fwin.png…` loaded (695 px wide desktop / 358 px mobile), focus on **Jugar de nuevo**, computed `position: fixed`, `z-index: 100`, `backdrop-filter: blur(10px)`, overlay rect 741×469 inside the desktop page scrollbar (the layout viewport) and 390×844 on mobile. |
| Headless Chrome, 1v1 auto-played loss | Overlay title **Has perdido**, description **Ana ha ganado la partida. ¡La próxima será tuya!**, image `loser.png` loaded. |
| Old bottom state | `oldWinnerText` false; no under-board winner card in the DOM. |
| Buttons | Both labelled actions present; **Jugar de nuevo** reset the game and removed the overlay; **Volver al inicio** navigated to `/` with heading **Parchís Stars**. Home button sketch/text/icons were made paper/white for contrast on the dark overlay. |
| Mobile 390×844 | Overlay rect 390×844, `document.documentElement.scrollWidth === 390`, image and both buttons within the viewport; desktop/mobile screenshots captured. |
| Service worker cache | Includes `/game-results/win.png`, `/game-results/loser.png`, `/button-icons/new-game.png`, `/button-icons/house.png`; no `/api/*` entries. |
| Offline assets | While offline: both result PNGs and both button icons returned `200` with `image/png`; optimizer URLs for the displayed result and icon sizes returned cached WebP (62,670 B and 424 B). The code retains the original-image fallback for optimizer widths that were never cached. |
| Offline result screen | Took the game to a result while offline: title **Has perdido**, description naming **Ana**, `loser.png` loaded with natural width 358, both actions present. |
| Console/exception capture | No exceptions and no console errors in the online or offline result runs. |

The browser test accelerated only the game's 1 s / 750 ms / 90 ms timers (to 15 ms / 15 ms / 5 ms) so both outcomes could be reached quickly; the shipped code keeps the normal 1 s bot pacing.

## Deviations, caveats and follow-ups

- The result overlay uses `new-game.png` and `house.png`; the follow-up direct request wires all four `button-icons` into the game header (see `results/button-icons.md`).
- The result overlay is a post-game DOM/drawably screen, not Pixi; this matches the project's rendering split (board/game state are Pixi; menus/dialogs are drawably). The board is not re-rendered.
- The overlay cannot be dismissed with Escape or a backdrop click; **Jugar de nuevo** and **Volver al inicio** are the only exits, so a finished game always presents a next step.
- On a loss, the copy always says **Has perdido** from the human's perspective, even if the human seat was in auto mode. There is no draw or abandoned-game state in the engine.
- Auto-play remains enabled after **Jugar de nuevo**; this preserves the existing **Nueva partida** behavior. Uncheck **Modo automático** to take over the new game.
- If the optimizer variant of a result image/icon is not cached, offline loading uses the original 1.7–2.1 MB public PNG (large but functional). The static precache includes the originals; `/_next/image` uses the existing offline fallback.
- `backdrop-filter` is used as requested; browsers without it still get the dark wash and all content.
- The result overlay adds six public assets to the existing “cache everything” precache, increasing it from 95 entries / 54.9 MiB to 101 entries / 60.7 MiB.
- No new runtime dependencies were added. `public/game-results/*` and all four `public/button-icons/*` files are the user-supplied assets.
