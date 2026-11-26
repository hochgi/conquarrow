# P105 — Seat labels: "you", "your agent", names and "<name>'s agent" everywhere; even seat selects

> **Not a game-rule change.** Web (lobby, seat line, library chips, CSS),
> contracts (`seatLabel` moves here and grows; `InviteSeat` gains `name`) and
> online-api (names on seats in the invite and game bodies; library labels
> from the same `seatLabel`). Breaking: the agent seat's `label` on
> `GET /games/…` is replaced by `name` on every bound human and agent seat;
> `InviteSeat`'s agent `label`, `rosterOccupancy`, `rosterOccupancyLabel`,
> `inGameRosterSummary`, `displaySeatKind`, `agentLabel`, `seatsForClient`
> and `ownerNameFromLabel` are removed; `lobbyKindOptions` takes the host
> index; the request option `auth: false` becomes `auth: 'optional'`. No SPEC.md edit, no new
> route, no new AWS, no agent-facing text (the offer and the MCP tools name
> seats by letter only, so MCP and BYOK stay identical).

**Status:** awaiting review (the reviewer accepts the Stryker suppressions
first). **Depends on:** P46, P92, P93, P96, P101, P102. **Issue:**
[#119](https://github.com/hochgi/conquarrow/issues/119).
**Spec:** [seat-labels](../../spec/seat-labels/seat-labels.md) ·
[SCENARIOS](../../spec/seat-labels/SCENARIOS.md).

## Symptom

1. **2a.** On a phone each seat's kind `<select>` is as wide as its selected
   label, so the column is ragged. The frozen roster's text column does not
   line up with the selects either.
2. **2b.** Seat A offers only Player and AI online with nothing saying why:
   seat A is the creator (P92: the host seat is never an agent).
3. **2c.** Every surface words seats its own way. The frozen roster says
   `you | waiting | Player | AI` and calls the viewer's own agent `you`; the
   in-game seat line says `A=Player · B=Agent`; library rows say
   `Agent (Ada)` and `Gilad (you)`; the toast and standings say `B` for
   another human and `Ada` for Ada's agent. The invite bodies carry no names
   at all, and `GET /games/…` names agent seats only.

## Decisions

1. **One wording, in contracts.** `seatLabel` (P102) moves to
   `packages/contracts/src/seat-label.ts` and is re-exported by
   `packages/web/src/seatLabel.ts`, so the server's library rows and every
   web surface use the same table. First matching row wins:
   1. heuristic or BYOK → `AI`
   2. a human or agent chair with no user bound → `waiting`
   3. the caller's human chair, where "you" may be said → `you`
   4. the caller's agent chair → `your agent`
   5. another agent → `<name>'s agent`, else `Agent`
   6. another human → `<name>`, else `Player <letter>`

   A name is usable when it is non-empty after trimming and is not one of the
   reserved words (`you`, `your agent`, `AI`, `waiting`, any case) and is not
   `Player <A–F>`, so another player can never be shown as "you" or as
   another seat's fallback. Callers decide "is this you" from the
   relation, never by comparing the label to `'you'`.
2. **Names come from the server, members only.** `InviteSeat` human and agent
   chairs gain `name?: string`: the owner's sanitised profile display name
   (P46), present only when the profile has one. Bodies that carry names:
   - `POST /invites` (201) and `POST …/accept` (200): the caller is a member.
   - `GET /invites/:t`: only when the request carries a bearer that verifies
     and that user is bound to a chair of the invite (the creator always is). No bearer, a
     bearer that fails or throws, or a non-member → the same 200 body without
     names. The peek never answers 401 (it is public, P17).
   - `GET /games/:g/:n` (members only already): `name` on every bound human
     and agent chair; the agent `label` is gone.
   A user hash is never added where it was not already sent.
3. **The peek sends the bearer when signed in.** `peekHeldInvite` asks for
   `auth: 'optional'` instead of `auth: false`: the bearer goes when there is
   one, so a member's lobby sees names as people join, and a 401 on the peek
   is still not a session end (no prompt, no expiry).
4. **Library labels use `seatLabel`.** `/my-games` rows label each chair
   with the same table (`you`, `your agent`, names, `<name>'s agent`,
   `Player B`, `Agent`, `AI`; a started game's chairs are all bound, so a row
   never reads `waiting`); the client chip drops its ` (you)` suffix. `you` stays on
   the row for the swatch and the vs-line.
5. **Every web surface calls it.** The frozen roster (`rosterLabel`), the
   in-game seat line (`seatLineLabel`: `B=Player`, the letter is already
   printed) and the toast (`labelForSeat`), and the standings
   (`labelForChair`). Local
   play keeps P102's `sayYou` rule (one human → `you`; hot-seat → `Player A`).
6. **2b, by the spec's default.** Gilad's phase-1 question is still open, so
   the spec stands: online, the host seat is the first human seat and never
   an agent. Its Player option reads `Player (you)`. When seat A is AI, the
   first human seat is the host, and its option says so instead.
7. **2a.** `.lobby-seat-head select` and `.lobby-seat-occupancy` share one
   width, `--seat-kind-width` (`8.5rem`, wide enough for `Player (you)`), and
   `flex: 0 0 auto`. Long names in the roster truncate with an ellipsis.

## Out of scope (backlog)

- Letting the creator pick their seat or allowing other kinds on seat A (needs Gilad's call).
- Banner wording during other seats' turns, which is cluster 03.
- Taking control of your agent seat.
- A 360 px screenshot, which is part of the phone check.
