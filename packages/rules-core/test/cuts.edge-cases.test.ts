/**
 * docs/spec/cuts/cuts.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/cuts/cuts.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, mintPlayerId, rational, skip, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort } from '@conquarrow/contracts';
import { cellArrow, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { orderedBorders } from '../src/economy';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  aForkArmCut,
  anExitFrom,
  anInterleaving,
  arrowAt,
  byId,
  countingVertices,
  headsOn,
  isTrail,
  onBoard,
  owned,
  ownerOf,
  pathFrom,
  pick,
  slotsAt,
  stateOf,
  territoryOf,
  trailOf,
  vertexReadsOf,
  via,
} from './support';

const junction = (table: ReturnType<typeof onBoard>) =>
  slotsAt(table.geometry, table.geometry.target(
    pick(table.geometry.outArrows(table.geometry.seedPoint()), 0),
  ));

const F = mintPlayerId('F');
const D = mintPlayerId('D');

const fullRound = (rules: ReturnType<typeof onBoard>['rules'], state: GameState) =>
  rules.apply(rules.apply(state, endTurn()), endTurn());

const aBirthOnArm = (table: ReturnType<typeof onBoard>) => {
  const { stem, armX, armY } = aForkArmCut(table.geometry, MINIMAL_DIAMETER);
  for (const vertex of table.geometry.flankVertices(armX)) {
    const borders = orderedBorders(table.geometry, vertex);
    const phase = borders.indexOf(armX);
    if (phase < 0) continue;
    const bHome = borders.find((arrow) => arrow !== armX && arrow !== armY && arrow !== stem);
    if (bHome === undefined) continue;
    return { vertex, phase, stem, armX, armY, bHome };
  }
  throw new Error('setup: no spawner vertex flanking arm X without sitting on the fork');
};

const tile = (i: number, j: number, d: 0 | 1 | 2): ArrowId => cellArrow(i, j, d);

const aPlaytestSeatState = (
  geometry: GeometryPort,
  named: readonly ArrowId[],
  groups: GameState['groups'],
  trails: GameState['trails'],
): GameState => {
  const near = new Set(
    named.flatMap((arrow) => geometry.window(geometry.origin(arrow), 3).arrows.map(String)),
  );
  const homes = geometry
    .window(geometry.seedPoint(), 8)
    .arrows.filter((arrow) => !near.has(String(arrow)))
    .toSorted(byId);
  const homeF = homes[0];
  const homeD = homes[1];
  if (homeF === undefined || homeD === undefined) {
    throw new Error('setup: no distant keepalive homes on the tiling');
  }
  const vertexOf = (arrow: ArrowId) => pick(geometry.flankVertices(arrow), 0);
  return {
    players: [F, D],
    activePlayer: F,
    groups,
    trails,
    territory: new Map([
      [homeF, F],
      [homeD, D],
    ]),
    accumulators: new Map(),
    spawners: new Map([
      [vertexOf(homeF), { force: rational(1, 3), phase: 0 }],
      [vertexOf(homeD), { force: rational(1, 3), phase: 0 }],
    ]),
    starvationStreaks: new Map(),
    dominationN: 5,
    winner: undefined,
  };
};

// ── Rule: halt is per arrow, never per point ─────────────────────────────────

describe('halt is per arrow, never per point', () => {
  it('does not let a head on another arrow of the cut point shield against fire', () => {
    // §6.1 / item 27: combat and fire sit on different axes; point-wide shield withdrawn.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const trailIn = pick(ins, 0);
    const o1 = pick(outs, 0);
    const otherArrow = pick(ins, 1);
    const cutterIn = pick(ins, 2);
    const beyond = anExitFrom(table.geometry, o1);
    const before = stateOf(
      [
        { arrow: cutterIn, owner: A, heads: 1 },
        { arrow: otherArrow, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [cutterIn], B: [trailIn, o1, beyond] },
      },
    );
    expect(table.rules.crossesTrail(before, via(cutterIn, o1), B)).toBe(true);

    const after = table.rules.apply(before, step(cutterIn, o1, 1));

    // The head on the other arrow of P does not halt the front entering o1 —
    // beyond is destroyed, and that head is still standing.
    expect(headsOn(after, otherArrow)).toBe(1);
    expect(isTrail(after, B, beyond)).toBe(false);
    void point;
  });
});

// ── Rule: territory-anchored headless stretch is ordinary; dormant is not ────

describe('territory-anchored headless stretch is ordinary', () => {
  it('leaves a headless stretch on the territory side of a mid-trail cut', () => {
    // P12: tip garrison stops the front; trailOut may survive headless while
    // still territory-anchored via trailIn.
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const tip = anExitFrom(table.geometry, trailOut);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 1 },
        { arrow: tip, owner: B, heads: 2 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [trailIn, trailOut, tip] },
        territory: [{ arrow: trailIn, owner: B }],
      },
    );

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(headsOn(after, tip)).toBeGreaterThanOrEqual(1);
    expect(isTrail(after, B, tip)).toBe(true);
    // Forward halt at tip — trailOut may remain as headless territory-anchored wall.
    if (isTrail(after, B, trailOut)) {
      expect(after.groups.has(trailOut)).toBe(false);
    }
  });
});

// ── Rule: interactions ───────────────────────────────────────────────────────

describe('cut interactions', () => {
  it('destroys a trail mid-closure before it can claim', () => {
    // P05b's claim needs the trail; evaporation removes it.
    const table = onBoard();
    const home = pick(table.geometry.inArrows(table.geometry.seedPoint()), 0);
    const run = pathFrom(table.geometry, anExitFrom(table.geometry, home), 3);
    const n1 = arrowAt(run, 0);
    const n2 = arrowAt(run, 1);
    const closing = arrowAt(run, 2);
    // A is one step from landing home: standing on closing, about to step onto home.
    // B cuts A's trail at the point between n1 and n2 before that landing.
    const cutPoint = table.geometry.target(n1);
    const { ins, outs } = slotsAt(table.geometry, cutPoint);
    if (!ins.includes(n1) || !outs.includes(n2)) {
      throw new Error('setup: run is not a spine through the cut point');
    }
    const cutterIn = ins.find((a) => a !== n1);
    if (cutterIn === undefined) throw new Error('setup: no second in-arrow');

    const bHome = outs.find((o) => o !== n2);
    if (bHome === undefined) throw new Error('setup: no second out-arrow for B territory');
    const before = stateOf(
      [
        { arrow: closing, owner: A, heads: 1 },
        { arrow: cutterIn, owner: B, heads: 1 },
      ],
      B,
      {
        trail: { A: [n1, n2, closing] },
        territory: [
          { arrow: home, owner: A },
          { arrow: bHome, owner: B },
        ],
      },
    );
    // B lands on n2 by coincidence — a cut of A's trail.
    expect(table.rules.crossesTrail(before, via(cutterIn, n2), A)).toBe(true);

    const after = table.rules.apply(before, step(cutterIn, n2, 1));

    expect(isTrail(after, A, n1) || isTrail(after, A, n2)).toBe(false);
    // No new territory of A's from that path.
    for (const arrow of [n1, n2, closing]) {
      expect(territoryOf(after, arrow)).not.toBe(A);
    }
  });

  it('resolves combat before the cut when both apply on the same step', () => {
    // Trail is independent of heads (§6.1a). Order settled for P06. Stay-behind.
    const table = onBoard();
    const { ins, outs } = junction(table);
    const theirIn = pick(ins, 0);
    const e1 = pick(outs, 0);
    const ourIn = pick(ins, 1);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 2 },
        { arrow: e1, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [theirIn, e1] },
      },
    );
    expect(table.rules.crossesTrail(before, via(ourIn, e1), B)).toBe(true);

    const after = table.rules.apply(before, step(ourIn, e1, 1));

    // Combat first: 1v1 → attacker 1, defender 0, attacker lands; stay-behind.
    expect(headsOn(after, e1)).toBe(1);
    expect(after.groups.get(e1)?.owner).toBe(A);
    expect(headsOn(after, ourIn)).toBe(1);
    // Then cut: B's trail evaporates from the cut.
    expect(trailOf(after, B).length).toBeLessThan(trailOf(before, B).length);
  });
});

// ── Rule: a cut on one arm still respects firebreaks on the other (P47) ──────

describe('a cut on one arm still respects firebreaks on the other', () => {
  it('halts at a garrison on the sibling arm', () => {
    // Halt-at-first still bounds the region. P47 floods the sibling; it does not
    // walk through a firebreak.
    const table = onBoard();
    const { stem, armX, armY, trailOut, cutterIn, interleavingExit } = aForkArmCut(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const beyondY = pick(
      table.geometry
        .outArrows(table.geometry.target(armY))
        .filter(
          (arrow) =>
            arrow !== armX &&
            arrow !== stem &&
            arrow !== trailOut &&
            arrow !== interleavingExit &&
            arrow !== cutterIn,
        ),
      0,
    );
    const before = stateOf(
      [
        { arrow: cutterIn, owner: A, heads: 1 },
        { arrow: armY, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [cutterIn], B: [stem, armX, armY, trailOut, beyondY] },
      },
    );
    expect(table.rules.crossesTrail(before, via(cutterIn, interleavingExit), B)).toBe(true);

    const after = table.rules.apply(before, step(cutterIn, interleavingExit, 1));

    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(true);
    expect(headsOn(after, armY)).toBe(1);
    expect(isTrail(after, B, beyondY)).toBe(true);
  });

  it('floods the sibling from an interleave that does not land on the trail', () => {
    // Playtest 2026-08-27: F 0,-1,1 → -1,0,1 did not coincide; dHadExit was false.
    const table = onBoard();
    const { stem, armX, armY, trailOut, cutterIn, interleavingExit } = aForkArmCut(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const before = stateOf([{ arrow: cutterIn, owner: A, heads: 1 }], A, {
      trail: { A: [cutterIn], B: [stem, armX, armY, trailOut] },
    });
    expect(isTrail(before, B, interleavingExit)).toBe(false);
    expect(table.rules.crossesTrail(before, via(cutterIn, interleavingExit), B)).toBe(true);

    const after = table.rules.apply(before, step(cutterIn, interleavingExit, 1));

    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
    expect(isTrail(after, B, trailOut)).toBe(false);
  });

  it('continues past the cutter on a coincide landing', () => {
    const table = onBoard();
    const { stem, armX, armY, trailOut, beyond, cutterIn } = aForkArmCut(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const before = stateOf([{ arrow: cutterIn, owner: A, heads: 1 }], A, {
      trail: { A: [cutterIn], B: [stem, armX, armY, trailOut, beyond] },
    });
    expect(isTrail(before, B, trailOut)).toBe(true);
    expect(table.rules.crossesTrail(before, via(cutterIn, trailOut), B)).toBe(true);

    const after = table.rules.apply(before, step(cutterIn, trailOut, 1));

    expect(isTrail(after, B, trailOut)).toBe(false);
    expect(isTrail(after, B, beyond)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
    expect(ownerOf(after, trailOut)).toBe(A);
    expect(headsOn(after, trailOut)).toBe(1);
  });

  it('evaporates the sibling when a combat wipe lands on one fork arm', () => {
    // Shared flood: evaporateFromArrow uses the same all-to-all region as a crossing.
    const table = onBoard();
    const { stem, armX, armY, otherIn } = aForkArmCut(table.geometry, MINIMAL_DIAMETER);
    const before = stateOf(
      [
        { arrow: otherIn, owner: A, heads: 2 },
        { arrow: armX, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [otherIn], B: [stem, armX, armY] },
      },
    );

    const after = table.rules.apply(before, step(otherIn, armX, 1));

    expect(headsOn(after, armX)).toBeGreaterThanOrEqual(1);
    expect(ownerOf(after, armX)).toBe(A);
    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
  });

  it('evaporates the sibling when a birth lands on one fork arm', () => {
    // P40 trigger, P47 region. The newborn is not the victim's firebreak.
    const table = onBoard();
    const { vertex, phase, stem, armX, armY, bHome } = aBirthOnArm(table);
    const before = stateOf([], A, {
      trail: { B: [stem, armX, armY] },
      territory: [...owned([armX], A), ...owned([bHome], B)],
      accumulators: [[armX, rational(2, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase }]],
    });

    const after = fullRound(table.rules, before);

    expect(ownerOf(after, armX)).toBe(A);
    expect(headsOn(after, armX)).toBe(1);
    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
  });
});

// ── Rule: Playtest 2026-08-27 — leftover sibling on the tiling ───────────────

describe('playtest 2026-08-27 — leftover sibling on the tiling', () => {
  it("evaporates D's sibling out -1,1,0 when F interleaves at p:-1,0", () => {
    // Item 50. Authored occupancy matching that position — not a 235-move fold.
    // Interleave, not coincide. D's sentry is the firebreak; F is not.
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const from = tile(0, -1, 1);
    const exit = tile(-1, 0, 1);
    const sibling = tile(-1, 1, 0);
    const towardFork = tile(-1, 1, 2);
    const towardSentry = tile(-1, 0, 2);
    const sentry = tile(-1, -1, 1);
    const named = [from, exit, sibling, towardFork, towardSentry, sentry];
    const before = aPlaytestSeatState(
      geometry,
      named,
      new Map([
        [from, { owner: F, heads: 4, spent: 0 }],
        [sentry, { owner: D, heads: 1, spent: 0 }],
      ]),
      new Map([[D, new Set([towardFork, sibling, towardSentry, sentry])]]),
    );
    expect(isTrail(before, D, exit)).toBe(false);
    expect(rules.crossesTrail(before, via(from, exit), D)).toBe(true);
    const offered = rules.legalMoves(before).some(
      (move) =>
        move.kind === 'step' && move.from === from && move.exit === exit && move.count === 4,
    );
    expect(offered).toBe(true);

    const after = rules.apply(before, step(from, exit, 4));

    expect(isTrail(after, D, sibling)).toBe(false);
    expect(isTrail(after, D, sentry)).toBe(true);
    expect(ownerOf(after, sentry)).toBe(D);
    expect(headsOn(after, sentry)).toBe(1);
    expect(ownerOf(after, exit)).toBe(F);
    expect(headsOn(after, exit)).toBe(4);
  });
});

// ── Rule: purity and determinism ─────────────────────────────────────────────

describe('cut resolution is pure and deterministic', () => {
  it('does not mutate the input state', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const s0 = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });
    const trailsBefore = trailOf(s0, B);
    const groupsBefore = [...s0.groups.entries()].map(([a, g]) => [String(a), g.heads] as const);

    const s1 = table.rules.apply(s0, step(ourIn, ourExit, 1));

    expect(trailOf(s0, B)).toEqual(trailsBefore);
    expect(
      [...s0.groups.entries()].map(([a, g]) => [String(a), g.heads] as const),
    ).toEqual(groupsBefore);
    expect(trailOf(s1, B)).not.toEqual(trailsBefore);
  });

  it('yields equal ordered trail removals from equal inputs', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const marked = [trailIn, trailOut];
    const forwards = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: marked },
    });
    const backwards = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [...marked].reverse() },
    });
    const move = step(ourIn, ourExit, 1);

    const left = table.rules.apply(forwards, move);
    const right = table.rules.apply(backwards, move);
    expect(trailOf(left, B).length).toBeLessThan(trailOf(forwards, B).length);
    expect([...(right.trails.get(B) ?? [])].map(String)).toEqual(
      [...(left.trails.get(B) ?? [])].map(String),
    );
  });

  it('requests no vertex beyond what an idle move requests', () => {
    const base = onBoard().geometry;
    const { geometry, vertexReads } = countingVertices(base);
    const rules = makeRules(geometry);
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(geometry, MINIMAL_DIAMETER);
    const before = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });

    const idle = vertexReadsOf(vertexReads, () => {
      rules.apply(before, skip(ourIn));
    });
    let after = before;
    const cutting = vertexReadsOf(vertexReads, () => {
      after = rules.apply(before, step(ourIn, ourExit, 1));
    });

    expect(trailOf(after, B).length).toBeLessThan(trailOf(before, B).length);
    // P37: the cut adds no lattice read of its own over an idle move on the same
    // board. Not a hard zero any more, and not because the rule changed: loss
    // resolution sits on the tail of `apply` and counts the *shares* of a seat that
    // owns ground and holds no head, which `stateOf`'s keepalive land makes true of
    // every seat that authored none. See `immediate-loss.md`, *Cost*.
    expect(cutting).toBe(idle);
  });
});
