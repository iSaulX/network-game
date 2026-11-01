# Task 06 — Bot mode (direct `/play` implementation; partial relative to the brief)

**Status:** The direct bot-mode request is implemented through `/alone` → `/play`: choose **1 vs 1** or **all-vs-all**, any colour, name and avatar. It is **not** a full implementation of `tasks/06-bot-mode.md`: the separate `/bots` route, offline precache, homepage/offline entry, `localStorage` resume and reusable `GameStage` abstraction from that brief are still pending. The brief’s one-die/human-red/pass assumptions also predate the current two-dice variant and were not applied.

## Implemented

- **Modes:** `/alone` starts **all-vs-all** (human + three bots) or **1 vs 1** (human + opposite-corner bot: blue↔yellow, red↔green). The human can choose blue/red/yellow/green, name and avatar.
- **Turn order:** fixed engine colour order **blue → red → yellow → green**, filtered to the participants. The human may start or wait depending on the chosen colour.
- **Human-only interaction:** `ParchisBoard` receives the synthetic human id; only the human's chosen-colour chips are pointer-selectable. Bot turns clear all selectable chips, keyboard move targets and popovers. Bot dice trays never expose roll/barrier/bonus controls; only the human’s tray is clickable while their colour is active. In 1v1 only the human bottom-left and opponent top-right cards are rendered.
- **Bot policy:** `lib/bots/policy.ts` is pure, deterministic and one-ply. It uses only public state and the legal move lists. Scoring: capture +1000, exact goal +800, form a friendly barrier +300, safe landing +150, progress +1/square, risky non-safe landing within 1–6 of an opponent −200, break an owned barrier −150 unless capturing or reaching the goal. Ties use higher target progress then token id. It chooses the best legal bonus and simulates each eligible own-barrier break before choosing. Every returned move is validated against the legal list.
- **Pacing:** 1 s wait before each bot action; bot dice tumble for 1 s; 1 s wait before the following move/bonus/barrier action. Each state change clears the pending timer; phase/player checks prevent duplicate actions. The human roll remains 750 ms.
- **Auto-play for the human seat:** a **Modo automático** checkbox above the human dice hands the human's turns to the same policy. While checked the human's dice/chips/popovers are disabled, the panel shows **Tú (auto)**, and an **Auto** badge appears on the active tray. Unchecking cancels an in-flight auto roll and any pending auto timer so human controls return. See `results/auto-mode.md`.
- **Feedback:** optional haptics plus the supplied `/sounds/dice-roll.mp3` and `/sounds/click.mp3`; bot/auto actions are sounds only. See `results/haptics-sounds.md`.
- **Labels:** non-human profile cards show **Bot**; the human shows **Tú**, or **Tú (auto)** while auto-play is active. The minimal textless dice trays, compact profile cards, mobile seats above/below the board and removed footer/stat tiles remain from the previous pass.

## Files

| File | Change |
| --- | --- |
| `lib/bots/policy.ts` | New pure bot policy: normal move, bonus move and barrier choice. |
| `lib/bots/policy.test.ts` | 9 tests: capture, barrier, goal, barrier-break avoidance, risk avoidance, determinism/legality, bonus and barrier choice. |
| `components/game/game-players.ts` | Dynamic setup: colour order, opposite pairs, avatar allowlist, validated URL settings, synthetic human + bots. |
| `components/game/game-players.test.ts` | Setup tests. |
| `app/alone/page.tsx` | Solo mode/colour/name/avatar selection and native GET start form. |
| `components/game/player-panel.tsx` | “Tú” / “Bot” labels; **Tú (auto)** role while auto-play is active; compact card retained. |
| `components/game/dice-card.tsx` | Roll/barrier/bonus controls restricted to the human; `controllable` hides them during auto-play; **Auto** badge; bot trays automatic; roll click no longer leaks the DOM event into the duration. |
| `components/game/parchis-board.tsx` | `humanPlayerId` and `humanControlled`; `selectableTokenIds` only while the human controls their turn; ref updates for the human id and control state. |
| `components/game/game-feedback.ts`, `components/game/game-feedback-cues.ts`, `components/game/game-feedback-cues.test.ts` | New haptic/sound hook, supplied MP3 playback, synthesized cues, cue classifier and tests; bot/auto actions suppress haptics. |
| `app/play/page.tsx` | Query-driven setup, Suspense, chosen view/colour, bot scheduler with 1 s timers, 1 s bot roll, human-only token selection/targets/popovers, bot policy calls, auto-play checkbox/scheduler source, human/bot dialog guards, mode badge/change-mode. |
| `architecture.md` | Bot mode, policy, pacing, turn order, tests and remaining Task 06 work. |
| `results/playable-game.md` | Updated feature summary. |
| `results/06-bot-mode.md` | This task summary. |

No files were deleted in this pass.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test` | **103 passed, 0 failed, 4,739 assertions** across 8 files; 500-game simulation 176,423 actions, longest 639; 9 bot-policy tests + 3 setup tests + 8 feedback-cue tests. |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/_not-found`, `/alone`, `/manifest.webmanifest`, `/play` static. |
| Headless Chrome + SwiftShader, 1360×1200 | Human blue starts; after the deterministic [5,2] human entry/move, live observation shows **Carla/red → Diego/yellow → Ana/green → Bruno/blue**. Each bot waits ~1 s, tumbles for ~1 s, waits ~1 s and acts. During bot turns the roll-button count and DOM move-target count are 0; the human roll button returns on blue. No console errors. Auto checkbox test: checked hid the human roll button and showed **Tú (auto)**/Auto; an auto roll played `/sounds/dice-roll.mp3` at 0.32; unchecking during the roll returned the roll button; a later auto span played the dice and movement clips with no extra haptics. |
| 390×844 | `/alone` and both `/play` modes: no horizontal overflow; human bottom-left, opponent top-right in 1v1; page heights ~1402 / ~1004 px (auto checkbox included). |

## Remaining from the Task 06 brief

- Separate `/bots` route and `GameStage` abstraction.
- Homepage and offline-page “Jugar contra bots” entry.
- Service-worker precache of `/bots`, cold-offline reload verification.
- Versioned `localStorage` resume, corrupt/finished snapshot handling.
- The brief’s original human-red, one-die, manual-pass assumptions are stale relative to the current two-dice engine; they were not revived.
- The bot is a deterministic heuristic, not a deep search or difficulty-tiered AI.

No network calls are made by the direct `/play` bot mode. Online party APIs and `/api/ws` were not modified.
