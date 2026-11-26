# seat-labels — one wording for every seat, with names, on every surface

**Packet:** [P105](../../design/packets/P105-seat-labels.md). Issue
[#119](https://github.com/hochgi/conquarrow/issues/119).
**SPEC:** not edited. No game rule.
**Amends:**
- [lost-seat-standings](../lost-seat-standings/lost-seat-standings.md): its `seatLabel` table grows, `Player B` replaces the bare letter, and `<name>'s agent` replaces the owner's name.
- [online-library-identity](../online-library-identity/online-library-identity.md): row labels.
- [remote-agent-mcp](../remote-agent-mcp/remote-agent-mcp.md): the agent `label` on GET game becomes `name`.

**Layer:**
- `packages/contracts`: `seat-label.ts` is new, and `InviteSeat.name`.
- `packages/online-api`: `withSeatNames` in `library-listing.ts`, `handlers.ts` and `game-handlers.ts`.
- `packages/web`: `seatLabel.ts`, `turnBanner.ts`, `online-parse.ts`, `online-pages.ts`, `online-shell-ui.ts`, `Lobby.tsx`, `App.tsx` and `styles.css`.

**Protocol:** [SCENARIOS.md](./SCENARIOS.md). Every path is a component test: server paths in `packages/online-api/test/seat-labels.scenarios.test.ts`, client paths in `packages/web/test/seat-labels.scenarios.test.ts`.
**Features:** [core](./seat-labels.core.feature) · [edge cases](./seat-labels.edge-cases.feature)

## Terms

| Term | Means |
|---|---|
| **chair** | one entry of `InviteSeat[]` |
| **bound** | a human or agent chair whose `userHash` is a string |
| **usable name** | trimmed, non-empty, not a reserved word (`you`, `your agent`, `ai`, `waiting`, compared case-insensitively), and not `Player <A–F>` |
| **member** | a user bound to any of the invite's chairs (the creator always is: P17 binds the host seat at create) |

## The table (`seatLabel`, contracts)

```
seatLabel({ letter, kind, relation, bound?, name?, sayYou }):
  kind heuristic | byok                          → 'AI'
  bound === false (human or agent)               → 'waiting'
  sayYou and relation caller-human, kind human   → 'you'
  relation caller-agent, kind agent              → 'your agent'
  kind agent:  usable name → `${name}'s agent`, else 'Agent'
  kind human:  usable name → name,              else `Player ${letter}`
```

`bound` absent means bound. `labelInviteChair({ letter, chair, userHash? })`
derives `kind`, `relation`, `bound` and the name from an `InviteSeat`, with
`sayYou: true`. A usable name is also never `Player <A–F>`, so a name cannot pose as
another seat's fallback. Because no usable name is `you`, the label `you`
comes only from row 3, which is what standings (`you: label === 'you'`) and
the toast (`You were eliminated`) rely on.

## Server (online-api)

`withSeatNames(s3, seats)` returns `seats` in order. A bound human or agent
chair gets `name` from `readProfileDisplayName(userHash)` when that returns
a string. Every other chair is unchanged. Each user's profile is read at most
once per call.

| Route | Names when |
|---|---|
| `POST /invites` 201 | always (the caller is the creator) |
| `POST /invites/:t/accept` 200 (newly bound or already bound) | always |
| `GET /invites/:t` 200 | the bearer verifies **and** that user is bound to a chair |
| `GET /games/:g/:n` 200 | always (a member route) |
| any 401 / 404 / 409 / 410 / 422 | the body is unchanged (no seats, no names) |

On `GET /invites/:t`, a missing bearer, a bearer the verifier rejects, a
verifier that throws, or a non-member all get the 200 body without names.
The peek never answers 401 and never writes a profile.

`/my-games` labels each chair with `seatLabel` (`sayYou: true`, relation
from the caller's hash, `bound` from the chair, `name` from the profile).

## Client (web)

- `parseSeats` keeps a usable-string `name` on human and agent chairs, and
  never on heuristic ones. `label` is no longer read.
- `onlineTurnSeat` reads `ownerName` from `name`, for humans and agents.
- `rosterLabel(seat, index, userHash)` labels the frozen roster:
  `seatLabel` with `bound` taken from the chair and `sayYou: true`.
- `seatLineLabels` builds the seat line (`A=you · B=Ada's agent · C=AI`).
  Online it uses the board's chairs and the caller's hash. Locally it uses
  the configured kinds with P102's `sayYou` rule.
- `peekHeldInvite` sends the bearer when a usable token exists, so a
  signed-out peek is unchanged.
- `lobbyKindOptions(mode, index, hostIndex)`: online, the `human` option at
  `hostIndex` reads `Player (you)`. `hostIndex = firstHumanIndex(plan)`.
  Local play is unchanged.
- Library chips print `seat.label` only.
- CSS: the select and the occupancy column share `--seat-kind-width`.

## EARS invariants

1. The system shall label every chair with `seatLabel`. No other function in `packages/web/src` or `packages/online-api/src` shall produce a seat's player-facing label (source scan).
2. When a name is not usable, `seatLabel` shall answer the fallback for its row, so another user's name is never `you`, `your agent`, `AI` or `waiting`.
3. `seatLabel` shall answer `you` only for the caller's human chair with `sayYou`, and `your agent` only for the caller's agent chair.
4. When the peek's bearer is missing, rejected or throws, or its user is not a member, `GET /invites/:t` shall answer exactly the pre-P105 body: no `name` key on any chair.
5. `withSeatNames` shall never add a key other than `name`, and never to a heuristic or unbound chair.
6. The peek shall never answer 401.
7. When signed out, the client's peek shall carry no `Authorization`. When signed in with a usable token, it shall carry the bearer.
8. Online, the option list at `hostIndex` shall never contain `agent`, and its `human` option shall read `Player (you)`. Every other index reads `Player`.
9. `.lobby-seat-head select` and `.lobby-seat-occupancy` shall both declare `width: var(--seat-kind-width)` and `flex: 0 0 auto` (CSS source scan).
10. Standings `you` and the toast's `You were eliminated` shall be true only for the caller's human chair, even when another player's name is `you`.
