# P69 — online hardening (P68 / #63 follow-ups)

**Local agent handoff:** `/spec-to-ship docs/design/packets/P69-online-hardening.md`

Phase 1 writes [`docs/spec/online-hardening/`](../../spec/online-hardening/)
(core + edge-cases `.feature`, EARS). **Layer:** `online-api` only.
**Depends on P17, P18, P68.** No game rule is added, changed, or implied:
every range below is already stated in `packages/contracts`.

## Why this exists

The mutation drive in #63 left three follow-ups:

1. **The `Bearer` scheme is matched case-sensitively** in
   `src/google-tokeninfo.ts` (`/^Bearer\s+(\S+)$/`). RFC 9110 §11.1 makes the
   auth-scheme token case-insensitive, so `bearer <token>` is refused as
   `invalid` today. Our web client always sends `Bearer`; another client may not.
2. **A stored position is checked for types, not ranges** (`src/game-snapshot.ts`
   `hydrateState`). A `state.json` that the engine could never have written still
   loads — `heads: 0`, `spent: -1`, `phase: 7`, an `activePlayer` who is not
   seated — and reaches `rules-core`, whose functions assume the contract. Two
   fields are worse than unchecked: a non-string `winner` and an out-of-range
   `speedOverride` are **silently dropped**, so a corrupt finished game reloads
   as unfinished. #63 made a non-rational fraction refuse instead of throw; this
   finishes the job for every field.
3. **`src/moves.ts` is a retired 404 stub nothing deploys** — no SAM function,
   no Makefile target, no importer; only `package.json`'s `"./moves"` export
   keeps it alive.

## Scope

### a. Case-insensitive auth scheme
`bearerToken` accepts the scheme in any case (`Bearer`, `bearer`, `BEARER`).
Everything else about the header is unchanged: exactly one token after
whitespace; an empty or absent header is `missing`; anything else `invalid`.
The test fake `fakeGoogle` (`test/support.ts`) is a fake of the port and is
left alone.

### b. Range-checked hydration
`hydrateState` refuses (returns `undefined`, as for every other malformed field)
a record that breaks a range `packages/contracts/src/game-state.ts` states:

| Field | Contract | Refused when |
|---|---|---|
| `players` | "Length ≥ 2", ids | fewer than 2, or a duplicate |
| `activePlayer` | "Whose turn it is" | not in `players` |
| `groups[].owner`, `territory[].owner`, `trails[].player`, `starvationStreaks[].player` | a `PlayerId` of this match | not in `players` |
| `groups[].heads` | "At least 1" | not an integer ≥ 1 |
| `groups[].spent` | "Whole steps … taken this turn" | not an integer ≥ 0 |
| `groups[].speedOverride` | `MergeOverride = 0 \| 1` | present and not 0 or 1 (was: dropped) |
| `spawners[].phase` | "0..2" | not an integer in 0..2 |
| `starvationStreaks[].streak` | a count of full rounds | not an integer ≥ 0 |
| `dominationN` | "threshold *N* (full rounds)" | not an integer ≥ 1 (BSSN: a threshold of zero rounds is not a threshold; setup writes 5) |
| `winner` | `PlayerId \| undefined` | present and not a seated player's id (was: dropped) |
| any keyed list (`groups`, `territory`, `accumulators`, `spawners`, `trails`, `starvationStreaks`) | a `Map` — one entry per key | the same key twice |

Legacy shapes keep loading exactly as today: pre-P36 `dominationHolder` /
`dominationStreak`, pre-P46 meta, absent optional fields. A legacy streak seeded
from the retired pair goes through the same streak and membership checks;
a retired streak ≤ 0 still seeds nothing, as P36 documents.

Callers already treat `undefined` as "unreadable" (500 on the game routes,
`waiting` in `/my-games`, version 0 on the log route) — no caller changes.

### c. Retire `moves.ts`
Delete `packages/online-api/src/moves.ts` and the `"./moves"` export. Not a
behaviour change: nothing routes to it.

## BSSN decided here
1. **Refuse, never repair.** A record outside the contract is unreadable; the
   loader does not clamp, drop or default a field. Dropping `winner` was the
   dangerous case.
2. **Ranges come from the contracts only.** No range here is a game rule; where
   the contract is prose (`dominationN`, `streak`), the BSSN reading is recorded
   above.
3. **`dominationN ≥ 1`** — see the table.

## Out of scope
- Any `rules-core` / `contracts` change, or validating that arrows / vertices
  exist on the board (that needs geometry at load).
- Cross-field consistency beyond membership (e.g. `spent ≤ speed(heads)`).
- Changing `fakeGoogle`.

## Done when
- `pnpm verify` green; every scenario in `docs/spec/online-hardening/` has one
  test; `pnpm test:mutation:online-api` shows no new sensible survivor in
  `google-tokeninfo.ts` / `game-snapshot.ts`.
- `regression-dog` over the range lists only the deltas named in a and b.
