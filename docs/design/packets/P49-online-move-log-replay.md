# P49 — Online move-log replay

**Depends on:** P48 (the camera), P14–P20 (the online track).
**Layer:** `online-api` (new read route) + web adapter. No rules change.

## Why this is a packet and not a paragraph of P48

P48's trigger predicate is "the seat to move is not driven by whoever is at this
keyboard", which by intent covers remote humans online. It cannot be honoured
today, because **the client never sees a remote turn's moves.**

Transport is a WebSocket wake plus a full state re-GET:

- Server pushes `{type:'stateChanged', version, groupHash, gameNumber}`
  (`packages/online-api/src/game-handlers.ts:161-168`).
- Client handles it (`packages/web/src/online-pages.ts:370-380`) → `getGame`
  (`:230-239`) → `GET /games/{groupHash}/{gameNumber}` returns a **full state
  snapshot** (`game-snapshot.ts:46-111`), with no moves array.
- Client installs it wholesale: `hydrateState` → `stateRef.current = game`
  (`App.tsx:343-357`). It does **not** call `commitApplied`, so no FX are pushed
  and no per-move log entries exist for the opponent's turn.

So online play today has neither a camera problem nor a move list — it has no
per-move presentation at all. Adding the camera means adding the moves, and
adding the moves means adding FX for them too.

The data exists. `log.jsonl` (`online-api/src/s3-keys.ts:29-30`) is appended one
JSON move per line by `appendLog`/`persistPosition` (`game-handlers.ts:123-149`),
including heuristic-bot bursts (`runBurst`, `:99-120`). **No GET route serves
it.**

## What ships

1. **A read route.** Either `GET .../log` or, better, moves-since-version so a
   client that has been away does not pull an entire match. Version numbering
   already exists on the snapshot; the route should key off it.
2. **A client replay path.** On `stateChanged`, fetch the moves since the version
   we hold and drive them through `commitApplied` — which gets FX and match-log
   entries for free — instead of snapshot-swapping. Keep the snapshot install as
   the fallback for a gap too large to replay.
3. **P48's predicate extended** by one clause: online seats whose `userHash` is
   not ours are spectated. `online-pages.ts:89-130` already has `ownSeatIndex` /
   `isCallerToMove`.

## Decided

### Backlog policy: queue and replay everything, in order

When snapshots arrive mid-replay, queue them and replay every turn in order.
Nothing is skipped.

This is safe *because* online seats 0 and 1 are forced human
(`coerceOnlineSeatPlan`): the game stops and waits for you, so a client can never
fall arbitrarily behind. Every human sees the same replay before they act, and
acting humans are slow relative to playback. A bounded budget was considered and
rejected as machinery guarding against a state this game cannot reach.

Revisit if viewers (P20+) ever land — a pure spectator has no turn to stop at,
and is the one participant who could fall behind without limit.

### Cold start: install the snapshot, replay nothing

`getGame` also fires on tab visibility (`online-pages.ts:387-395`) and on a fresh
page load. Do **not** replay the backlog there — install the snapshot and open at
the current state, whatever it is.

So the governing rule is: **replay from what this client last displayed, never
from what the server last stored.** No displayed baseline, or a non-contiguous
gap, means snapshot install. Replaying an absence is archaeology, not
presentation.

Downloading the match log for local replay is the eventual answer for players who
want the history. Not now; the match log already exists (`matchLog.ts`) and a
replay button is on the P20+ list.

### FX parity with local play

Remote turns route through `commitApplied`, so online play gains the full effects
layer it has never had: captures, cuts, combat, conversions. This is a much
larger visible change than "add a camera" and it is intended — **online should
feel the same as local**. Moves without FX would be a camera flying to a spot
where nothing visibly happens, which is worse than today's silence.

### Divergence: log loudly, mitigate nothing

If replayed moves produce a state disagreeing with the authoritative snapshot,
that is a **bug**, not a condition to handle. The core is pure and the log is
ordered; a mismatch means one of those two claims is false and the game state is
broken. Log it loudly enough to be found and fixed. Do not reconcile, do not
paper over it, do not show the player a message they cannot act on. BSSN — deal
with it if it ever happens.

## In-bounds for phase 1 to decide BSSN

The route shape (`GET .../log` versus moves-since-version), pagination, and the
S3 read cost per wake. None of these change what the player experiences, and
AGENTS.md puts online/infra judgement in bounds when it is written down.
Moves-since-version is the better starting point: version numbering already
exists on the snapshot, and it avoids pulling a whole match to show one turn.

## Prior open questions, now closed

The mid-replay pileup and the divergence question above were the reason this
packet was deferred out of P48. Both are answered; the packet is ready.

## Out of scope

Everything P48 ships. This packet adds the moves; the camera is already built.
