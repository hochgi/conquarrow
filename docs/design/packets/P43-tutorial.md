# P43 — Interactive walkthrough tutorial

> **Status:** Draft for review. **Depends on:** P11 (renderer/hot-seat), P31
> (selection chrome), P34/P35 (ray-run route input), P28 (refused path),
> P29/P39 (fx vocabulary), P30 (playback pacing). **Layer:** adapter (`web`).
>
> **Not a game-rule change.** `contracts`, `rules-core`, `Move`, legality,
> `speed(N)`, combat arithmetic — untouched. If authoring a lesson turns out to
> need a rule that does not exist, that is an escalation, not a decision
> (AGENTS.md: *never invent a rule*). No SPEC.md edit and no §11 item is opened
> or closed by this packet.

## Why this packet exists

The rules are settled — §11 has no open rules question. What the last dozen
playtest packets have actually been fixing is **comprehension**, one silent
misreading at a time:

- branch toll "freezes tips players and bots cannot read" (P22);
- equal-length routes the adapter picked silently (P34);
- the carry asked before the route it pays for (P35);
- leftover encircled trail after a winning enclosure read as a bug (P33);
- an enemy birth onto open trail went unnoticed (P40);
- the win sat unannounced for four moves (P37);
- a vanished seat was misread as a cut (P39).

Every one of these is a player who could not yet read the board. And the game's
whole appeal (SPEC §1) is that *an attentive player can compute the next move* —
a player who cannot read the board is locked out of the appeal entirely, not
merely inconvenienced. Today the game teaches nothing: first contact is a
hot-seat match against the full ruleset, with the vocabulary table living in
SPEC.md and AGENTS.md where no player will ever find it.

This packet adds a **lesson mode**: short scripted walkthroughs played against
the real engine on the real tiling, teaching the full arc — movement, trails,
closure, cuts, combat, encirclement, economy, victory — in the spec's own
vocabulary.

## Non-negotiables

