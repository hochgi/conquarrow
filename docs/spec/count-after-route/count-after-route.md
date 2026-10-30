# count-after-route — name the route, then say how many heads walk it

**Packet:** [P35 — Ask the count after the route, and off the board](../../design/packets/P35-count-after-route.md)
**SPEC:** §3 allowance (read), §5 sentries (read). **No SPEC.md edit.**
**Layer:** `packages/web` only. Does not touch `rules-core`, contracts DTOs, `Move`, or ADR 0002.
**Features:** [core](./count-after-route.core.feature) ·
[edge cases](./count-after-route.edge-cases.feature)

## Purpose

P34 replaced destination-picking with route-drafting and was only ever driven
with a mouse at desktop width. On a phone the model reads badly, and all three
complaints are the same mistake: **the carry is asked for before the route it
has to pay for.**

Distance is bought with heads (§3). So the *floor* on a run's count is a
function of how far that run goes — which is unknown until the player has said
where they are going. Asking for the count first asks the player to budget for
a trip they have not described, and then shrinks the offer according to that
guess.

This feature inverts the order. A click names a run. **Then** the count for
that run is offered, floored at what the run costs and capped at the heads
standing where it began. When the count has only one legal value and the route
can go no further, the click applies the move and no control appears at all.
And the control leaves the board, because a panel anchored at the tip covers
the arrows it is asking about.

## What changes, precisely

Three behaviours, one layout move.

1. **A run is drafted at full strength.** `extend` no longer reuses
   `phase.carry` for the new run's moves; it uses the **largest count that
   walks the run** — see *Full strength is not every head* below. The rays are
   measured the same way, so the run the player clicked is the run they saw.
2. **The count control edits the run just drafted.** `setCarry` stops meaning
   "the count the *next* run will use" and starts meaning "rewrite the count of
   the **last** run". Earlier runs are immutable, as in P34.
3. **Nothing to decide, nothing to click.** A click that produces a
   single-run draft whose count has exactly one legal value and whose tip
   offers nothing clickable **applies immediately**.
4. **The control docks below the board** instead of floating at the tip.

### Why editing the last run is the whole feature

P34 already gave each run its own count, frozen once drafted
(*"Lowering the carry mid-route leaves earlier moves alone"*). The only thing
wrong was **when** the player was asked. Moving the question after the click
therefore needs no new model — it needs the count to address the run behind it
rather than the run ahead of it.

That also means **mid-route splitting survives untouched**, which the first
draft of this packet wrongly expected to lose. Draft a run carrying 8 of 12,
extend, and the second run's count defaults to the 8 that arrived — lower it to
4 and 4 stay at the junction as a sentry (§5). Two sentries, one route, no
extra gesture.

### Full strength is not every head

An earlier draft of this document said a run drafts at *every head standing on
the tip*, and that is wrong in exactly one place — which happens to be the
whole of attacking. §6.2's stay-behind refuses `count = heads`: an attack may
not empty its source. So under "every head" an adjacent enemy arrow is on no
ray, is never clickable, and `needs-stay-behind` becomes the only possible
answer to an attack. **Attacking would leave the input model entirely.**

P34 armed an attack by lowering the carry *before* the click. That is the one
gesture this feature removes, so the offer has to arm it instead:

> **An arrow is clickable iff some count ≤ the tip's heads walks the run to it,
> and the run drafts at the largest such count.**

Everywhere except a final attack step this is the same thing as "every head",
because `speed(N) = 1 + floor(log₂ N)` is monotone in *N* and no other refusal
in the engine reads the count. So the rule reduces to the simple reading in the
common case and arms an attack in the one case that needs it. **The count
control is therefore also how an attack's sentry is chosen** — the ceiling on
an attack run is `heads − 1`, and every count from 1 up to it is offered.

**This does not cost a walk per count.** Walk the **whole run** at the tip's
head count, and walk it again at one head fewer; the union of what the two
reach is the offer, and the higher of the two counts that reached an arrow is
the count its run drafts at. Two whole-run walks — not `tipHeads` of them.

**Two walks of the whole run, never a per-step retry.** Retrying a single
refused *step* at a lower count would mix counts inside one run, and that
quietly re-permits a mid-route attack: with an enemy two steps out, step 1 is
accepted at `heads` and step 2 retried at `heads − 1` is accepted too, because
the movers still number `heads`. The arrow would become clickable even though
**no single count walks that run** — contradicting the clickable-iff rule above
and P34's standing rule that a ray ends *before* an enemy-held arrow at
distance ≥ 2. A count must hold for every step of its run.

Two counts suffice because the stay-behind is the only count-sensitive refusal
and, past the first hop, the movers *are* the count — so a run whose later step
attacks is unwalkable at every count, and the largest walkable count is always
`heads` or `heads − 1`.

The ascending list of every legal count is built **once, for the one drafted
run**, when the control is drawn. That is where a 1..ceiling scan is affordable.

