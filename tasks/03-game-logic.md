# Task 03 — Parchís game engine (Classic mode)

**Read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Outcome

Build a pure, deterministic, framework-free TypeScript engine for classic Parchís: board constants, rules, legal-move generation, turn/phase state machine, captures, bonuses, win detection, and a comprehensive test suite. No UI, no PixiJS, no React, no networking.

## Rule-set decision (read this first)

This project uses **Classic mode**, not Spanish mode:

- **Classic mode:** two tokens of different colours may **not** share a safety square. Passing over a safety square is allowed; resting on one with another colour is not. Mixed-colour blockades therefore cannot exist.
- **Spanish mode (excluded):** different colours may share a safety square and form a mixed-colour blockade.

Everything else is standard one-die Parchís: enter on 5, 6 grants another roll, 6 counts as 7 when all four tokens are out of the yard, capture sends a token home and grants a 20-space bonus, reaching the goal grants a 10-space bonus, barriers block movement, three consecutive 6s are penalised, and the goal requires an exact roll.

Do not implement power-ups, two-dice Parcheesi, a "free entry" first roll, "bounce" from the goal, or the "aplastar" start-square capture exception.

## Deliverable

New module under `lib/parchis/`, for example:

```
lib/parchis/
  constants.ts    board geometry, safe squares, limits
  types.ts        public types
  errors.ts       GameError and codes
  rules.ts        pure helpers: occupancy, barriers, legal moves, bonuses
  engine.ts       createGame, roll, applyMove, pass, bonuses, win
  index.ts        public exports
  engine.test.ts
  rules.test.ts
  simulation.test.ts
```

The engine must be importable from `lib/parchis` and must not import React, PixiJS, Next.js, or any browser/DOM API. Use `bun test`; do not add dependencies.

## Board model and constants

These constants are part of the contract; the future PixiJS board must render them exactly.

| Constant | Value |
| --- | --- |
| Outer track squares | 68, indexed `0…67` |
| Colour start squares | red `0`, blue `17`, yellow `34`, green `51` |
| Outer route progress | `0…63` |
| Private home-column squares | `64…70` (7 squares) |
| Goal | `71` |

- For a token on `progress 0…63`, its absolute outer-track index is `(startIndex + progress) % 68`.
- Every player traverses 64 outer squares and skips the four squares immediately before their start square.
- Progress increases in one consistent rotational direction for every player.
- Home column (`64…70`) is private: only that player's tokens may occupy it. No captures, no barriers, no occupancy limit there.
- Goal (`71`) is private and may hold all four of that player's tokens.
- Safe squares are the four start squares plus two per colour, at `start + 4` and `start + 11` (mod 68):
  - starts: `0, 17, 34, 51`
  - safes: `4, 11, 21, 28, 38, 45, 55, 62`
  - total: **12 safe squares**
- The last outer square before a home column is `progress 63`; it is **not** safe by default.
- A token in the yard has `zone: "yard"` and `progress: null`. On the route it has `zone: "path"` and `progress 0…70`. At the goal it has `zone: "goal"` and `progress: 71`.

## Setup and turn order

- Support **2–4 players**. Each player supplies `{ id, color }`; IDs and colours must be unique, colours must be one of `red | blue | yellow | green`.
- The array order is the turn order; `players[0]` starts. The lobby/server can shuffle seats before creating the game.
- The engine allows any distinct colour set. For 2 players, red + yellow (opposite corners) is recommended by the lobby, but not enforced by the engine.
- Each player has four tokens in the yard, IDs `"<playerId>-0"` … `"<playerId>-3"`.
- `mode` in the state is always `"classic"`.

## Turn flow

1. Current player rolls one d6 (value supplied by the caller).
2. Roll 6 grants another roll after the turn is fully resolved, unless it is the third consecutive 6 or the game ends.
3. If no legal move exists, the caller must invoke `pass`. The engine does not auto-pass, so the roll can still be shown in the UI.
4. If a legal move exists, the player **must** move; there is no voluntary pass.
5. Resolve the move, any capture, any capture bonus, any goal, any home bonus, and win detection.
6. Then either the same player rolls again (6) or play passes to the next seat.

## Rules in detail

### Dice

- One d6 per roll. No two-dice variant.
- A roll of **6** grants an extra roll.
- If **all four** of the player's tokens are out of the yard (`zone !== "yard"`), a **6 counts as 7 movement squares**. It is still a 6 for the extra roll and for the three-six counter. The converted distance is exposed as `moveDistance`.
- With any token still in the yard, a 6 moves 6.
- No other die-value conversions.

### Entering from the yard

