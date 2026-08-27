# P45 — Game library status (My games)

> **Status:** shipping. **Depends on:** P17, P18, P25, P27.
> Family playtest: after Google Sign-In the lobby lists `Resume 000001` with
> no won / lost / whose-turn. Players cannot tell which match to open.
>
> **Not a game-rule change.** `contracts` gains a library DTO field and a pure
> classifier. `rules-core` is read (`isLost`) from the online adapter only.
> No SPEC.md edit. No new AWS.

## Intent

Signed-in Online lobby: a **My games** button lists that user's started
games with a per-caller status. Clicking a row still resumes
`#/g/<groupHash>/<gameNumber>` (P19).

## BSSN (locked here)

### Four statuses (caller-relative)

`StartedGameRow.status` is required. One of:

| `status` | Shell label |
|---|---|
| `your-turn` | Open (your turn) |
| `waiting` | Open (waiting) |
| `won` | Won |
| `lost` | Lost |

Same game, two bearers, different rows: Alice `your-turn`, Bob `waiting`.

Classify in this order, once the caller's `PlayerId` is known
(`meta.seats` index → `players[index]`):

1. `winner === me` → `won`
2. `winner` set (someone else) → `lost`
3. `lostPlayers` contains `me` → `lost` (eliminated; match may continue)
4. `activePlayer === me` → `your-turn`
5. else → `waiting`

Lost beats your-turn (a vanished seat can still sit in the rotation and be
passed — SPEC §4 / P36). Open lobbies stay on `lobbies[]` with no status;
this list is **started games only**.

No seat for the caller on that game's meta → `waiting` (group pointer without
a chair is not a personal outcome).

Meta-only (P17 Start, no `state.json`) → `waiting`.

SPEC §11 item 44 (terminal, no `winner`): caller in `lostPlayers` → `lost`;
otherwise `waiting`. Do not invent a draw status.

### Stamp a library summary on persist — do not scan `state.json` on the happy path

Today `GET /my-games` is key listing only. Fat `state.json` per row is the
wrong shape (ADR: pointer-fan-in, not a scan).

Every persist of `state.json` (ensure + moves, including the opening burst)
writes onto that game's `meta.json` (additive, keep `seats`):

- `players` — `GameState.players` as strings (never mutates)
- `activePlayer`
- `lostPlayers` — `PlayerId` strings for which `isLost` holds, sorted
- `winner` — when set (existing P18 stamp, now the same write)

`GET /my-games` reads each listed `meta.json`. If `players`, `activePlayer`,
and `lostPlayers` are present, classify from meta. If they are missing
(games persisted before this packet) and `state.json` exists, hydrate once
and classify from that snapshot. If neither summary nor state exists →
`waiting`. Listing does not write S3.

Classifier lives in `contracts` as `libraryStatusFor` so API and shell share
one spelling. `isLost` stays in `rules-core`; only the persist/fallback path
in `online-api` calls it.

### Shell

Signed-in **Online** mode offers a **My games** control (copy `My games`).
Default **closed** (replaces the always-visible `Resume NNNNNN` list). Opening
it lists rows `{label} · {gameNumber}`. Empty: `No games yet`. Local mode and
unsigned Online do not offer it.

Sort (server): `your-turn`, `waiting`, `won`, `lost`; then `groupHash`
ascending; then `gameNumber` descending (6-digit, newest first). No clock.

Finished rows remain clickable (GET of a finished game is already allowed).

No Google `sub` on rows. No DynamoDB, no extra Lambda, no provisioned
concurrency.

## Out of scope

- Open-lobby rows inside My games (invite chrome stays)
- Recency timestamps, Elo, replay playback (P20)
- Hydrating the board into the list
- React Testing Library (P25: Lobby is chrome; labels and the classifier are
  the test surface)

## Scenario inventory

- Active human: `your-turn`; other bound human: `waiting`
- Winner: `won`; other human: `lost`
- Start, no `state.json`: both `waiting`
- Persist stamps `players` / `activePlayer` / `lostPlayers` / `winner` on meta
- Eliminated, match continues: `lost`, not `waiting`
- Unstamped meta classifies from `state.json`
- Sort order as above
- Open lobby tokens stay on `lobbies`
- 401 without bearer; other user's games omitted
- Adapter fails closed on malformed `status`
- Sign-out clears the library
- Local / unsigned: My games not offered
- Empty list copy; resume still opens the hash
- Heuristic active: humans `waiting`
- Finished row still opens
- `GET /my-games` does not write S3
- Item 44 unwon: lost caller → `lost`
