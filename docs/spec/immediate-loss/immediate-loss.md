# immediate-loss — a loss resolves on the move that causes it

**Packet:** [P37 — A loss resolves when it happens, not at the next boundary](../../design/packets/P37-immediate-loss.md)
**SPEC:** §9 (loss timing), §11 item 44 (**resolved by dissolution**).
**Supersedes in place:** `docs/spec/losing-conditions/losing-conditions.md`, *When loss resolves — the round boundary*.
**Layer:** `packages/rules-core` only. No DTO change, no adapter change.
**Features:** [core](./immediate-loss.core.feature) · [edge cases](./immediate-loss.edge-cases.feature)

## Purpose

P36 made losing a per-seat event and resolved it at the full-round boundary.
A playtest found what that costs: encircling the last enemy territory did not end
the match. Replayed against `main` @ `253a359`, the winning move is 1242 and
`winner` is first set at 1246 — four moves and three end-turns later, with the
already-lost seat taking a turn at 1244. **P47** later evaporates sibling fork
arms, so that same 1247-move log is now a **prefix golden**: the fold stops at
move **233** (P28 refuses E's recorded step onto demoted land). P37's deciding-win
claim is proven on the hand-authored four-seat match, not on a fold that no
longer reaches 1242.

P36 predicted the symptom in its own spec (*"a seat that loses its last territory
may still take the remaining turns of that round"*) and accepted it. That was
wrong: the one moment a turn-based game must not be vague about is the moment it
is decided.

## The change

**`resolveLosses` runs on every applied move**, not only inside the round
boundary.

`apply` dispatches to `applyStep`, `applySkip` and `applyEndTurn`. Resolution
moves from inside `applyEndTurn` to the **tail of `apply`**, which preserves the
boundary's required order for free:

```
apply(state, move):
  next = dispatch(state, move)          # step | skip | endTurn
  return resolveLosses(next)            # every move, not just the boundary

applyEndTurn(state):
  ...hand the seat on...
  if not a full round: return handed
  return tickStarvation(accrueRound(handed))   # resolve happens in apply's tail
```

Order at a boundary is still **accrue → tick streaks → resolve losses**, because
`apply` resolves after `applyEndTurn` returns. Streaks still advance only at a
boundary — a streak counts *rounds*, and only the resolution moved.

### What this changes, all of it wanted

- The match ends on the move that decides it. `winner` can now be set mid-turn;
  the adapter already handles that, since `controlsLocked` reads `winner`.
- A seat that can never claim again never takes another turn.
- A step that costs another seat its last territory changes the board mid-turn.

**Turn atomicity is given up deliberately.** P36 argued that removing pieces
mid-turn means the acting player's later steps run on a board changed by their own
earlier step. That is now read as the honest behaviour rather than a hazard: the
board should show the consequence of the move that caused it. Nothing in §9 or §4
required atomicity; it was a phase-1 preference.

### Which seats are lost does not change — only when

`resolveLosses` decides qualification against the state as it was at the start of
the pass and applies removals to the accumulating state. That is sound at any
frequency, because **removal gives nobody anything**: a vanishing seat's
territory becomes unowned rather than someone else's, so removing seat X can
never make seat Y qualify. Resolving more often therefore changes the *timing* of
a loss and never its *outcome* — which is the property the replay tests pin.

## §11 item 44 — resolved by dissolution

Item 44 asked what represents a match ending with no surviving seat. **The state
is unreachable**, so nothing represents it and nothing needs to.

The chain, each link checked against the code:

1. **Every seat opens owning 3 shares and 3 territory arrows** — the opening
   3-stack loop *is* the home spawner's triangle. Measured at `playerCount`
   2, 3 and 6.
2. **`closure.ts` only ever does `territory.set(arrow, mover)`.** Territory
   changes hands; it is never cleared there.
3. **`vanishSeat` is the only path that removes territory entries**, and by
   invariant 22 a vanishing seat never owned a share — so a vacated arrow is
   never a share.
4. Therefore some seat always owns a share, and `S > 0` places a player in an
   **alive** row of the §9 table, so that seat is never lost.

Hence at least one seat is always alive, and the zero-survivor board cannot be
constructed by play.

**The chain is pinned as invariants rather than merely argued.** Link 3 was
introduced by P36. If a later packet makes territory revert to unowned somewhere
else, or setup stops granting the home triangle, the state becomes reachable
again — and its failure mode is the unbounded auto-pass spin item 44 already
documents. An invariant makes that a red test instead of a hang.

## Cost

`resolveLosses` now runs per move instead of per round, so its shape matters.

**Territory and head counts shall be read in one pass** over `territory` and
`groups`, not once per player. Measured: the naive per-player shape costs +28 %
on a fold of the attached 1247-move log (1.58 s → 2.03 s).

**The share count shall be short-circuited away.** An earlier draft of this
section said "one pass over `territory` and `groups`", which was wrong about
where the cost lives: a share count needs the `spawners × borderArrows` walk,
which is neither of those. It is also almost never needed. Evaluate

```
isLost(p)  =  T(p) === 0  ||  (S(p) === 0 && H(p) === 0)
```

in that order:

- `T === 0` ⇒ lost, and no share walk happened.
- otherwise `H > 0` ⇒ the second disjunct is already false, so **not** lost, and
  again no share walk happened.
- only `T > 0 && H === 0` needs `S` at all.

So the vertex lattice is touched only for a seat that owns ground and holds no
head — the `T>0, S>0, H=0` waiting-for-a-spawner case, which is rare. In an
ordinary mid-game state where every living seat holds heads, **`apply` walks no
vertex at all.** This is required, not an optimisation left to taste: five other
packets state *the system shall enumerate no vertex*, and an unconditional share
walk would break that on every move rather than in the one case that needs it.

## Invariants (EARS)

1. When a move causes a player to hold no territory, the system shall record that
   player as lost in the state that move returns.
2. When a move causes a player to hold territory, no share and no head, the
   system shall record that player as lost in the state that move returns.
3. When a move leaves exactly one player not lost, the system shall set `winner`
   in the state that move returns.
4. The system shall offer a lost player nothing but the pass. *(`legalMoves` always offers `endTurn`: `players[0]` is the round-boundary marker and a seat is passed, never skipped — P36, *pass, never skip*. "No legal move" throughout this spec means no move that changes the board.)*
5. The system shall resolve losses after a step, after a skip, and after an end
   of turn.
6. The system shall advance a starvation streak only at a full-round boundary.
7. At a full-round boundary the system shall accrue, then advance streaks, then
   resolve losses.
8. At the end of a record the set of lost players shall be exactly those the
   §9 table qualifies, and one further move shall not change it. *(**P38: on a
   record that ends won there is no further move to take** — `apply` refuses
   everything once `winner` is set — so on both records this invariant is tested
   against, the trailing clause holds only in the degenerate sense that no further
   move exists. Both tests now assert the refusal and the empty offer list instead,
   which is the stronger statement about the same state; the clause as written is
   still the claim for a record that ends undecided, and nothing asserts it there.
   See `docs/spec/won-is-over/won-is-over.md`.)* *(The stronger
   claim — that resolving more often never changes the outcome — has no direct
   test without keeping a copy of the pre-P37 engine. It follows from removal
   giving nobody anything, argued above; what is asserted here is the
   mechanism's observable consequence, not the claim itself.)*
9. In every state reachable by play, some player shall own at least one spawner
   share.
10. In every state reachable by play, at least one player shall not be lost.
11. The system shall never leave `winner` unset in a state where every player is
    lost. *(Vacuous by 10, and asserted so that 10 failing cannot pass silently.)*
12. Losses shall resolve in `state.players` order.
13. Equal states shall produce equal losses.
14. A replay of the same move list shall lose the same seats on the same moves.
15. `victory.ts` shall reference neither a clock nor a random source.
16. **Outside a full-round boundary**, the system shall read the spawner lattice
    only for a player who owns territory and holds no head. *(The short-circuit
    argued under **Cost**. In such a state, if every living seat holds a head,
    `apply` shall read no vertex at all. Stated as an invariant rather than left
    in the prose because five other packets depend on it — see the section below.
    The boundary is excluded because accrual reads the lattice by design, and
    because the starvation clock's own row differs from ordinary play in nothing
    but `S` — so `tickStarvation` has to ask, for every seat with ground and a
    head, and no short-circuit can spare it.)*

## Consequence for the five "enumerate no vertex" invariants

`closure`, `encirclement`, `fill`, `refuse-self-convert` and `cuts` each state
*the system shall enumerate no vertex*. With loss resolution on the tail of
`apply`, that sentence is measured across a whole `apply` and can no longer mean
what it meant.

The **intent survives, and for some of them the measurement changes**: each of
those rules still reads no vertex of its own. Which form applies depends on
whether the assertion runs through `apply` — and only three of the five do.

| spec | form after P37 | why |
|---|---|---|
| `closure` | delta over an idle move | asserted through `apply` |
| `cuts` | delta over an idle move | asserted through `apply` |
| `encirclement` | delta, when asserted | conversion runs inside `apply`; currently unasserted |
| `fill` | **hard zero** | asserted on `enclosedBy`, which never reaches resolution |
| `refuse-self-convert` | **hard zero** for listing and refusing | a refusal throws before resolution; a permitted move on the same board is a delta |

Two of them were weakened in the first pass of this correction and should not
have been. Fill is measured on `enclosedBy` directly and a refusal throws before
`apply` gets to the tail, so neither can reach loss resolution and neither zero
moves. All five specs are superseded in place with a pointer here, each carrying
the form that is actually true of it.

A delta is a weaker statement than a zero, so prefer the zero wherever the board
qualifies. On a board where every living seat holds a head, invariant 16 makes
the delta *equal* zero — but `stateOf`'s keepalive land grants bystander seats an
arrow and no head, which is exactly the row that legitimately reads the lattice.
Giving those seats heads to recover the zero would put a stray enemy head next to
the rule under test, which is a cut or a conversion, not a cleaner measurement.
The hard-zero requirement is asserted directly in the immediate-loss suite
instead, where the board can be authored for it.

## Out of scope

- §11 item 45 (flicker-then-fade when a seat vanishes) — **resolved by P39.**
  Adapter-only; this packet's engine half (clear, do not evaporate) stands.
  See `docs/spec/seat-vanish-fx/seat-vanish-fx.md`.
- §11 item 46 (must `legalMoves` and `apply` refuse once `winner` is set?)
  — **opened by this packet, not answered by it.** `legalMoves` never consults
  `winner`, so a seat that wins mid-turn keeps its remaining allowance. Under P36
  that window sat between turns where only the adapter saw it; resolving on the
  move opens it inside a turn, which is what surfaced the question. No adapter
  reaches it (`App.tsx` locks input on `winner !== undefined`), so it is a
  totality gap rather than a live defect — and the two candidate answers differ
  in whether a replay past the win throws, which makes it a rule decision.
- Retuning `dominationN`.
- Any change to closure, cuts, conversion, accrual, or the four-case table.