1. **Everything runs through `rules.apply`.** A tutorial board is never a
   hand-built `GameState`. Every position shown is reachable and legal by
   construction: `makeMatch(config)` folded with an authored opening script of
   real moves (the same shape `matchLog.ts` already trusts: *"makeMatch
   rebuilds the opening, replay folds the moves"*).
2. **Rails narrow choice; the engine keeps legality.** Lesson guidance filters
   what is *highlighted as clickable* and coaches refused clicks. It never
   makes an illegal action legal and never makes a legal action apply anyway.
   In code this must stay visible as two layers: engine refusal (existing
   `RefusalReason` path) versus tutorial coaching (new copy layer on top).
3. **Copy teaches the spec's words, exactly.** Head, stack, trail, anchor,
   cut, front, firebreak, region, closure, land bridge, pincer, sentry,
   spawner, force, share, accumulator. No synonyms: "base", "unit", "line",
   "loop" and friends are how the confusion started.
4. **Lessons are deterministic and self-validating.** No clock, no RNG in
   tutorial modules; step advancement is driven by applied state transitions,
   never timers (timers pace animation only). Each lesson ships with a
   golden-path validation test (below) so a future rules packet cannot silently
   rot it — the P22→P42 history shows exactly how much the rules can move after
   a lesson would have been written.

## Lesson outline — the full arc

Eight lessons, sequential, each 2–5 minutes. Guidance style per lesson follows
the agreed split: **scripted rails while an input mechanic is new**;
**objectives once judgement is the skill**.

| # | Lesson | Teaches | Style | Authored situation |
|---|---|---|---|---|
| L0 | **The grain** | Select a stack · rays · draft a run · Send · movement follows arrows only · `speed(N)=1+⌊log₂N⌋` shown live by the ray repaint · merge costs the turn (narrated, not drilled) | rails | Home pinwheel + 3-stack, empty board |
| L1 | **Trail & exposure** | Stepping off territory lays trail · trail reads different from land (50% opacity vs solid) · leaving heads behind *is* the drop (sentry) · skip and End Turn are normal moves | rails → observe | As L0 |
| L2 | **Closure** | Depart own territory, land back on it → the path and everything ringed becomes yours · a strip that rings nothing is a land bridge · the minimal girth-3 loop exists (teaser for L6) | rails | Home + open neutral ground nearby |
| L3 | **Cuts & firebreaks** | Crossing an enemy trail point cuts it · evaporation runs both ways from the cut · **any** head halts a front (firebreak) · sentry spacing = how big a region you lose · the chord test, drawn | objective | Enemy trail laid across the learner's path |
| L4 | **Contact combat** | Attack = step onto an enemy-held arrow · stay-behind (a lone head cannot attack) · fight resolves fully in the step, threat-weighted floor rule · equals favour the attacker · the attack costs one step | rails | Adjacent enemy stack, sized so the intended attack wins |
| L5 | **Encirclement & conversion** | Closing ground under an enemy stack converts it intact · anchor grades: territory grade closes and resists conversion, stack grade only bridges · a raider inside your land without a territory-grade link is yours for the taking | demo → objective | Raider parked inside learner's reach |
| L6 | **Spawners & the economy** | Spawners sit on vertices, owned in thirds by bordering arrows · the girth-3 pinwheel captures a whole spawner · accumulators bank remainders; capture resets them · a parked enemy halts accrual (blockade) | objective | Spawner cluster within reach of both seats |
| L7 | **Winning & losing** | Four loss cases over territory/shares/heads · starvation: zero shares for *N* full rounds loses that seat · fleeing past *R* starts the clock by itself · a won match accepts nothing further | observe → objective | Two seats, one driven to destitution |

L0–L2 are solitaire (no enemy needed beyond static presence). L3–L5 stage enemy
positions via the opening script. L6–L7 need live accrual, which is why lesson
scoped configs exist (below).

### Copy discipline

Numbers quoted in lesson copy must be **read from the lesson's config**, not
hard-coded prose where a test can catch drift: "one head every 12 rounds"
must be derived from the share's force, and the starvation count from *N*. A
future retune (§11 item 25 says one is expected) must not leave the tutorial
lying. Where a number is structural — `speed(2) = 2`, girth 3, three shares —
it may be written plainly, because it is a theorem (SPEC §2, §3, §7), not a
tuning value.

## Architecture (BSSN — locked here)

### A lesson is data

```ts
interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly config: MatchConfig;          // usually DEFAULT_MATCH_CONFIG-derived
  readonly opening: readonly Move[];     // folds makeMatch(config) into the staged board
  readonly steps: readonly LessonStep[];
}

type LessonStep =
  | { kind: 'narrate'; text: string; focus?: Focus }        // overlay + Next
  | { kind: 'demo'; label: string; moves: readonly Move[] } // engine plays, P30 pacing
  | { kind: 'expect'; action: ActionSpec; coach: string }   // rails
  | { kind: 'objective'; goal: GoalId; hints: HintPlan }    // free play until predicate
  | { kind: 'end' };
```

- **`narrate`** dims the board behind a card; `focus` paints rings on named
  arrows / points / vertices so every sentence has something to point at.
- **`demo`** applies the given moves through the ordinary commit path so every
  existing effect plays — trail fire, closure paint, conversion, vanish
  (P29/P39 vocabulary) — paced like bot playback (400ms). Demos are how the
  learner sees enemy-side mechanics (an opponent cutting *them*) without an AI.
- **`expect`** is one rail: the learner must perform a specific legal action
  (see below). Wrong-but-legal clicks get the coach line; illegal clicks keep
  their ordinary engine refusal underneath it.
- **`objective`** hands over free play until a predicate holds, with a hint
  ladder: nudge text → highlight candidate arrows → offer "show me", which
  replays the golden answer as a `demo`.
- **`end`** summarises what was learned in spec vocabulary and marks completion.

### Rails: the action spec

An `ActionSpec` names a source arrow and either

- a route shape (ordered grains/runs, matching P34's click model — rails teach
  the *input*, so they speak in clicks, not raw `Move`s), or
- a free set (any action from this stack), or
- a control action (End Turn / Skip / set carry to k).

The restriction is implemented as a decorator over the existing `InputMode`
interface: snapshots pass through, `highlights.targets` is filtered to the
allowed set, and clicks outside it return the snapshot with a **tutorial
coaching note** attached (a new field alongside `refusal`, not a fake
`RefusalReason` — the engine said nothing, the teacher did). Escape/cancel
behaves normally; a rail never traps the learner in a phase.

### Objectives: predicates, not event sniffing

Goal predicates are pure functions `GameState → boolean` in a registry
(`closedAnyLoop`, `cutEnemyTrail`, `convertedEnemyStack`, `capturedShare`,
…), evaluated after each committed batch. Where a goal is about *what happened*
rather than *what is*, the predicate reads the same diff events the fx
presenter already names (`present.ts`) — closure, cut, convert — instead of
re-deriving semantics from raw state deltas. One namer, not two.

Predicates are unit-tested against fixture-built states, and each lesson's
golden path must trip its predicate (validation, below).

### Boards: reachable by construction, tuned per lesson

- Geometry is always the real tiling (`makeTiling()`); fixtures are abstract
  digraphs with no layout and cannot host a rendered lesson.
- Openings are authored as move scripts folded through `apply` — including the
  enemy's. Nothing is placed directly.
- **Lesson-scoped `MatchConfig` is allowed and expected.** Config is setup data
  (§7: *placement and force are setup data*; no rule reads a force's value), so
  a practice board may set `N = 2` for the starvation lesson and use faster
  home-band forces so L6 sees a spawn inside a lesson's length. The mechanic
  taught is identical *because* §7 guarantees no rule branches on these values.
  Practice boards are visibly labelled in the HUD ("practice board"), so the
  learner never mistakes tuned numbers for the shipped ones.

### Entry, shell, progress

- The Lobby gains a third entry beside Local | Online: **Learn**. It starts a
  fixed two-seat local plan with one human seat; no seat handoff ever happens.
- **First-run discovery, never blocking.** With no progress record in
  `localStorage`, the Lobby shows a dismissible card offering the walkthrough;
  dismissing persists. Nothing auto-launches and nothing overlays the board —
  the same reasoning that retired the portion modal (P34): a backdrop between a
  player and the board is hostility, not onboarding. The Learn entry remains
  permanently visible either way.
- Hot-seat chrome adapts: no passing banner ("your turn" is always true), End
  Turn relabelled, plus lesson controls: **Restart lesson**, **Skip lesson**,
  and progress dots for the eight lessons.
- Completion flags persist in `localStorage` (precedent: `loadSeatPlan`,
  `loadSoundEnabled`). Progress is meta, not match state — it never touches the
  engine's no-save/resume property (§1). A "reset progress" affordance ships
  with it.
- Leaving mid-lesson returns to the Lobby and discards the match; lessons are
  short enough that resumability is not worth a save format.

### Determinism and purity

- No `Date.now`, no `Math.random`, anywhere in `packages/web/src/tutorial/`.
  Step advancement consumes committed states; animation timing lives with the
  existing fx timing module only.
- Equal lesson data + equal click sequence → equal states, equal overlays. This
  is what makes the validation suite able to replay lessons headlessly.

## Testing posture

1. **Golden-path validator (the load-bearing test).** For every lesson:
   fold `makeMatch(config)` + `opening` headlessly, then replay the golden
   click/move sequence, asserting (a) every `expect` step's intended action is
   legal when reached, (b) every `objective` predicate fires at the golden
   answer, (c) the lesson reaches `end`. This is the test that catches a future
   rules packet silently invalidating an authored board — the failure mode this
   repo has already lived through twice (P22's toll withdrawal, P42's paint
   repeal).
2. **Component tests, one per Gherkin scenario** (phase 1 derives them from the
   inventory below), against the decorator and step machine — the tutorial is
   tested like any other adapter slice, with the geometry port swapped where a
   fixture is readable enough. Lessons' rendered boards still validate on the
   real tiling (validator above).
3. **Unit tests:** step-machine transitions (narrate/demo/expect/objective/end),
   restriction filtering (targets filtered; engine refusals unchanged and
   surfaced), predicate registry, copy-number derivation from config.
4. **Mutation/CRAP:** unchanged scope — Stryker targets `rules-core`; this
   packet adds none. Complexity budget still warn-level applies to the new
   module.

## Out of scope

- Any change to `contracts`, `rules-core`, or the `Move` model — a needed rule
  that does not exist is an escalation.
- An AI opponent during lessons. Demos cover enemy agency; a heuristic seat in
  a lesson would make objectives non-replayable.
- Localization / i18n, voiceover, achievements, telemetry beyond what P32
  already logs, online-tutorial sync (progress is per-browser).
- Teaching post-MVP specials (forge, gate pair, …) — they do not exist.
- Keyboard navigation, drag-to-draw, screenshots/visual regression.
- A written manual page. If playtest asks for reference material after the
  interactive arc lands, that is a separate packet.

## Scenario inventory

Shell and entry

- The Lobby offers a Learn entry beside Local and Online
- A first visit with no progress record shows the dismissible walkthrough card
- Dismissing the card persists across reloads
- Starting the walkthrough from the card enters lesson 1 directly
- Starting a lesson creates a fixed two-seat plan with one human seat
- No seat-handoff banner appears at any point in a lesson
- Restart lesson rebuilds the opening state and rewinds to the first step
- Skip lesson advances to the next lesson without completing this one
- Leaving mid-lesson returns to the Lobby and discards the match
- Completing a lesson persists a completion flag across reloads
- Reset progress clears every completion flag
- Progress dots show completed, current and locked lessons

Narration

- A narrate step shows its card and waits for Next
- A narrate focus paints rings on the named arrows/points/vertices
- Dismissing narration resumes the board unpainted

Demo

- A demo step applies its moves through the ordinary commit path
- Demo effects present with the standard fx vocabulary (trail fire, closure, convert, vanish)
- Demo moves play at playback pacing; the next step waits for the last effect
- A demo of an enemy action never hands control to the learner mid-sequence

Rails (expect)

- Only the allowed source arrow is selectable during an expect step
- Clickable targets are filtered to the route shape the step allows
- A click outside the rail produces the coach line, not a generic refusal
- A click that is engine-illegal still surfaces its ordinary RefusalReason beneath the coach line
- Cancel/Escape exits the rail cleanly and the step re-arms
- Completing the expected action commits it as an ordinary batch
- Setting the carry to a disallowed value during a carry rail is refused with its coach line

Objectives

- An objective step allows free play over every legal action
- The goal predicate fires on the golden solution
- The goal predicate fires on any alternative legal solution
- The hint ladder escalates nudge → highlight → show-me
- Show-me replays the golden answer as a demo and completes the step
- An objective survives End Turn boundaries while unmet

Boards and determinism

- A lesson's opening state equals makeMatch(config) folded with its opening script
- No tutorial module reads a clock or an RNG
- Equal lesson data and click sequence reproduce equal states and overlays
- A lesson-scoped config differs from default only in values §7 classifies as setup data
- Practice-board labelling appears whenever config ≠ default

Validation (headless)

- Golden-path validator passes for every lesson on the current engine
- Validator fails loudly when an authored action becomes illegal (simulated by a mutated fixture)
- Every objective predicate is exercised by its lesson's golden path

Copy discipline

- Numbers in lesson copy derive from the lesson config, not literals
- Structural numbers (girth 3, speed(2) = 2, three shares) appear as stated
- Lesson copy uses only spec-vocabulary terms for the concepts it teaches
