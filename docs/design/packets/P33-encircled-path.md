# P33 — Clear encircled enemy path on convert

> **Status:** in flight. **Depends on:** P07, P13, P22.
> **Amended by P70:** `spent` on convert is `speed(heads)`, not 0. Wipe is unchanged.
> Playtest: after a winning enclosure, a brown trail chord still connected two
> converted stacks across the claimer's land. P22 D7 left orphan dormant marks
> after convert. That paint is the encircled path and must go.
>
> **SPEC coverage:** §6.3 (convert trail cleanup), §6.1 (halt-at-first wipe),
> §11 item 40 (re-resolved). **Does not** reopen P22 dormant-from-cuts.

## Intent

Conversion already flips unprotected stacks on foreign territory. It must also
**wipe the victim's trail from those arrows** the same way combat wipe does, so
the path that tied the encircled stacks together does not remain as enemy paint
on the claimer's land — including **both arms of a fork**.

## BSSN (locked here)

- **Predicate unchanged.** Territory-grade still protects; stack-grade and
  dormant still do not. Skip still does not convert. Intact stacks. **`spent` is
  `speed(heads)` (P70), not 0.** Drop override — unchanged.
- **On convert, wipe.** After ownership flips, evaporate the victim's trail from
  each converted arrow under the existing halt-at-first rule (`evaporateFromArrow`).
  Converted stacks are no longer the victim's, so they are **not** firebreaks.
  Remaining victim stacks and victim territory still halt.
- **Do not pre-strip then wipe.** `evaporateFromArrow` no-ops when the emptied
  arrow is already absent from the trail. Ownership flips first; trail is still
  present on the converted arrows; wipe destroys those arrows and fans both ways.
- **A fork is ordinary trail.** All-to-all already spreads a front into every
  continuation. Converting a stem or both tips clears **both arms** until a
  remaining victim firebreak. No extra fork rule.
- **Cut-created dormant stays.** A headless mark that no convert wipe reached
  still stands (P22 D2). This packet only scrubs what wipe from a converted
  arrow would destroy.
- **Closure commit still strips every trail on newly claimed tiles** (P13).
  Convert wipe covers the other common case: stacks converting on land the
  claimer **already** held, with enemy trail still marked between them.
- **No adapter-only hide.** The trail set is the board; match-over dim is not
  the fix. No SPEC §9 change, no victory helper change.
- **Order in `applyStep`:** combat → cut → closure → convert (flip, then wipe
  from converted arrows in arrow-id order) → elimination.
- **No new `RulesPort` method.** Observe via `apply` + `trails` + `anchorGrade`.
- **Ship:** merge to `hochgi/conquarrow`, then update `shalevhoch/conquarrow`
  (Pages). Human asked both forks.

## Out of scope

- Changing who converts (P07 / P28).
- Combat math, freeze, branch toll, firebreak-capped paint.
- Match-over shine / pulse / dim (P29).
- Inventing a "only on converter territory" strip that is not wipe — reuse §6.1.

## Scenario inventory

- Converted stack-grade raider: empty trail on that component evaporates
- Two converted stacks: the connecting path is gone
- Closure around a garrison: no enemy trail remains on claimed tiles
- Converted fork: both arms evaporate
- Halt at a remaining victim stack on **neutral** ground (not territory-grade:
  a path home would have blocked conversion)
- A different territory-grade component of the same victim is untouched
- Cut-created dormant with no convert still stands
- Distal beyond that remaining firebreak remains
- Head conservation, purity, skip still a no-op
- Bare enemy trail on newly claimed tiles still stripped by closure (no stacks)

## Definition of done

- [ ] `pnpm verify` green.
- [ ] Playtest leftover (chord between converted stacks on claimer land) cannot
      be reproduced from `GameState.trails`.
- [ ] P22 cut-tail dormant scenarios still pass.
- [ ] No `Date` / `Math.random` / insertion-order dependence.