### The floor is measured, never derived

The least count for a run is the least count for which **every step of that
run** validates under `rules.apply` on the scratch state at the run's start.
It is *not* computed from `speed(N) = 1 + floor(log₂ N)`. Two derivations of
one number is how the two copies come to disagree, and the engine is the one
that decides.

`offerableCarries` measures one hop from the tip; this feature needs a whole
run, so it is replaced by **`runCarries`** — the ascending counts that walk the
last run end to end. With an empty draft there is no last run and the list is
empty, which is exactly why no control is drawn before a destination exists.

Measuring rather than deriving earns its keep immediately here: allowance is
spent per group and `spent` travels with the movers, so a second run of *k*
steps off a tip that has already spent *j* needs enough heads for `j + k`, not
for *k*. A formula would have to know that; a walk on the scratch state already
does.

## Phase state

`RoutePhase` keeps `from`, `tip`, `draft`, `tipHeads` and `offer`. Two changes:

- **`carry` is redefined** as *the count on the last drafted run* — no longer a
  value carried forward across runs. Undefined in meaning with an empty draft;
  the invariants below pin it to the tip's head count there so nothing reads a
  stale number.
- **`runLengths: readonly number[]` is added** — one entry per run, in order,
  summing to `draft.length`. Storing the boundaries beats re-deriving them,
  because a run is defined by the click that made it and nothing in a flat
  `Move[]` records where a click ended.

  A single trailing length is **not** enough: popping back to a boundary before
  the last run has to restore the *earlier* run as the editable one, and a
  scalar does not record that history. `lastRunLength` is therefore a derived
  reading — the final entry, or `0` when the list is empty — not state.

  A pop into the **middle** of a run is legal (P34's `popTo` accepts any walked
  arrow, not only a boundary). It truncates that run: the boundary list keeps
  the runs before the cut and the cut run is shortened to the part that
  survives, which then becomes the editable run.

`offer.carries` changes meaning with `carry`: legal counts for the **last run**,
ascending, empty with an empty draft.

## The flow

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> route : click own stack #59; something clickable
  idle --> blocked : click own stack #59; nothing clickable
  blocked --> idle : click the same blocked stack
  blocked --> route : click another own stack #59; something clickable
  blocked --> blocked : click another own stack #59; nothing clickable
  blocked --> blocked : click anything else #59; refused out-of-reach
  route --> route : click a clickable arrow #59; append a run at full strength
  route --> route : click a walked arrow #59; pop back to it
  route --> route : set count #59; rewrite the last run
  route --> idle : send #59; pending := draft
  route --> idle : cancel, background click, or click the source with an empty draft
  route --> idle : click a clickable arrow #59; one run #59; count forced #59; tip finished ⇒ apply now
  idle --> [*]
