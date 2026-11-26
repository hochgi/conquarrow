# P102 — A lost seat is greyed out with a one-time toast, and a finished online game draws the server's standings

> **Not a game-rule change.** Web adapter. The lost set is `isLost` on the
> displayed rules state. `GET` already sends `summary` (P95); the client was
> dropping it. No `online-api` change. No SPEC.md edit. No new request. No
> new AWS.

**Status:** spec. **Depends on:** P36, P37, P95, P101. **Issue:** [#120](https://github.com/hochgi/conquarrow/issues/120) (items 3 and 4 only).
**Spec:** [lost-seat-standings](../../spec/lost-seat-standings/lost-seat-standings.md).

## Symptom

1. A seat that loses (destitute mid-turn, or starvation at the round boundary)
   stays in the seat line looking alive. Nothing is struck through, nothing is
   greyed, and nothing says the seat is gone. In playtests seat A was gone for
   several turns before anyone noticed. The server already eliminates correctly
   (P95).
2. A finished online game still shows the winner banner plus the local
   `matchSummaryLine`. P95 already returns `summary` on `GET` of a finished
   game. The web never reads it.

## Decisions (adapter BSSN — normative detail is the spec)

1. **The seat line is a view model.** `seatLineView` marks a lost seat struck
   and greyed, and gives it the accessible name `C — eliminated`. The visible
   kind text stays (`C=Agent`). Lost seats stay in the line. Local and online.
2. **One toast per newly lost seat.** `newlyLost` diffs two snapshots. The
   first snapshot of a mount, and the first snapshot of a new match identity,
   emit nothing. Later snapshots emit one toast per new letter, in lost-set
   order. The sentence uses the P101 label. `you` is `You were eliminated`.
3. **Online game-over standings.** `standingsView` builds the table from
   `GameSummary` plus the seats the GET already parsed. Winner first, then
   server order. The caller's human row is `you`. Missing `summary` keeps
   today's winner line. Local games keep `matchSummaryLine` and get no table.
4. **No new naming.** Labels are `you`, `your agent`, `AI`, the owner name
   P101 already parses, or the seat letter. The roster rename stays #119.

## Out of scope (stay on the backlog)

Raw `tiling:` ids in copy. The `passing…` delay. Camera lock. Animation pacing
(#124). Seat names everywhere (#119), including the lobby roster and lobby
chips. The Send self-heal (#129 part 2). Any server change. A local standings
table (local keeps `matchSummaryLine`).
