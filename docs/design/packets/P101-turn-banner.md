# P101 — The turn banner never says "you" for a seat that isn't yours

> **Not a game-rule change.** Web adapter, the in-play turn banner and its hint.
> No `online-api` change: `GET` game already sends an agent seat's `label`.
> No SPEC.md edit. No new AWS. No new request.

**Status:** spec. **Depends on:** P18, P49, P94, P96. **Issue:** [#120](https://github.com/hochgi/conquarrow/issues/120) (items 1 and 2 only).
**Spec:** [turn-banner](../../spec/turn-banner/turn-banner.md).

## Symptom

In an online game, while an agent seat or a heuristic seat is active, the banner
reads `Turn: Player C · you` and the hint says `Your turn — gold-outlined stacks
can still move`. A minute-long agent turn looks like a frozen game.

## Cause

`Hud.tsx` appends ` · you` whenever `vsBot && !botBusy`. Online agent and
heuristic turns are never `botBusy` on this client. `activeIsAi` in `App.tsx`
comes from `aiSeatsRef`, which is the local seat plan, so it is wrong online.
Input is already locked: the server returns 403 `agent-seat`, and
`isCallerToMove` matches only the caller's human seat. Only the copy and the
indicator are wrong.

## Decisions (adapter BSSN — normative detail is the spec)

1. **One pure function owns the words.** `turnBannerCopy` in
   `packages/web/src/turnBanner.ts` returns the banner parts, the hint, and
   whether a thinking indicator shows. Local hot-seat and local vs-bot go
   through it too.
2. **Never "you" unless it is the caller's human seat.** The caller's own agent
   says `your agent is playing…`, not `you`. Another human says `B is playing…`.
   A heuristic says `AI is playing…`. Another agent's owner name is used only
   when the GET seat `label` already carries one (`Agent (Ada)`); otherwise the
   seat letter.
3. **Online facts come from the game seats, not the local plan.** Seat `i` is
   `players[i]` (P18). Missing seats or a missing `/me` never say `you`.
4. **A thinking indicator while it isn't your turn and no replay is playing.**
   Reuse the P94 spinner keyframes. `prefers-reduced-motion` slows the spin, as
   P94 does. Local matches get no new spinner.

## Out of scope (backlog, rest of #120)

Eliminated-seat greying and toast. The game-over summary. Raw `tiling:` ids in
copy. The `passing…` delay (the sentence stays). Camera lock and retargeting
`activeIsAi`. The full seat label with names everywhere (#119), including the
roster's "your agent". Animation pacing.
