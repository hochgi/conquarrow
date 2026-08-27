# P46 — Library row identity (who / when / my colour)

> **Status:** shipping. **Depends on:** P45.
> Playtest: two started games both render `Open (waiting) · 000001` with no
> way to tell them apart. `gameNumber` is the rematch counter **inside a
> group**, so two different opponent sets both start at `000001`.
>
> **Not a game-rule change.** Additive `/my-games` fields + lobby chrome.
> No SPEC.md edit. No new AWS. GIS `given_name` / `name` is already on the
> ID token (tokeninfo); not a paid Google API.

## Intent

A My games row must be distinguishable from another row with the same status
and game number: **whose chairs**, **when it started**, **which colour is
mine**.

## BSSN (locked here)

### What each row carries (additive on `StartedGameRow`)

| Field | Meaning |
|---|---|
| `seats` | Ordered chairs. Each `{ kind: 'human' \| 'heuristic', label, you }` |
| `seatIndex` | Caller's chair index (0–5). Shell tints from `styleFor(seatPlayerId(index))` |
| `startedAt` | ISO-8601 UTC, **optional** — omitted on games started before this packet |

`status` / `groupHash` / `gameNumber` unchanged.

**Labels**

- Heuristic → `AI`
- Human with a stored display name → that name (trimmed, max 40, no CR/LF)
- Human without a name → `Player A` … `Player F` from seat index (same letters as the board palette)
- `you: true` on the caller's human chair only. The vs-line lists **everyone except you**.

Never `userHash`, Google `sub`, email, or picture on the row.

### Colour — swatch + left border, not a filled button

Fill-painting the whole control would hide the status copy. The shell paints:

- a seat swatch per chair (board fill; AI uses the same hue at lower emphasis, labelled AI)
- a left border in **your** fill
- `you` swatch gets a ring

### Names — profile overlay, not a second identity

tokeninfo already returns `given_name` / `name` on a GIS ID token. `GoogleVerifier`
may yield `displayName?: string` (`given_name` else `name`). On authenticated
routes that already verify (create, accept, `/my-games` is enough; also
create/accept so a name exists before the first list), upsert

```text
conquarrow/users/<userHash>/profile.json   { "displayName": "…" }
```

`GET /my-games` reads those profiles when labelling other humans. Missing
profile → Player letter. Empty/whitespace name is stored as absent.

This backfills **existing** games the next time those people hit an
authenticated route after deploy. No rewrite of old `meta.json` seats.

### Start time — stamp at Start, UTC only

When Start writes game `meta.json`, also write `startedAt` from the adapter
clock (`deps.clock()`, ISO UTC). Listing copies it. Pre-P46 meta omits it;
the shell does not invent a date. Format in the shell as UTC
(`27 Aug 2026, 09:10 UTC`) so tests do not depend on the operator's TZ.
Not last-modified, not last-move (those mean something else).

### Copy

Line 1: existing `Open (waiting) · 000001` (status · gameNumber).
Line 2: other chairs' labels joined with ` · ` (e.g. `Shalev · AI`).
Line 3: `startedAt` when present.

`formatLibraryRow(status, gameNumber)` stays the first line (P45).
`libraryVsLine(seats)` is the second. `formatLibraryStartedAt(iso)` is the third.

### Out of scope

- Email, avatars, Elo, last-move time, showing `groupHash`
- Colouring the entire button fill
- Rewriting historical meta to inject names or `startedAt`
- Changing invite peek (still `userHash`, P17)

## Scenario inventory

- Two groups both game 000001: vs-lines differ
- Caller's seatIndex tints the row with that chair's board colour
- Heuristic labels AI; unnamed human labels Player A/B/C
- Token `given_name` becomes the other human's label after profile upsert
- Start writes `startedAt`; listing shows the UTC line
- Pre-P46 meta: no time line
- No sub / email / userHash on library seats
- Empty name → Player letter
- Parse requires `seats` and `seatIndex`
