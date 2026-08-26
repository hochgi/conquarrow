# P44 — Tutorial mobile input + plain-language copy

> **Status:** Draft for review. **Depends on:** P43 (tutorial). **Layer:** adapter (`web` only).
>
> **Not a game-rule change.** `contracts`, `rules-core`, `Move`, legality, speed
> formula in the engine — untouched. Lessons still fold through `rules.apply`.
> No SPEC.md edit.

## Why this packet exists

P43 shipped an interactive walkthrough against the real engine. Playtest on
mobile found two product defects that block first contact:

1. **Taps are not reliably identified** as the intended stack / exit, and
   successful paths still require discovering **Send** under the board.
2. **Learner-facing copy exposes the log formula** (`1 + ⌊log₂ heads⌋`) and
   other dense jargon instead of plain consequences.

Both are adapter defects. The lesson data model, rails, and golden-path
validator stay; we fix hit targets, affordances, and copy.

## Non-negotiables

1. **Rails still never change legality.** Only highlights, hit targets, coach
   placement, and auto-advance policy may change.
2. **Copy stays in spec vocabulary** (head, stack, trail, cut, firebreak,
   closure, share, …). Plain language explains *consequences*; it does not
   invent synonyms for rules terms.
3. **No formulas in learner-facing strings.** Structural facts may stay
   concrete (“two heads take two steps”; “doubling the stack adds one step”).
   The identity `speed(N) = 1 + ⌊log₂ N⌋` remains engine-only / SPEC-only.
4. **Determinism preserved.** No clocks or RNG in `tutorial/`. Animation
   timing stays in the existing fx module.

## Defects this packet owns

### Input / mobile

| ID | Defect | Required behaviour |
|----|--------|--------------------|
| A1 | Strict polygon hit-test misses fat fingers | When `pointerKind === 'coarse'` (or equivalent), expand arrow hit testing by a screen-space padding (recommend **18–24 CSS px** around each candidate polygon, or nearest-centroid within that radius among candidates). Fine pointers keep current PIP. |
| A2 | Expect path requires discovering Send | On an **expect** step whose rail is a single-run route with a forced or single allowed carry: after the learner clicks the last required exit, **auto-Send** (same as P35 auto-apply when nothing remains to decide). Multi-exit or multi-carry rails still require explicit Send. |
| A3 | Coach only in HUD | Off-rail and on-rail coach lines also render as a **board-adjacent banner** (stage overlay, bottom or near focus, not only sidebar). Same string as HUD coach; one source. |
| A4 | Entering expect with target off-screen | When an expect step becomes current, pan (and optionally gentle zoom) so `action.from` is on-screen. Do not yank during an in-progress route draft. |
| A5 | Quiet chrome on rails | While a rail is active, allowed selectable / clickable arrows use a stronger lesson affordance (distinct from free-play quiet wash) — e.g. existing focus-ring style or a dedicated `lesson-target` wash. Off-rail own stacks stay dim. |

### Copy

| ID | Defect | Required behaviour |
|----|--------|--------------------|
| B1 | Log formula in L0 | Replace with plain consequence. Preferred shape: use / extend `renderCopy('speed-pair', config)` and a concrete three-head line such as: “Three heads take two steps this turn. When a stack doubles in size, it gains one extra step per turn.” No `log`, no floor symbols. |
| B2 | Dense jargon on first contact | L4: drop or defer “threat-weighted floor rule”; say equals favour the attacker and the fight finishes in that step. L7: split the four loss cases across two narrate cards or one short list of outcomes in plain words (still using territory / shares / heads). |
| B3 | Expect title invisible | While `step.kind === 'expect'`, show `step.title` (and coach when present) in the board-adjacent banner. |
| B4 | Send not named | Where auto-Send does not apply, coach must name the control: “Then tap **Send** under the board.” |

### Out of scope (unless trivial while touching the same files)

- New lessons or reordering L0–L7
- Voiceover, i18n, online progress sync
- Changing golden paths / opening scripts unless a copy-only change breaks a title string assertion
- Keyboard-only navigation
- Changing pan threshold globally for non-tutorial play (coarse hit expansion may be global for coarse pointers — preferred — or tutorial-scoped; pick one and document)

## Architecture (BSSN)

### Hit testing

Extend `hit.ts` (or a thin wrapper used by `App` pointer-up):

- `hitArrow(..., options?: { paddingPx?: number })`
- Coarse pointer → non-zero padding; fine → 0
- Candidates remain the culled / offered set (never the whole board)

### Auto-Send on rails

In the expect completion path (decorator or host after a successful on-rail
extend that leaves a draft with no further decision):

- If rail `exits` are fully matched and `carryAllow` is absent or length 1,
  call the same send path as the dock button.
