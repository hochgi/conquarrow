# P22 — Beta: simple trails (throwaway)

> **Status:** landed on `main` (promoted from beta after playtest).
>
> **Phase-1 input.** Reverses P13 D2–D4 (branch toll, illegal dormant, size-1
> freeze) and adds firebreak-capped paint on unanchored reconnect
> (**D5 superseded by [P42](./P42-claim-walk-ignores-firebreaks.md)**).
>
> **SPEC coverage:** §5, §6.1, §6.1a, §6.3, §7 claim walk, §11 items 8, 23, 27,
> 28, 35, 40 (+ new item for firebreak-capped paint).
> **Depends on:** P05–P07, P13. **Unblocks:** simpler playtest UX for humans and
> bots.

## Intent

Playtests showed branch tolls and size-1 freeze produce stuck tips that neither
players nor LLMs read. This beta asks: can trails stay interesting if branching
is free and cut tails persist as marks?

## Locked decisions

| # | Decision |
|---|---|
| D1 | **No branch toll.** Joins, splits, and crossovers are free and unlimited. A lone head may branch. |
| D2 | **Dormant / headless trail is legal.** Persists until friendly re-attach, enemy cut+evaporate, or a convert wipe that reaches it (P33). No decay in v1. |
| D3 | **No size-1 stack-grade freeze.** A sole tip may vacate its arrow (leaving dormant marks if none remain). |
| D4 | **Paint trigger unchanged.** Head lands on own territory with trail behind → claim. Closed shape → fill; open → land-bridge paint of the claim walk. |
| D5 | ~~Firebreak-capped paint (unanchored reconnect only)~~ — **superseded by P42:** claim walk never stops for a firebreak. Firebreaks halt evaporation only. |
| D6 | **Conversion unchanged predicate.** Resist only with continuous own-trail path to own territory (territory grade). Stack-grade and dormant do not protect. Tip stacks on unanchored fragments convert. |
| D7 | ~~Convert strips trail from converted arrows; orphan dormant stays~~ — **superseded by P33:** convert wipes from converted arrows (halt-at-first). Cut-created dormant still stands. |
| D8 | Cut / halt-at-first / wipe evaporation / territory-root feeder cut **unchanged** (P13 D1, D5–D6, D8). |

## In scope

- `SPEC.md` prose + §11 re-resolutions
- `docs/spec/trails-simple/` (Gherkin + EARS)
- `packages/rules-core` — remove toll / freeze / `scrubDormant`; ~~capped claim walk in `closure.ts`~~ **P42** removed the cap
- Thin web adapter: drop toll / merge-trap red paint in `reach.ts` / Board / Hud

## Out of scope

- Trail decay / timeout
- Merging to `main` without playtest
- Rewriting BYOK / findings planner rules
- Greenfield rules package
- Changing combat, spawners, or GeometryPort

## Seam notes

- `AnchorGrade` `'dormant'` remains on the port as a **legal** standing grade.
- Branch toll was never on `RulesPort` — internal only.
- Capped paint needs a pure predicate: was the pre-landing trail component territory-grade? If no, stop the claim walk at the nearest firebreak (victim's occupied trail arrow) walking against the grain from the landing departure.
