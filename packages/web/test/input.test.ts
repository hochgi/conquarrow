/**
 * `GalconInput` against the **real opening match** — the seam P34's Gherkin suite
 * does not cover, because that suite draws its own boards (open field, fixture
 * boards with a short cycle) to keep failures readable.
 *
 * Rewritten for the `route` phase (P34). The source → destination → portion
 * ladder this file used to walk no longer exists: a click drafts a run and Send
 * commits, so `choosePortion` / `previewPortion` and the `path` highlight went
 * with the phase. What stayed is everything below — the P22 branching guard, the
 * Event 11 refusal family, and one end-to-end trip on the board the game
 * actually starts from.
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { GalconInput } from '../src/input/modes';

const activeGroup = (state: ReturnType<typeof makeMatch>) =>
  [...state.groups.entries()].find(([, g]) => g.owner === state.activePlayer)?.[0];

const setup = () => {
  const geometry = makeTiling();
  const rules = makeRules(geometry);
  const state = makeMatch();
  return { geometry, rules, state, mode: new GalconInput(geometry) };
};

describe('Galcon input — drafting on the opening board', () => {
  it('selects a source, drafts a run onto it, and sends the run it drew', () => {
    const { rules, state, mode } = setup();
    const from = activeGroup(state);
    expect(from).toBeDefined();
    if (from === undefined) return;

    const selected = mode.onArrowClick(from, state, rules);
    expect(selected.phase.kind).toBe('route');
    if (selected.phase.kind !== 'route') return;
    expect(selected.phase.draft).toHaveLength(0);
    expect(selected.highlights.targets.size).toBeGreaterThan(0);

    const target = [...selected.highlights.targets][0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    const option = selected.phase.offer.clickable.get(target);
    expect(option).toBeDefined();

    // Nothing is applied by a click: the draft grows and the board is untouched.
    const drafted = mode.onArrowClick(target, state, rules);
    expect(drafted.pending).toBeUndefined();
    expect(drafted.phase.kind).toBe('route');
    if (drafted.phase.kind !== 'route') return;
    expect(drafted.phase.tip).toBe(target);
    expect(drafted.phase.draft).toHaveLength(option?.steps.length ?? 0);

    // A trip is a *list* of steps — one per arrow crossed — so the first must
    // leave the source and the last must land on the arrow that was clicked.
    const sent = mode.send();
    const plan = sent.pending ?? [];
    expect(sent.phase.kind).toBe('idle');
    expect(plan).toHaveLength(drafted.phase.draft.length);
    const first = plan[0];
    const last = plan[plan.length - 1];
    expect(first?.kind).toBe('step');
    expect(last?.kind).toBe('step');
    if (first?.kind !== 'step' || last?.kind !== 'step') return;
    expect(first.from).toBe(from);
    expect(last.exit).toBe(target);
    let applied = state;
    for (const move of plan) applied = rules.apply(applied, move);
    expect(applied.groups.has(target)).toBe(true);
  });

  it('opens the route phase from a join that formerly paid a branch toll (P22)', () => {
    // P22: branching is free — a lone head on a join drafts, it is not blocked.
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const A = opening.players[0];
    const B = opening.players[1];
    expect(A).toBeDefined();
    expect(B).toBeDefined();
    if (A === undefined || B === undefined) return;
    const arrow = (s: string): ArrowId => s as ArrowId;
    const trailA = new Set(
      [
        'tiling:a:4,2,0',
        'tiling:a:5,1,0',
        'tiling:a:5,1,1',
        'tiling:a:5,1,2',
        'tiling:a:5,2,2',
        'tiling:a:6,0,1',
        'tiling:a:6,1,2',
        'tiling:a:6,2,2',
      ].map(arrow),
    );
    const state = {
      ...opening,
      activePlayer: A,
      groups: new Map([
        [arrow('tiling:a:5,2,2'), { owner: A, heads: 1, spent: 0 }],
        [arrow('tiling:a:5,1,0'), { owner: A, heads: 1, spent: 0 }],
        [arrow('tiling:a:5,1,2'), { owner: A, heads: 1, spent: 0 }],
        [arrow('tiling:a:6,-1,0'), { owner: B, heads: 3, spent: 0 }],
      ]),
      trails: new Map([[A, trailA]]),
    };
    const mode = new GalconInput(geometry);
    const atJoin = mode.onArrowClick(arrow('tiling:a:5,1,0'), state, rules);
    expect(atJoin.phase.kind).toBe('route');
    expect(atJoin.highlights.targets.size).toBeGreaterThan(0);

    const movable = mode.onArrowClick(arrow('tiling:a:5,1,2'), state, rules);
    expect(movable.phase.kind).toBe('route');
    expect(movable.highlights.targets.size).toBeGreaterThan(0);
  });
});

/**
 * Event 11: a click that cannot do anything says so, at the tile it happened on.
 *
 * These used to be silent — `onArrowClick` returned the unchanged snapshot and the
 * player was left to infer the constraint. The reason rides on the snapshot the
 * refused click produced, and only that one, so a later no-op cannot re-fire it.
 */
describe('Galcon input — refusals', () => {
  it('names an unowned tile clicked with nothing selected', () => {
    const { geometry, rules, state, mode } = setup();
    const mine = activeGroup(state);
    expect(mine).toBeDefined();
    if (mine === undefined) return;
    // Any arrow that is not one of ours, taken from the board rather than invented.
    const other = geometry.outArrows(geometry.target(mine)).find((a) => !state.groups.has(a));
    expect(other).toBeDefined();
    if (other === undefined) return;

    const snap = mode.onArrowClick(other, state, rules);
    expect(snap.refusal?.arrow).toBe(other);
    expect(snap.refusal?.reason).toBe('not-yours');
    // A refusal changes nothing: no phase change, and nothing to apply.
    expect(snap.phase.kind).toBe('idle');
    expect(snap.pending).toBeUndefined();
  });

  it('names an out-of-reach tile clicked while a route is open, and keeps the draft', () => {
    const { geometry, rules, state, mode } = setup();
    const from = activeGroup(state);
    expect(from).toBeDefined();
    if (from === undefined) return;
    const selected = mode.onArrowClick(from, state, rules);
    expect(selected.refusal).toBeUndefined();

    // Walk one slot until we are past everything this stack can draft this turn.
    let far = from;
    for (let i = 0; i < 12; i += 1) {
      const next = geometry.outArrows(geometry.target(far))[0];
      if (next === undefined) break;
      far = next;
    }
    expect(selected.highlights.targets.has(far)).toBe(false);

    const snap = mode.onArrowClick(far, state, rules);
    expect(snap.refusal?.arrow).toBe(far);
    expect(snap.refusal?.reason).toBe('out-of-reach');
    // Still drafting — a refused click must not drop the selection or the draft.
    expect(snap.phase.kind).toBe('route');
    expect(snap.pending).toBeUndefined();
  });

  it('does not carry a refusal into the next snapshot', () => {
    const { geometry, rules, state, mode } = setup();
    const mine = activeGroup(state);
    expect(mine).toBeDefined();
    if (mine === undefined) return;
    const other = geometry.outArrows(geometry.target(mine)).find((a) => !state.groups.has(a));
    expect(other).toBeDefined();
    if (other === undefined) return;

    expect(mode.onArrowClick(other, state, rules).refusal).toBeDefined();
    // The very next thing that *works* comes back clean.
    expect(mode.onArrowClick(mine, state, rules).refusal).toBeUndefined();
    expect(mode.reset().refusal).toBeUndefined();
  });
});
