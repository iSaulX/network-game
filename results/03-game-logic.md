# Task 03 — Parchís game engine (Classic mode): completion summary

Status: **complete**. All engine code and tests are in place; `bun test` and the TypeScript check pass. `bun run lint` could not be run in the implementation environment (see "Commands and results") and must be run once locally before merging.

## Files

All files are new. No existing source files were changed apart from documentation.

| File | Purpose |
| --- | --- |
| `lib/parchis/constants.ts` | Board contract: 68-square track, starts 0/17/34/51, progress 0–63 / home column 64–70 / goal 71, the 12 safe squares, limits, bonus distances. |
| `lib/parchis/types.ts` | Public JSON-safe types: `GameState`, `Player`, `Token`, `Move`, `BonusMove`, `PlayerConfig`, `DieValue`, and the `GameEvent` union (`roll`, `enter`, `advance`, `capture`, `bonus-move`, `bonus-forfeited`, `pass`, `three-sixes`, `win`; every event has `turn`). |
| `lib/parchis/errors.ts` | `GameError` with a stable `code` and `isGameError()`. |
| `lib/parchis/rules.ts` | Pure helpers: `absoluteTrackIndex`, `isSafeTrackIndex`, `getCurrentPlayer`, occupancy/barrier helpers, `canEnter`, `checkAdvance` (single source of truth for movement legality), `getLegalMoves`, `getLegalBonusMoves`, `validateState` (invariant checker). |
| `lib/parchis/engine.ts` | Actions: `createGame`, `rollDie`, `roll`, `applyMove`, `pass`, `applyBonusMove`, `isFinished`, `getWinnerId`. |
| `lib/parchis/index.ts` | Public entry point (`@/lib/parchis`). |
| `lib/parchis/test-helpers.ts` | Test-only: position builder (`makeState`), `deepFreeze`, `progressAt`, seeded `mulberry32`, `errorCode`. Not re-exported. |
| `lib/parchis/rules.test.ts` | Board constants and edge cases 16–23. |
| `lib/parchis/engine.test.ts` | Edge cases 1–15 and 24–26, plus `rollDie`. |
| `lib/parchis/simulation.test.ts` | Edge case 27 (500 seeded games) and a determinism replay check. |
| `lib/parchis/bun-test.d.ts` | Minimal ambient types for `bun:test` (see Deviations). |
| `architecture.md` | Game engine section rewritten from "planned" to the implemented design; structure, task list and status updated. |
| `results/03-game-logic.md` | This summary. |

## How it satisfies the brief

- **Pure and framework-free:** `lib/parchis/` imports nothing outside itself (verified by grep: no React, PixiJS, Next.js, drawably, `window`, `document` or `localStorage`). No dependencies were added.
- **Purity:** every action validates against the untouched input, then builds a new state from copied players/tokens and a copied log array (events are immutable objects, so the log is append-only). Tests run against deep-frozen states throughout (`makeState` freezes by default), and a dedicated test checks that a frozen input is byte-identical after a full roll/move/bonus/pass sequence.
- **Rules:** implemented exactly as specified for Classic mode: entry only on 5, mandatory and a complete move; a blocked start lets the 5 move a route token; a 6 moves 7 when no token is in the yard; barriers block passing and landing for everyone; no captures and no mixed colours on safe squares; the home column and goal are private; exact goal; mandatory exact 20/10 bonuses with no chaining, auto-forfeited and logged when impossible; the fourth token ends the game with no bonus or extra roll; the three-sixes penalty is applied inside `roll`.
- **Movement legality** lives in one function (`checkAdvance`), shared by normal moves and both bonuses, so bonuses automatically obey barriers, safe-square sharing, occupancy and exact goal.
- **Deterministic ordering:** moves are returned in token-array order; when entry is mandatory, one `ENTER` per yard token.
- **Invariants** from the brief are encoded in `validateState()` and checked after every action of every simulated game, along with an append-only check of the log (all previous entries kept by reference).

## Commands and results

- `bun test lib/parchis` (bun 1.4.4): **49 pass, 0 fail, 2,788 assertions, ~3 s.** The simulation played **500 games** (2, 3 and 4 players in rotation), 276,118 actions in total; the longest game took 1,190 actions (cap 20,000). Every game ended with a winner and valid invariants.
- Mutation check: six rules were deliberately broken one at a time (safe-square rule, barrier passage, 6→7 conversion, mandatory entry, three-sixes return, no home bonus on a win). Each one made between 2 and 6 tests fail; the clean code passes. This confirms the tests actually exercise the rules.
- TypeScript: `tsc` over `lib/**/*.ts` with the project's `tsconfig.json` (strict) passes, also with `--noUnusedLocals --noUnusedParameters`.
- **Not run:** `bun install`, `bun run lint` and the project-wide `bunx tsc --noEmit`. The implementation environment could not reach the npm registry, so `eslint-config-next` was not installed. Run locally before merging:
  ```
  bun install
  bun test
  bunx tsc --noEmit
  bun run lint
  ```

## Rule interpretations and deviations

1. **`bun:test` types.** The project has no `@types/bun`, and the brief forbids new dependencies, so `bunx tsc --noEmit` would fail to resolve `bun:test` in the test files. `lib/parchis/bun-test.d.ts` declares the small subset of the API the tests use. If the team adds `@types/bun` later, delete this file.
2. **Extra error code.** `absoluteTrackIndex` throws `INVALID_POSITION` for progress outside 0–63. The brief's list of codes was given as examples, so this was added instead of overloading `INVALID_STATE`.
3. **`lastRoll` during an extra roll.** After a 6 resolves, the state returns to `awaiting-roll` for the same player with `lastRoll` still `6`, so the UI can keep showing the last die. `moveDistance` is cleared. Both are fully reset when the seat changes, as required.
4. **`moveDistance` in the bonus phase** is `null`; the bonus distance is implied by `bonus.kind`.
5. **Third-six `roll` event** is logged with `moveDistance: 0` (the die is not used), followed by the `three-sixes` event, whose `returnedTokenId` is `null` when nothing was eligible.
6. **"All tokens out" for the 6→7 rule** uses the brief's literal definition, `zone !== "yard"`, so goal tokens count as out.

## Follow-ups

- Task 04 (server) and Task 06 (local controller) should call `getLegalMoves`/`getLegalBonusMoves` and call `pass` themselves when the list is empty (the engine never auto-passes).
- The PixiJS board must render the constants in `constants.ts` exactly.
- Consider adding `"test": "bun test"` to `package.json` scripts (not done here to stay within scope).