- A token leaves the yard **only** on a roll of 5, placed on the player's start square with `progress 0`.
- Entry is a complete move: do **not** then move 5 more squares.
- Entry is **mandatory** when a 5 is rolled and at least one yard token can enter.
- The start square can accept a token when it contains fewer than 2 tokens and no opponent token (classic mode). One own token is allowed; entering forms a barrier.
- If the start is blocked (two tokens, or an opponent on the safe start), the 5 may instead be used to move a token already on the route. If no such move exists, the player passes.
- Entry never captures. There is no "aplastar"/start-square capture exception.
- A 6 can never be used to enter.

### Movement

- Movement is always forward along the player's route, exactly the rolled/converted distance. No backward moves.
- A move may not overshoot the goal (`target > 71` is illegal). There is no bounce-back.
- A token at the goal cannot move. A token in the yard can only enter.
- A move is legal only if every square strictly between the current progress and the target is free of barriers, and the destination passes the occupancy rules below.
- Movement over/through a single token is allowed; only landing has capture/sharing rules.

### Occupancy, safe squares, and barriers

- An outer square may hold at most **2 tokens**, and only tokens of the **same colour**.
- Two same-colour tokens on one outer square form a **barrier**.
- A barrier blocks every token (including the owner's other tokens) from passing through or landing on that square.
- A token that is part of a barrier may move out normally, which opens the barrier; the other token stays.
- A single token does not block passage. It only affects who may land there.
- Landing on a non-safe square containing one opponent captures it. Landing on a non-safe square containing one own token creates a barrier. Landing on any square with two tokens is illegal.
- **Safe squares** (12 of them, including all start squares):
  - Captures are impossible on a safe square.
  - In classic mode, a safe square may not contain tokens of two different colours. Landing there with an opponent present is illegal.
  - Passing over a safe square is allowed.
  - A same-colour second token may land on a safe square and form a barrier.
  - An opponent occupying your start square blocks entry; it cannot be captured there.
- Mixed-colour blockades do not exist in classic mode.
- A barrier may exist on a safe square (two same-colour tokens only).

### Capturing and the 20-space bonus

- Capture happens only by **landing** (not passing) on one opponent token on a non-safe outer square.
- The captured token returns to its yard (`zone: "yard"`, `progress: null`).
- After the move resolves, the capturing player must move **any one of their own route tokens exactly 20 squares** if at least one legal 20-space move exists. This is the capture bonus.
- The 20-space bonus:
  - is mandatory when legal; the player chooses which token;
  - must be exactly 20 squares in full, never split or shortened;
  - obeys barriers, safe-square sharing, occupancy, and exact-goal rules;
  - may capture an opponent (the capture resolves normally);
  - never grants another capture bonus or a home bonus (no chaining);
  - cannot move a token out of the yard;
  - resolves before any extra roll from a 6.
- If no legal 20-space move exists, the bonus is automatically forfeited and the engine logs it.

### Home column, goal, and the 10-space bonus

- A token reaches the goal only by an **exact** move to `progress 71`; overshooting is illegal for that token.
- The home column and goal are private and safe. No captures, no barriers, no occupancy limits.
- When a token reaches the goal on a normal move, the player must move **any one of their own route tokens exactly 10 squares** if at least one legal 10-space move exists. This is the home bonus.
- The 10-space bonus follows the same mandatory/exact/no-chain rules as the 20-space bonus.
- If the token that reached the goal was the player's fourth, the game ends immediately; no 10-space bonus is played.
- A bonus move that reaches the goal does not trigger another home bonus.

### Extra rolls and three consecutive 6s

- After a 6 move and all bonuses resolve, the same player rolls again.
- A 6 with no legal move still grants another roll after `pass` (the die face is 6), unless it is the third consecutive 6.
- Consecutive 6s persist across extra rolls within the same turn and reset on any non-6 roll or when the turn passes to another player.
- On the **third consecutive 6**:
  - the 6 is not used to move, even if moves exist;
  - the turn ends immediately, with no extra roll and no bonus;
  - the token most recently moved by this player during this turn (normal move or bonus move) returns to the yard if it is on the outer track (`progress 0…63`);
  - if that token is in the home column (`64…70`) or at the goal (`71`), it is not returned;
  - if no token was moved this turn, no token is returned;
  - the return is not a capture and triggers no bonus.
- The counter resets when the next player's turn starts.

### Passing and turn end

- `pass` is legal only in `awaiting-move` when `getLegalMoves()` is empty. Passing with legal moves throws `MUST_MOVE`.
- Pass on a non-6: advance to the next player.
- Pass on a 6: same player gets an extra roll; `consecutiveSixes` stays incremented and the last-moved token (if any) remains recorded for the three-six penalty.
- When the turn passes to another player, reset `lastRoll`, `moveDistance`, `consecutiveSixes`, `lastMovedTokenId`, and `bonus`.
- Extra rolls keep the same player, turn number, and `lastMovedTokenId`.

### Winning

- The first player to have all four tokens at the goal (`zone: "goal"`) wins.
- The game ends immediately: `phase: "finished"`, `winnerId` set, no further bonus or extra roll.
- No ranking for the other players in this task.

## Public state and API

Use JSON-safe types. The full state is public (Parchís has no hidden information), so it can later be broadcast by the network layer. Do not store functions, `Map`, `Set`, or `Date` in state.

Suggested public types:

```ts
export type Color = "red" | "blue" | "yellow" | "green";
export type Zone = "yard" | "path" | "goal";
export type Phase = "awaiting-roll" | "awaiting-move" | "awaiting-bonus" | "finished";
export type BonusKind = "capture-20" | "home-10";

export interface Token {
  id: string;
  playerId: string;
  zone: Zone;
  progress: number | null; // null in yard, 0–70 on path, 71 at goal
}

export interface Player {
  id: string;
  color: Color;
  seat: number;
  tokens: Token[];
}

export interface GameState {
  schemaVersion: 1;
  mode: "classic";
  players: Player[];
  currentPlayerIndex: number;
  phase: Phase;
  lastRoll: 1 | 2 | 3 | 4 | 5 | 6 | null;
  moveDistance: number | null; // 6 becomes 7 when all tokens are out
  consecutiveSixes: number;
  lastMovedTokenId: string | null;
  bonus: { kind: BonusKind; playerId: string } | null;
  winnerId: string | null;
  turn: number; // increments when the current player changes
  log: GameEvent[];
}

export type Move =
  | { type: "ENTER"; tokenId: string }
  | { type: "ADVANCE"; tokenId: string; to: number };

export type BonusMove = {
  kind: BonusKind;
  tokenId: string;
  to: number;
};
```

Define a serializable `GameEvent` union covering at least: roll, enter, advance, capture, bonus move, bonus forfeited, pass, three-sixes penalty, and win. The event log is what the future PixiJS/React layers will animate from.

Required functions:

```ts
createGame(players: { id: string; color: Color }[]): GameState
rollDie(random?: () => number): 1 | 2 | 3 | 4 | 5 | 6
roll(state: GameState, value: 1 | 2 | 3 | 4 | 5 | 6): GameState
getLegalMoves(state: GameState): Move[]
applyMove(state: GameState, move: Move): GameState
pass(state: GameState): GameState
getLegalBonusMoves(state: GameState): BonusMove[]
applyBonusMove(state: GameState, move: BonusMove): GameState
isFinished(state: GameState): boolean
getWinnerId(state: GameState): string | null
absoluteTrackIndex(color: Color, progress: number): number // only 0–63
isSafeTrackIndex(index: number): boolean
```

Behavioral contract:

- All functions are **pure**: never mutate the input state or any nested object; return a new state. Tests will deep-freeze inputs.
- `roll` handles the third-six penalty at roll time and never leaves `awaiting-move` for a turn that has already ended.
- `applyMove` validates against `getLegalMoves`. It resolves capture, bonus phase, win, and extra-roll/next-player transitions.
- If a move triggers a bonus but no legal bonus move exists, `applyMove` auto-forfeits, logs it, and continues. It must never leave `awaiting-bonus` with an empty legal set.
- If a legal bonus exists, `applyMove` leaves `phase: "awaiting-bonus"` and `applyBonusMove` is required; there is no skip.
- `pass` only advances the turn (or grants the 6 extra roll); it never rolls.
- `getLegalMoves` and `getLegalBonusMoves` return deterministic ordering (token array order; if entry is mandatory and multiple yard tokens can enter, one `ENTER` per yard token).
- Invalid actions throw a `GameError` with a stable `code`, for example: `INVALID_PLAYERS`, `INVALID_ROLL`, `WRONG_PHASE`, `ILLEGAL_MOVE`, `MUST_MOVE`, `INVALID_BONUS`, `GAME_OVER`, `INVALID_STATE`. The state is untouched.
- Actions are implicitly taken by the current player; the future network layer authenticates the sender and checks whose turn it is.
- Export a `getCurrentPlayer(state)` helper if useful to callers.

## Expected behavior: edge cases the tests must cover

At minimum:

1. `createGame` rejects 0, 1, and 5 players, duplicate IDs, duplicate colours, and unknown colours. 2–4 players produce 4 tokens each, all in the yard.
2. Entry only on 5; a 5 with a free start and a yard token offers only entry moves (mandatory), even if another token could otherwise move.
3. A blocked start (two own tokens, an opponent, or an opponent barrier) makes entry illegal and allows the 5 to be used by a route token.
4. Entry onto a start holding one own token creates a barrier; entry onto two own tokens is illegal.
5. A 6 with tokens in the yard moves 6; a 6 with all four tokens out of the yard moves 7 and still counts as a 6 for extra rolls and the three-six tally.
6. A 6 with no legal moves still grants an extra roll through `pass`; a non-6 with no legal moves passes the turn.
7. Three consecutive 6s: no move on the third, last moved token on the outer track returns to the yard, token in home column/goal is exempt, turn ends, no extra roll.
8. Passing with legal moves throws `MUST_MOVE`; moving when no move exists or in the wrong phase throws.
9. Exact goal: a token at `70` needs exactly 1; a roll that overshoots is illegal for that token; a goal token cannot move.
10. Reaching the goal with the fourth token ends the game immediately; no 10-space bonus and no extra roll.
11. Reaching the goal with a non-final token grants a mandatory 10-space bonus if any legal 10 exists; if none, it is forfeited.
12. Capture on a non-safe square sends the opponent to the yard and grants a mandatory 20-space bonus if any legal 20 exists.
13. The 20 bonus must be exactly 20, cannot be split, can capture, and a capture during the bonus grants no further bonus.
14. The 10 bonus must be exactly 10, can capture, and cannot chain a capture/home bonus.
15. Bonus moves obey barriers, safe-square sharing, occupancy, and exact-goal.
16. No capture on any safe square, including start squares.
17. Classic safe-square rule: a different colour cannot land on an occupied safe square; passing over it is allowed; the same colour may land and form a barrier.
18. A single token does not block passage; a two-token barrier blocks passage and landing for everyone, including the owner's other tokens.
19. A token that is part of a barrier can move out and open it.
20. At most 2 tokens per outer square; a third (of any colour) cannot land.
21. Home column and goal are private/safe: no captures, no barriers, no occupancy limit, and only the owner's tokens can enter.
22. The home entrance (`progress 63`) is not safe unless its absolute index happens to be in the safe set; barriers there still block.
23. `getLegalMoves` returns no moves when all options are blocked by barriers, occupancy, or overshoot.
24. `applyMove`/`applyBonusMove` do not mutate input; deep-frozen states work.
25. JSON round-trip (`JSON.parse(JSON.stringify(state))`) preserves the exact state and future behavior; replaying the same rolls/moves from the same start is deterministic.
26. 2-, 3-, and 4-player games use the configured seat order; extra rolls do not change the seat; turn number increments only when the seat changes.
27. Simulation: at least **500** games driven by a seeded PRNG and random legal actions terminate with a winner under a generous action cap (e.g. 20,000) and satisfy state invariants after every action.

## Invariants

After every action:

- Every player still has exactly 4 tokens with stable IDs.
- `zone: "yard"` ⇔ `progress === null`; `zone: "path"` ⇔ `0 ≤ progress ≤ 70`; `zone: "goal"` ⇔ `progress === 71`.
- No outer square has more than 2 tokens or tokens of more than one colour.
- `currentPlayerIndex` is valid; `phase` is consistent with the state; `winnerId` is set exactly when `phase === "finished"`.
- The game log is append-only and serializable.

## Out of scope

- PixiJS rendering, React components, app screens, animations, sound, layout, or Spanish UI copy.
- Networking, rooms/party codes, websockets, server authority, persistence, reconnect, spectators.
- AI opponents, matchmaking, accounts, profiles, avatars.
- Power-ups, 2-dice Parcheesi, Spanish mode, local rule variants.
- Auto-passing, timers, or turn clocks.

## Acceptance criteria

- `bun test` passes and covers every edge case listed above.
- `bunx tsc --noEmit` passes.
- `bun run lint` passes.
- `lib/parchis/` imports no React, PixiJS, Next.js, or browser APIs.
- All functions are pure; frozen inputs do not throw and are not mutated.
- 500 simulated games complete with a winner and valid invariants.
- No new dependencies.
- `architecture.md` is updated.

## Definition of done

- Update `architecture.md` with: the engine location and module boundaries, the Classic-mode rule decisions, board constants, phase/API summary, test command, and the fact that the engine has no UI or network dependencies.
- Report the files added, the commands run, the number of tests/games simulated, and any rule interpretation you had to make.
- Flag any place where this brief was ambiguous rather than silently inventing a rule.
