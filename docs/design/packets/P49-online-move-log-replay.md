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

## The hard part, which is why this is deferred

**Snapshots arriving mid-replay.** Three of them, in a 6-player match, while you
are two moves into replaying the first. Every option is a real design decision
and none is obvious:

- Queue them and replay in order — correct, but latency compounds and a slow
  watcher falls further behind every turn.
- Drop to the newest snapshot and abandon the replay — always current, but the
  player misses turns entirely, which is exactly the complaint P48 exists to fix.
- Replay with a bounded budget, hard-cutting to the newest state past it.

There is also **divergence**: if replay drifts from the authoritative snapshot for
any reason, the snapshot must win. That needs a reconciliation check and a
decision about what the player sees when it fires.

None of these should be answered by whoever is implementing the camera. They want
their own grilling session.

## Out of scope

Everything P48 ships. This packet adds the moves; the camera is already built.