- Must still go through `commitSnap` / ordinary apply (no second engine door).

### Coach / title surface

- New small presentational component or extend `TutorialOverlay` for
  **active expect/objective** chrome (title + coach), with
  `pointer-events: none` on the dimmer and **yes** pointer-events on any
  explicit buttons only.
- Narrate/end cards unchanged in role; fix mobile layout so the card does not
  cover the primary stack when focus is set (stack card under focus, or
  shorter top card).

### Copy

- All learner strings in `catalogue.ts` / `copy.ts` templates.
- Unit test: no learner string matches `/log\s*[₂2]|⌊|floor\s*\(\s*log/i`.
- Prefer templates in `copy.ts` for anything that mentions speed or *N*.

## Decisions locked here (BSSN)

The packet listed two open questions. Both are adapter precision, not game
rules; they are locked:

1. **Auto-Send only when the rail is a single-exit route and `carryAllow` is
   absent or length 1.** Multi-exit rails keep drafting (P34). Multi-value
   `carryAllow` still asks the learner to set the count, then Send. This is
   the same “nothing left to decide” idea as P35, applied to the *rail* rather
   than the engine offer: a 3-stack’s tip may still be clickable after one
   hop (`speed(3) = 2`), but the rail is done and must not demand discovering
   Send. P35 `autoApplies` still runs; either path may call `send`, never twice.
2. **Coarse hit padding is global** for `pointerKind === 'coarse'` (touch/pen
   via the existing `pointerKindOf` map). Free play on a phone has the same
   fat-finger miss. Fine pointers keep lattice point-in-polygon, padding 0.
3. **Padding is 24 CSS px** (`COARSE_HIT_PADDING_PX`), the top of the 18–24
   band. Distance is **screen space** (same reason `hitSpawnerVertex` is screen
   space: the target stays the same size under the finger at every zoom).
   Among candidates that hit, nearest centroid still wins (today’s tie-break,
   measured in lattice space). Padding never selects an arrow outside the
   candidate list.
4. **Stage banner is one source.** `stageBanner(step, coach)` returns
   `{ title, body }` for expect (title + coach) and objective (hint as body).
   HUD coach and the banner body are the same string. The banner is
   `pointer-events: none` except Next/Done on narrate/end.
5. **Pan on expect entry only.** When the session’s current step *becomes*
   an expect and `action.from` is off-screen, `centerOn` that arrow. Skip if
   the route draft is already in progress (`phase.kind === 'route'` and
   `draft.length > 0`), or if the arrow is already inside the viewport
   inset. No zoom change required (optional; this packet does not zoom).
6. **Lesson-target wash** is the set `selectable ∪ clickable` of the active
   rail. Off-rail own stacks are not in that set and stay at the quiet
   free-play wash.
7. **Inspect tips stay fine-pointer.** Coarse `pointermove` does not pin a
   `SpawnerTip` / convert tip. On a phone the share label “NEXT” reads as the
   lesson button and the card covers the rail. Hover read-out is unchanged
   for mouse.

## Scenario inventory (phase 1 → Gherkin)

### Hit testing

- Fine pointer: click inside polygon selects that arrow (unchanged)
- Coarse pointer: tap within padding of a single candidate selects it
- Coarse pointer: two overlapping candidates — nearest centroid wins (same tie-break as today)
- Coarse padding does not select an arrow outside the candidate list

### Expect / Send

- Single-exit expect with one legal carry: clicking the exit commits without an extra Send tap
- Multi-exit expect: after first exit, Send still required (or continue drafting per rail)
- Off-rail click shows coach in board-adjacent banner and in HUD (same text)
- Entering expect pans `action.from` on-screen when it was outside the viewport

### Copy

- L0 narrate strings contain no log/floor formula
- L0 states the doubling rule in plain language
- Expect title is visible while the expect step is current
- Coach that requires Send names the Send control when auto-Send does not apply

### Regression

- Golden-path validator still passes for every lesson
- Narrate Next / end Done still advance the session
- Engine refusals still surface under coach (two-layer rule from P43)

## Testing posture

1. **Unit:** `hitArrow` padding; copy lint (no formula); auto-Send decision pure helper
2. **Component:** restrict decorator + session unchanged contracts; new banner shows title/coach
3. **Golden-path validator:** still green for L0–L7 (openings untouched unless a step text-only change)
4. **Manual / browser check (call out in PR):** iPhone-width Chrome or device — complete L0 and L1 using only touch

## Non-goals

- Teaching the algebraic form of speed to players
- Redesigning RouteDock for all free-play games (only lesson auto-Send + copy)
- Changing speed, combat, or closure rules
