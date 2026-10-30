# P74 — BYOK teaching: the gradient, and the defensive half of every mechanic

> **Status:** ready. **Depends on:** P15, P32, P64, P66, P79 (the gate). **Independent of P75**
> — each is measured alone. **Docs only — no code.**
> Playtest 2026-10-29 ([findings](../../research/playtest-2026-10-29/FINDINGS.md)):
> Claude played seat B through the browser for 39 turns and took production from
> 6/36 to 41/36 a head per round using facts that are **in the offer but
> unexplained**, or **in SPEC but absent from the teaching prompt**.
>
> **SPEC coverage:** §2 (bands), §6.2, §6.3, §7, §9. No new rule. If this packet
> wants a rule changed, that is a §11 item, not an edit here.

## Intent

`docs/byok-teaching.md` currently teaches the game from the **attacker's side
only**, and treats the offer's numbers as self-explanatory. Both are fixable in
prose. This packet rewrites the teaching prompt so that a seat reading it can
(a) interpret `force`, and (b) know what each mechanic does *to it*.

The prompt stays a **teaching** document: short, curated, and subordinate to
SPEC. It does not become a strategy guide and it does not grow a decision
procedure.

## BSSN (locked)

### 1. The radial gradient — new section, before "Board"

The offer already carries `force` per spawner row. Nothing says what it means.
State, in no more than a short paragraph plus the table:

- `SPAWNER_BANDS` is a **radial gradient**: force **1/3** at the centre, **1/9**
  out to r=3, **1/12** beyond — a **4:1** ratio centre-to-rim.
- **Density** carries the rest: **1/2** of eligible vertices at the centre,
  down to **1/12** at the rim — a **6:1** ratio. Density is why centre arrows
  are often **double-fed** (an arrow flanks exactly 2 vertices).
- Homes start at `homeOffset`, which is in the **1/12** band. **Expanding
  outward from home moves into the worst ground on the board.**
- Reproduce the band table verbatim from `packages/contracts/src/match-config.ts`.
  Do not restate the numbers in prose anywhere else; one table, one source.

Explicitly **do not** add a heuristic such as "always go to the centre". State
the gradient and let the seat weigh it.

### 2. Every mechanic gets its defensive half

Each of these is already in the prompt, stated offensively. Add the other half
in the same place. No new sections.

| existing clause | add |
|---|---|
| `speed(N) = 1 + floor(log₂ N)`, lump for tiles | **Between powers of two the spare head is free.** `speed(2) = speed(3) = 2`, so at 3 heads a sentry costs no tiles. A sentry is a firebreak; it belongs between the deep end of a trail and home, not beside the front. |
| "Arrive as majority and the joined group is barred at speed 0" | **Merging *into* a larger stack is free**, and crossing a power of two buys a tile every turn thereafter. State the order that makes it free. |
| "Closing claims enclosed ground, including enemy heads" | **Read backwards, that is encirclement.** A closure takes everything inside the loop *regardless of lives*, so concentration protects against combat and is a liability against closure. Two enemy stacks flanking a salient are the two ends of a loop. |

### 3. Rules the engine enforces by omission — new short section

`legalMoves` omits illegal moves, so a seat is protected from the consequence
and never learns the rule. Name them:

- **Self-conversion** (`packages/rules-core/src/selfConvert.ts`): a grain step
  onto another player's territory **converts the mover**, not the land, unless
  it is territory-grade protected from `from`. Quote `SELF_CONVERT_MESSAGE`.
- **Enemy territory is taken only by closing around it** — never by stepping
  onto it. A step onto enemy ground lays *trail*; the closure claims it.
- **Anchors.** A trail with no anchor is not live. A head on enemy ground with
  no trail behind it can take nothing, and may not be able to return.

### 4. Correct two statements that are actively misleading

- **"territory: free, trail-less, safe movement"** → say that **movement still
  follows the grain inside your own territory**. Reinforcement is one-way; a
  head can be stranded in your own back-country with no enemy involved.
- **"painted dirt"** — the write-off of a `closes` row with no `share+N` is too
  strong. Keep the warning, add the two cases it misses: a **land bridge** whose
  value is the arrows *becoming* shares, and a loop that leaves a vertex **one
  arrow short** for a cheap follow-up. Ground that pays nothing now but
  shortens a later loop is a real category.

### 5. Reason from the losing conditions — new closing section

The win/lose rules are stated once at the top and never connected to anything.
Add: a seat with no territory is lost; a seat holding **no share** for
`dominationN` full rounds starves. Therefore **zero heads is survivable and
zero shares is not** — when behind, heads are a renewable resource to be spent
on shares, not hoarded.

### 6. Denial

Every tag measures what a row wins the seat. The spawner rows carry `held` per
player, so the opponent's shares are already visible. Say in one line that
**reducing an opponent's production counts**, and that when behind it is often
worth more per step than anything gainable.

### 7. Budget

The prompt is sent every turn. **Net growth must not exceed ~25% of the current
token count.** Cut where the existing text repeats itself — the `plan` section
says the same thing four ways. Measure before and after; record both numbers in
the PR body.

## Out of scope

- Any change to `byokBot.ts`, the offer, the tags, or the JSON contract (P75).
- Any new rule, or any change to one. SPEC §11 owns those.
- Tuning the heuristic seat.
- Re-running the jev A/B (P72 — re-gate *after* this lands).

## Scenario inventory

This packet is prose, so the suite is the existing prompt tests plus:

- `buildSystemPrompt` / `buildUserPrompt` snapshots updated, and the token count
  asserted under the budget ceiling.
- The band table in the prompt matches `SPAWNER_BANDS` exactly (a test that
  reads the constant, so the two cannot drift).
- `SELF_CONVERT_MESSAGE` quoted in the prompt matches the exported constant.
- No section of the prompt contradicts SPEC — reviewer checklist item, not a
  test.

## Definition of done

- [ ] `pnpm verify` green.
- [ ] Token count before/after recorded; growth ≤ 25%.
- [ ] Every row of the §2 table has both halves present in the prompt.
- [ ] The band table is generated from or asserted against `SPAWNER_BANDS`.
- [ ] A reader of the prompt alone can answer: *what does `force=1/9` tell me,
      and is it better or worse than `1/12`?*
- [ ] **Passes the [P79 gate](./P79-byok-benchmark-harness.md#the-gate-predeclared-before-any-arm-runs)
      as an arm on its own, branched from main**: the primary-mode mean beats
      baseline by more than the noise floor, and nothing regresses past it.
      Numbers recorded in `docs/research/byok-benchmark.md`. **If it does not
      pass, it does not merge.** The branch and its numbers are kept, and the
      packet is marked parked with the result.