```

The last two `route --> idle` edges are the same click reaching two different
ends. Which one fires is decided entirely by the three-part test below.

## Auto-apply — the exact test

> **Superseded by P77** ([board-selection-model](../board-selection-model/board-selection-model.md)):
> apply-on-click is retired — every move is drafted and then sent, however
> little the click left to decide, and `autoApplies` is gone. The section and
> the `apply now` edge in the flow above are kept as the record of the decision;
> the scenarios that pinned it are tagged `@superseded-P77`, and invariants 11,
> 13 and 22 below are amended.

A click applies immediately when **all three** hold of the state it would
produce:

1. the draft is **exactly one run** (`lastRunLength === draft.length`), and
2. that run's count has exactly **one** legal value (`carries.length === 1`), and
3. the new tip offers **nothing** clickable (`clickable.size === 0`).

All three are load-bearing:

- **One run.** A multi-run draft is a route the player has been building; taking
  Send, Cancel and pop away from them at the last click would be a surprise
  even when the last leg had no decision left in it. The narrow rule covers the
  two cases the human named — a single head walking one step, and a `2^k` stack
  walking exactly `k+1` steps — and nothing else.
- **Count forced.** With two or more legal counts there is a choice to offer.
- **Tip finished.** With something still clickable the route may continue, and
  applying would cut it short.

**Condition 3 is implied by 1 and 2, and is kept anyway.** For a one-run draft
the counts that walk *k* steps are `{c ≤ ceiling : c ≥ 2^(k−1)}`, so "exactly
one legal count" means `ceiling = 2^(k−1)`, i.e. `speed(ceiling) = k` — the
allowance is exactly spent and nothing can be clickable. No state satisfies 1
and 2 and fails 3. It stays in the test because it makes the rule readable
without that argument, and because it is the condition that would still be
true if the allowance formula ever changed. A test asserting a state that
satisfies 1 and 2 but not 3 would be asserting an unreachable state — do not
write one.

An auto-applied click leaves `pending` holding the run's moves and the phase
`idle`, identical to a click followed by Send. There is **no** confirm step and
no chrome frame in between.

**The cost, accepted here.** Selecting a stack is still a separate, free,
reversible tap, but the second tap is now unrecoverable for these cases — there
is no in-turn undo in the game (its own packet). This restores the rule P31
already shipped (*"unique-portion trips … get a confirm when the unique count
is greater than 1"*), which P34 regressed by rendering the tip panel on
`phase.kind === 'route'` alone.

## The docked strip

The count stepper, Send and Cancel move out of the board into a fixed strip
**below** it — a sibling of `.stage` inside `.app`, not a child of the stage.

- **It never overlaps a clickable arrow**, at any viewport. That is the point:
  the tip-anchored panel overlapped 4 of the 12 clickable arrows at desktop
  width, and on a 375 px viewport anything anchored at the tip covers part of
  the offer it is asking about. Relocating the rectangle would move the
  problem; leaving the board retires it.
- **The tip keeps its halo**, which is what carries the spatial link once the
  control is no longer touching it.
- **One code path for touch and mouse.** Below the board is thumb reach on a
  phone and unremarkable on a desktop, so no pointer-type branch is needed.
- **It is absent with an empty draft** — there is no run to count.
- Changing the count still repaints live, which is how a player learns that
  distance is bought with heads (§3). The ray's painted length stays the only
  display of how far a count reaches; no numeral competes with it.

## Paint

Unchanged from P34 except that the rays are now always measured at the tip's
**full** head count, never at a lower carry chosen in advance. Lowering the
count of the last run still shortens what is offered *from the new tip*,
because fewer heads arrived there.

## Invariants (EARS)

1. While the draft is empty, the adapter shall render no count control.
2. While the draft is empty, `offer.carries` shall be empty and `runLengths`
   shall be empty.
3. When a run is appended, the adapter shall set that run's count to the
   largest count that walks the whole run, never exceeding the heads standing
   on the tip the run started from.
4. An arrow shall be in the clickable set if and only if some count not
   exceeding the tip's heads walks the run that reaches it.
5. `offer.carries` shall list exactly the counts for which every step of the
   last run is accepted by `rules.apply`, ascending.
6. `offer.carries` shall never contain a count exceeding the heads standing on
   the arrow the last run started from.
7. Where the last run's final step attacks an enemy-held arrow, `offer.carries`
   shall not contain the heads standing on the run's start (§6.2 stay-behind).
8. When the count of the last run is changed, the adapter shall leave every
   earlier run's moves byte-identical.
9. When the count of the last run is changed, the adapter shall re-emit exactly
   the moves of that run and no others.
10. Where a count is not in `offer.carries`, the adapter shall ignore the
    request to set it.
11. ~~When a click yields a one-run draft with one legal count and an empty
    clickable set, the adapter shall apply the draft without rendering a control.~~
    **Inverted by P77**: it shall draft it, render the control and apply nothing.
12. When a click yields a draft failing any of those three conditions, the
    adapter shall render the control and apply nothing.
13. ~~An auto-applied click shall place in `pending` exactly the moves a click
    followed by Send would have placed.~~ **Inverted by P77**: after a
    forced-count click, Send shall place in `pending` exactly the moves the click
    drafted.
14. While the match is over or input is locked, the adapter shall render no
    count control.
15. The count control's model shall carry no viewport, stage or tip coordinate,
    and shall be identical at every viewport width.
16. Send shall emit the draft in order regardless of how many runs it holds.
17. Cancel and a background click shall leave the game state unchanged.
18. The entries of `runLengths` shall sum to `draft.length`.
19. `runLengths` shall be empty if and only if the draft is empty.
20. After a pop to a walked arrow, the last entry of `runLengths` shall describe
    the run ending at that arrow, truncated where the arrow falls inside a run.
21. `runCarries` shall account for the allowance already spent by the movers, by
    measuring on the scratch state rather than from a formula.
22. ~~Equal inputs shall produce an equal offer, an equal paint and an equal
    auto-apply verdict.~~ **Amended by P77**: equal inputs shall produce an
    equal offer and an equal paint (the verdict left with `autoApplies`).
23. `route.ts` shall reference neither a clock nor a random source.

**Not a unit invariant.** *The docked strip overlaps no clickable arrow at 375 /
768 / 1280 px* is the layout claim this feature exists for, and it needs a real
renderer to check. Invariant 15 encodes the part that is purely testable — the
control cannot be positioned from the tip because it is never told where the tip
is. The overlap itself is verified in the browser at all three widths before the
PR, and recorded there. Do not write a unit test that pretends to prove it.

## Out of scope

- In-turn undo (see *the cost, accepted here*).
- Hover preview, already gated on `pointer: fine` and therefore absent on
  touch. No touch equivalent is added.
- Any change to what a route may legally be, or to `speed(N)`.
- Bot move generation and P30 playback pacing.
