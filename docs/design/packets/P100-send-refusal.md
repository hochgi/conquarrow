# P100 — A refused Send says why and keeps the route

> **Not a game-rule change.** Web adapter, the submit note, the input mode and
> the board's pointer handlers. One breaking contract edit: `SubmitOutcome`
> loses `refused` and gains one reason per guard. No `online-api` change. No
> SPEC.md edit. No new AWS.

**Status:** spec. **Depends on:** P94, P95, P98. **Issue:** [#129](https://github.com/hochgi/conquarrow/issues/129) (first half).
**Spec:** [send-refusal](../../spec/send-refusal/send-refusal.md).

## Symptom

P98 playtest, phone, seat C: six taps on **Send**, across two 4-stacks. Each
time the route dock closed and the draft cleared, the stack stayed put, and
nothing was shown. The server still had C to move, so no request was made.

## Cause

`submitMoves` returns `refused` without a request when any of its guards
fails. `online-submit.ts` has no note for `refused` (or `illegal`), so the
note is `undefined`. `commitSnap` then calls `mode.reset()` whatever the
outcome, so the draft is gone too. Which guard fired on the phone is not
known; this packet makes it visible.

## Decisions (adapter BSSN — normative detail is the spec)

1. **One reason per guard.** `refused` is replaced by `SubmitRefusal`:
   `not-ready`, `sending`, `held`, `signed-out`, `no-game`, `no-moves`,
   `replaying`, `game-over`, `not-your-turn`. A pure `submitRefusal` picks the
   first failing guard in that order. Breaking change to the contract;
   callers are in `packages/web` only.
2. **No outcome but `sent` is silent.** `submitNote` is total over every
   outcome except `sent`. `illegal` gets a sentence too, and the host's
   `illegal()` returns that same sentence instead of the bare word.
3. **Keep the route when nothing was sent.** A pure `draftAfterSubmit` says
   `keep` for every refusal and `clear` for every outcome that reached the
   server (`sent`, `illegal`, `stale`, `forbidden`, `failed`,
   `unauthorized`). On `keep` the input mode's new `restoreSent()` puts the
   route phase back exactly as it was before Send, unless the player has done
   something since.
4. **A cancelled pointer ends the drag.** The board handles `pointercancel`
   and `lostpointercapture` by dropping that pointer, the pinch and the drag.
   `touch-action: none` is already on the board SVG. No DOM in CI; this is a
   phone check.

## Out of scope (backlog)

- Held-submit self-heal (send or rebase a held submit when `/me` is valid).
- A stuck-replay watchdog.
- A `not-your-turn` re-fetch of the game and `/me` before refusing.
- Turn and seat copy in the HUD (#120).
