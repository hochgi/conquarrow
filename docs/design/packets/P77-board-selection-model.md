# P77 — The board selection model

> **Status:** in progress — spec: [board-selection-model](../../spec/board-selection-model/board-selection-model.md). **Depends on:** P11, P48. **Not a BYOK packet** — this is
> the human seat's input layer.
> Playtest 2026-10-29 ([findings](../../research/playtest-2026-10-29/FINDINGS.md) §4):
> selection cost a move or a whole turn on **five separate turns**, twice after
> the player had already written the warning down. An attentive player with DOM
> access could not reliably tell which stack was selected or whether a click
> would select or commit.
>
> **SPEC coverage:** none — presentation and input only. No rule change.

## Intent

Make it impossible to lose a move to selection ambiguity. One coherent model,
not seven bug fixes.

Today three behaviours compose badly:

1. The app **auto-selects** a movable stack at the start of a turn and after
   each send.
2. A click with **one legal count and nowhere further to go applies at once**.
3. **Nothing on screen says which stack is selected**, and the three
   reachability shades are 2–3px strokes.

Any one is defensible. Together, **once a seat has two stacks there is no safe
click**: a click intended to change selection can be consumed as a move, and a
click intended as a move can be consumed as a selection change.

## BSSN (locked)

- **Selection is explicit and always visible.** The selected stack carries a
  marker legible at the default zoom without hovering — not a 3px stroke. If no
  stack is selected, the strip says so in words.
- **A click on an occupied friendly arrow selects it. Always.** It is never
  interpreted as a destination, even when the currently-selected stack could
  legally move there. Moving onto your own stack (a merge) is drafted from the
  *ray*, not from the tile — or, if that is not expressible, by an explicit
  merge affordance. **This is the core of the packet:** selection and
  destination stop sharing a gesture.
- **Apply-on-click is retired.** Every move is drafted and sent, including a
  one-step, one-count move. The strip already has Send; the saving of one click
  is not worth a lost turn. (Measure: in the 2026-10-29 log, apply-on-click
  helped ~3 times and cost 2 turns.)
- **`Next stack` reaches every movable stack.** Today it can cycle between one
  stack and *nothing*, never offering the others. Cycle order is
  `compareArrows` over movable stacks, with an explicit "none" step, and the
  strip shows position (`2 of 3`).
- **Lit means legal.** A ray highlight must not be shown for a move the engine
  will refuse — notably a self-convert step (`selfConvert.ts`). Reachability
  along the grain is **not** the same predicate as legality, and the UI
  currently draws the former. Where a grain neighbour is refused, draw the
  "refused grain" treatment the help text already promises.
- **No silent refusals.** A click that cannot do anything says why, in the
  strip, in one short sentence. Silence is the current behaviour and is the
  single worst part of it.
- **Three shades become two plus a label.** `drafted` and `one run away` stay
  visually distinct; `reachable eventually` stops being a third shade of the
  same hue — it is a different kind of fact and should not look like a weaker
  version of "you can go here".
- **The count strip says what it means.** "1 stays" is true and unreadable;
  the count applies to the **final leg**. Reword to name where the leftover
  stands.
- **Controls do not reflow.** The button row keeps fixed positions regardless of
  status-line length. (A player reaching for `Next stack` hit `Pause`.)
- **Turn auto-pass becomes consistent.** Today a turn ends itself until a sentry
  exists, then silently stops. Either always auto-pass when nothing *can* move,
  or never auto-pass; state which, and make the strip say which state it is in.

## Out of scope

- Any rules change, including what is legal.
- The spectated-playback camera and timings (P48, P70).
- Touch/gesture redesign, keyboard shortcuts, accessibility beyond existing.
- The BYOK seat — it never touches this layer.

## Scenario inventory

- Clicking an occupied friendly arrow selects it, with another stack selected
  and that arrow legal for it
- Clicking an empty legal arrow drafts, never applies
- A one-step one-count move still requires Send
- `Next stack` visits every movable stack, then "none", then wraps
- The strip reports `n of m` and names the selected arrow
- A grain neighbour that would self-convert is drawn refused, not lit
- Clicking a refused arrow prints a reason
- The count strip's leftover wording names the arrow the leftover stands on
- Button positions are stable across a status line of 1 and 3 lines
- With a sentry parked and nothing else able to move, auto-pass behaves as
  specified and the strip says so
- Selection survives a board pan; a pan does not change selection
- Reduced motion: markers are static, no pulse

## Definition of done

- [ ] `pnpm verify` green.
- [ ] Replaying the five selection incidents from the 2026-10-29 log by hand,
      none of them can be reproduced.
- [ ] No click can both change selection and commit a move.
- [ ] No highlighted ray is refused by `apply`.
- [ ] Every refused click produces a visible reason.
