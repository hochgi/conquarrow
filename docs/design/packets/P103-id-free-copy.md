# P103 — Player-facing copy never shows an arrow id, and the camera is free while a seat thinks

> **Not a game-rule change.** Web adapter only. No SPEC.md edit, no
> `online-api` change, no new request, no new AWS. Agent-facing text (the BYOK
> and MCP prompts) keeps its ids: agents need them, and both agents keep
> getting the same context.

**Status:** spec. **Depends on:** P35, P48, P49, P52, P77, P101, P102.
**Issue:** [#120](https://github.com/hochgi/conquarrow/issues/120) (items 5,
6 and 7 — the rest of it).
**Spec:** [id-free-copy](../../spec/id-free-copy/id-free-copy.md).

## Symptom

1. The strip says `Selected: 2 on tiling:a:1,-2,2 · 4 of 5`, the merge buttons
   say `Merge into tiling:a:0,-2,0`, the count note says
   `1 head stays on tiling:a:…`, and two refusals say
   `Too far for the stack on tiling:a:…` /
   `The stack on tiling:a:… has no move left this turn`. Arrow ids mean nothing
   to a player (playtest 2026-11-02, FINDINGS §1).
2. On a phone the player can't pan or zoom while it isn't their turn, for the
   whole time another seat is *thinking*, not just while its moves play.
3. `No steps left — passing…` sits for about 2 s before the next seat's moves
   animate.

## Decisions (adapter BSSN — normative detail is the spec)

1. **Copy names a stack by its size, never by its arrow.** One pure module,
   `stackCopy.ts`, owns the words: `Selected: 2 heads · 4 of 5`,
   `1 head stays where the last run began`, `Too far for the selected stack`,
   `The selected stack has no move left this turn`.
2. **A merge button says which of your stacks and which way.**
   `Merge into your 3-stack, up-left`. The way is one of eight screen
   directions from the selected stack's tile centre to the target's
   (`compassWord`), read from the layout App already draws with. No new naming
   system; no direction when the centres coincide or nothing is selected.
3. **A source-scan test** fails any template literal in `packages/web/src`
   that reads as a sentence (has a space) and interpolates an arrow-ish
   `String(…)`. Agent prompts (`targets.ts`) are allowlisted with that reason.
4. **Camera lock follows the moves on screen, not the camera-save window.**
   P48 already says the wait for a seat's decision is outside the lock; App
   fed it `replayOpen`, which stays open from the first replayed hop until
   control returns. The lock now reads `showingMoves` — an online batch is
   playing or queued, or a local seat's moves are being applied. The
   camera-save window (save, restore) is unchanged.
5. **The passing delay is not a client delay.** The online pass posts at
   `setTimeout(…, 0)`. What the player waits on is the POST, the reconcile's
   `GET` game and `GET …/log`, then the replay's first camera hop
   (`BASE_TIMING` scaled by the playback-speed preference — already config).
   Making it faster means an optimistic local pass or a POST that returns the
   log window; neither is small. Left on the backlog with the measurement it
   needs.

6. **Source scans read the committed source under Stryker.** The scoped
   mutation run failed its initial test run because a scan of `spectate.ts`
   read the instrumented copy. `committedDir` (test support) maps the sandbox
   path back to the working tree. Harness fix, no product effect.

## Out of scope (stay on the backlog)

Seat names everywhere (#119). Board badges on merge targets and
hover-to-highlight (playtest FINDINGS §1). Animation pacing (#124). The
passing round trips (D5). Keeping a pan made between two replayed seats (the
restore still returns to the camera saved before the first hop).
