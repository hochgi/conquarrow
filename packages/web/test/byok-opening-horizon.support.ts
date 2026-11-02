/**
 * Fixtures and oracles for P83 byok-opening-horizon.
 * docs/spec/byok-opening-horizon/byok-opening-horizon.md
 *
 * Adapter only. Everything is observed through the public offer —
 * `annotateMove` / `formatLegalMoves` / `buildUserPrompt` — and read back as
 * text: a row's `tipDist=a→b`, `homeIn=t` and tags; a tips entry's
 * `tipDist= homeIn= ifHome=+L share+S heads=`.
 *
 * Boards:
 * - **The ladder** — the generated tiling with A's territory one arrow
 *   ({@link LADDER_HOME}). Within a radius-10 window every grain distance from
 *   1 to 16 occurs, and so does the cap; fixture boards have diameter 2, so
 *   every `homeIn` that needs a distance above 3 is found here. A search
 *   ({@link findLadderStep}) returns the first step, in `compareArrows` order,
 *   whose oracle facts match what a scenario's `Given` names.
 * - `spacious` with **no** A territory — every distance capped, and ids that
 *   hold no `17`, so "the row does not contain 17" is a whole-row check.
 * - **The ring** ({@link ringState}) — the same position on all three boards
 *   with matching distances (every exit 1, the tip 2), for I7.
 * - **The closing tip** ({@link closingTip}) — the tiling, a radius-1 window as
 *   territory, a trail out to a tip whose shortest walk home encloses ground
 *   and spawner borders: the tips line's `ifHome=` against what `apply` does.
 * - Every turn start of the P79 corpus.
 *
 * The **oracles** are the spec's Terms written out on their own: `d(x)` as a
 * level BFS ({@link dOracle}), `turnsHome`, the row's `homeIn` / `homeIn
 * before`, the crossing test, and the `ifHome` claim set `C`.
 *
 * The **golden** (`docs/design/fixtures/P83-pre-offer-golden.json`) was written
 * by phase 2 from dd8bf11, before P83: every `LEGAL_MOVES` row at every turn
 * start of the two grok logs, the rows of {@link goldenConstructions} (the
 * corpus has no capped row, so the `none` ↔ `17` mapping needs these), and the
 * `buildUserPrompt` length of the seven P75 measurement positions. It is
 * frozen — never regenerate it from a post-P83 tree.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  MergeOverride,
  PlayerId,
  Rational,
  Spawner,
  StepMove,
  VertexId,
} from '@conquarrow/contracts';
import { speed } from '@conquarrow/contracts';
import { compareArrows, compareVertices } from '@conquarrow/rules-core';
import { homewardPath } from '../src/botEvaluate';
import { annotateMove, buildUserPrompt, formatLegalMoves } from '../src/byokBot';
import { CORPUS_NAMES, corpusLog, corpusPositions, positionId } from '../bench/src/corpus';
import { A, B, allArrows, minimal, reinserted, sp, spacious, tiling } from './byok-interior-mill.support';
import type { Board } from './byok-interior-mill.support';
import { dropTags } from './byok-offer-vertex-join.support';

export { A, B, allArrows, minimal, reinserted, sp, spacious, tiling };
export type { Board };

/** The horizon, in turns (Decision 4). */
export const H = 2;
/** `DIST_CAP` in botEvaluate.ts. */
export const DIST_CAP = 16;
/** The pre-P83 sentinel, `DIST_CAP + 1`. */
export const CAPPED = DIST_CAP + 1;

/** Decision 8, verbatim: the clause the `LEGAL_MOVES` legend gains. */
export const LEGEND_CLAUSE =
  "homeIn=t: this portion's turns until it can land home (0 = this turn, none = beyond 16 steps); leaves_horizon: this step takes it past 2 turns from home.";

/** Decision 8, verbatim: the tips line's prefix when there is a tip. */
export const TIPS_PREFIX =
  'Exposed tips (ifHome = claim if it walks home now):';

export const NO_TIPS = 'Exposed tips: none';

export const QUARTER: Rational = { num: 1, den: 4 };

// ---------------------------------------------------------------------------
// The oracles — the spec's Terms, written out on their own

export type Turns = number | 'none';

/** `d(x)`: grain BFS to the nearest arrow of `me`'s territory; `'none'` past the cap. */
export const dOracle = (geometry: GeometryPort, state: GameState, me: PlayerId, start: ArrowId): Turns => {
  if (state.territory.get(start) === me) return 0;
  const seen = new Set<string>([String(start)]);
  let level: ArrowId[] = [start];
  for (let depth = 1; depth <= DIST_CAP && level.length > 0; depth += 1) {
    const next: ArrowId[] = [];
    for (const arrow of level) {
      for (const out of geometry.outArrows(geometry.target(arrow))) {
        if (state.territory.get(out) === me) return depth;
        if (seen.has(String(out))) continue;
        seen.add(String(out));
        next.push(out);
      }
    }
    level = next;
  }
  return 'none';
};

/** `turnsHome(d, L, v)`: `none` if capped; `0` if `d ≤ L`; else `⌈(d − L) / v⌉`. */
export const turnsHome = (d: Turns, left: number, v: number): Turns => {
  if (d === 'none') return 'none';
  if (d <= left) return 0;
  return Math.floor((d - left + v - 1) / v);
};

/** The crossing step: `before ≤ H` and `after > H`, `none` counting as above `H`. */
export const crosses = (before: Turns, after: Turns): boolean =>
  before !== 'none' && before <= H && (after === 'none' || after > H);

export interface HomeIn {
  readonly spd: number;
  readonly spent: number;
  readonly v: number;
  readonly dFrom: Turns;
  readonly dExit: Turns;
  /** `homeIn before`. */
  readonly before: Turns;
  /** The row's `homeIn`. */
  readonly after: Turns;
  readonly exitOwn: boolean;
}

/** Terms: `spd`, `L0 = spd − spent`, `L1 = L0 − 1`, `v = speed(count)`. */
export const homeInOracle = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  move: StepMove,
): HomeIn => {
  const group = state.groups.get(move.from);
  const spent = group?.spent ?? 0;
  const spd = group?.speedOverride ?? speed(move.count);
  const v = speed(move.count);
  const dFrom = dOracle(geometry, state, me, move.from);
  const dExit = dOracle(geometry, state, me, move.exit);
  return {
    spd,
    spent,
    v,
    dFrom,
    dExit,
    before: turnsHome(dFrom, spd - spent, v),
    after: turnsHome(dExit, spd - spent - 1, v),
    exitOwn: state.territory.get(move.exit) === me,
  };
};

/** Decision 6: the whole stack on a tip, with its override and spent. */
export const tipHomeInOracle = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  tip: ArrowId,
): Turns => {
  const group = state.groups.get(tip);
  if (group === undefined) throw new Error(`setup: no stack on ${String(tip)}`);
  const spd = group.speedOverride ?? speed(group.heads);
  return turnsHome(dOracle(geometry, state, me, tip), spd - group.spent, speed(group.heads));
};

export interface Claim {
  readonly land: number;
  readonly shares: number;
}

/**
 * Terms: `C = (own trail ∪ walk ∪ enclosedBy(own ∪ trail ∪ walk)) − own`, the
 * walk being `homewardPath`'s. `S` counts an arrow once per spawner vertex it
 * borders. `undefined` when the tip has no way home within the cap.
 */
export const ifHomeOracle = (board: Board, state: GameState, me: PlayerId, tip: ArrowId): Claim | undefined => {
  const walk = homewardPath(board.geometry, state, me, tip);
  if (walk.landing === undefined) return undefined;
  const own = [...state.territory].filter(([, owner]) => owner === me).map(([arrow]) => arrow);
  const trail = [...(state.trails.get(me) ?? [])];
  const ground = new Set<ArrowId>([...own, ...trail, ...walk.path]);
  const enclosed = board.rules.enclosedBy(ground, me);
  const claim = new Set<ArrowId>(
    [...trail, ...walk.path, ...enclosed].filter((arrow) => state.territory.get(arrow) !== me),
  );
  let shares = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of board.geometry.borderArrows(vertex)) if (claim.has(arrow)) shares += 1;
  }
  return { land: claim.size, shares };
};

// ---------------------------------------------------------------------------
// Reading a row

export interface Row {
  readonly line: string;
  readonly from: string;
  readonly exit: string;
  readonly count: number;
  /** The `homeIn=` value as printed; `undefined` when absent. */
  readonly homeIn: string | undefined;
  readonly homeInTokens: number;
  /** Both sides of `tipDist=a→b` as printed. */
  readonly tipDist: readonly [string, string] | undefined;
  readonly tags: readonly string[];
}

export const tagsOf = (line: string): string[] => {
  const tags = /\btags=(\S+)/.exec(line)?.[1];
  return tags === undefined ? [] : tags.split(',');
};

export const parseRow = (line: string): Row => {
  const head = /^(?:\[\d+\] )?step from=(\S+) exit=(\S+) count=(\d+)/.exec(line);
  if (head?.[1] === undefined || head[2] === undefined || head[3] === undefined) {
    throw new Error(`setup: not a step row: ${line}`);
  }
  const tip = / tipDist=([^\s→]+)→(\S+?)(?= )/.exec(line);
  return {
    line,
    from: head[1],
    exit: head[2],
    count: Number(head[3]),
    homeIn: / homeIn=(\S+)/.exec(line)?.[1],
    homeInTokens: (line.match(/\bhomeIn=/g) ?? []).length,
    tipDist: tip?.[1] === undefined || tip[2] === undefined ? undefined : [tip[1], tip[2]],
    tags: tagsOf(line),
  };
};

export const rowOf = (board: Board, state: GameState, move: StepMove, me: PlayerId = A): string =>
  annotateMove(board.geometry, board.rules, state, me, move);

export const legalMovesText = (board: Board, state: GameState, me: PlayerId = A): string =>
  formatLegalMoves(board.rules.legalMoves(state), board.geometry, board.rules, state, me);

export const promptOf = (board: Board, state: GameState, me: PlayerId = A): string =>
  buildUserPrompt(board.geometry, state, me, board.rules.legalMoves(state), true, board.rules);

/** One offer line per step, paired with its move by `[i]`. */
export const offerLines = (
  board: Board,
  state: GameState,
  me: PlayerId,
): { readonly move: StepMove; readonly line: string }[] => {
  const offer = board.rules.legalMoves(state);
  const text = formatLegalMoves(offer, board.geometry, board.rules, state, me);
  if (text === '') return [];
  return text.split('\n').map((line) => {
    const index = Number(/^\[(\d+)\]/.exec(line)?.[1] ?? '-1');
    const move = offer[index];
    if (move?.kind !== 'step') throw new Error(`setup: [${String(index)}] is not a step: ${line}`);
    return { move, line };
  });
};

// ---------------------------------------------------------------------------
// Reading the tips line

export const tipsLine = (prompt: string): string => {
  const line = prompt.split('\n').find((l) => l.startsWith('Exposed tips'));
  if (line === undefined) throw new Error('setup: the prompt has no Exposed tips line');
  return line;
};

/** The entries of the tips line, whichever prefix it carries. */
export const tipEntries = (prompt: string): string[] => {
  const line = tipsLine(prompt);
  if (line === NO_TIPS) return [];
  const body = line.startsWith(`${TIPS_PREFIX} `)
    ? line.slice(TIPS_PREFIX.length + 1)
    : line.replace(/^Exposed tips: /, '');
  return body.split('; ');
};

export const tipEntryFor = (prompt: string, tip: ArrowId): string => {
  const entry = tipEntries(prompt).find((e) => e.startsWith(`${String(tip)} `));
  if (entry === undefined) throw new Error(`setup: no tips entry for ${String(tip)}`);
  return entry;
};

/** Decision 6: `<arrow> tipDist=<d> homeIn=<t> ifHome=+<L> share+<S> heads=<n>`, ifHome absent at the cap. */
export const TIP_ENTRY = /^(\S+) tipDist=(\d+|none) homeIn=(\d+|none)(?: ifHome=\+(\d+) share\+(\d+))? heads=(\d+)$/;

// ---------------------------------------------------------------------------
// Normalising across P83 — what may change on a row and nothing else (I6)

/** Drop `homeIn=` and `leaves_horizon`, and print `none` back as `17` inside `tipDist=`. */
export const withoutP83 = (line: string): string =>
  dropTags(line.replace(/ homeIn=\S+/g, ''), ['leaves_horizon']).replace(
    / tipDist=([^\s→]+)→(\S+?)(?= )/,
    (_whole, a: string, b: string) =>
      ` tipDist=${a === 'none' ? String(CAPPED) : a}→${b === 'none' ? String(CAPPED) : b}`,
  );

/** Arrow ids are minted per geometry; the rest of the row is what must agree. */
export const withoutIds = (text: string): string =>
  text.replace(/\bfrom=\S+/g, 'from=FROM').replace(/\bexit=\S+/g, 'exit=EXIT');

/** An offer as an id-free sorted list (offer order follows each board's own ids). */
export const idFreeOffer = (board: Board, state: GameState, me: PlayerId = A): string[] =>
  legalMovesText(board, state, me)
    .split('\n')
    .map((line) => withoutIds(line.replace(/^\[\d+\] /, '')))
    .toSorted();

// ---------------------------------------------------------------------------
// States

export interface StackSpec {
  readonly arrow: ArrowId;
  readonly heads: number;
  readonly spent?: number;
  readonly speedOverride?: MergeOverride;
  readonly owner?: PlayerId;
}

export interface StateSpec {
  readonly territory?: readonly ArrowId[];
  readonly stacks: readonly StackSpec[];
  readonly trail?: readonly ArrowId[];
  readonly spawners?: readonly VertexId[];
  /** One arrow that is B's territory with a 1-head B stack on it, so B survives a played-out walk. */
  readonly foe?: ArrowId;
}

/**
 * A on the move; B present with nothing (or with {@link StateSpec.foe}). No enemy
 * trail, so no `cut` / `near_trail`.
 */
export const stateWith = (spec: StateSpec): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const s of spec.stacks) {
    groups.set(s.arrow, {
      owner: s.owner ?? A,
      heads: s.heads,
      spent: s.spent ?? 0,
      ...(s.speedOverride === undefined ? {} : { speedOverride: s.speedOverride }),
    });
  }
  const trail = new Set(spec.trail ?? []);
  const territory = new Map<ArrowId, PlayerId>((spec.territory ?? []).map((arrow) => [arrow, A]));
  if (spec.foe !== undefined) {
    groups.set(spec.foe, { owner: B, heads: 1, spent: 0 });
    territory.set(spec.foe, B);
  }
  return {
    players: [A, B],
    activePlayer: A,
    groups,
    trails: trail.size === 0 ? new Map() : new Map([[A, trail]]),
    territory,
    accumulators: new Map(),
    spawners: new Map<VertexId, Spawner>((spec.spawners ?? []).map((v) => [v, { force: QUARTER, phase: 0 }])),
    starvationStreaks: new Map(),
    dominationN: 5,
    winner: undefined,
  };
};

export const step = (from: ArrowId, exit: ArrowId, count: number): StepMove => ({
  kind: 'step',
  from,
  exit,
  count,
});

/** A deep, order-free picture of a state, for "building the offer changes nothing" (I8). */
export const snapshotOf = (state: GameState): string => {
  const sorted = <T>(entries: Iterable<readonly [unknown, T]>): [string, T][] =>
    [...entries].map(([k, v]): [string, T] => [String(k), v]).toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify({
    players: state.players.map(String),
    activePlayer: String(state.activePlayer),
    groups: sorted(state.groups),
    trails: sorted([...state.trails].map(([p, set]) => [p, [...set].map(String).toSorted()] as const)),
    territory: sorted([...state.territory].map(([a, p]) => [a, String(p)] as const)),
    accumulators: sorted(state.accumulators),
    spawners: sorted(state.spawners),
    starvationStreaks: sorted(state.starvationStreaks),
    dominationN: state.dominationN,
    winner: state.winner === undefined ? null : String(state.winner),
  });
};

// ---------------------------------------------------------------------------
// The ladder — tiling, A's territory one arrow

const tilingSeedOut = [...tiling.geometry.outArrows(tiling.geometry.seedPoint())].toSorted(compareArrows);

/** A's only territory on the ladder. */
export const LADDER_HOME: ArrowId = (() => {
  const home = tilingSeedOut[0];
  if (home === undefined) throw new Error('setup: the tiling seed has no out-arrow');
  return home;
})();

export const ladderArrows: readonly ArrowId[] = tiling.geometry
  .window(tiling.geometry.seedPoint(), 10)
  .arrows.filter((arrow) => arrow !== LADDER_HOME)
  .toSorted(compareArrows);

const ladderBase = stateWith({ territory: [LADDER_HOME], stacks: [] });

const ladderDist = new Map<string, Turns>();

/** `d(x)` on the ladder (territory = {@link LADDER_HOME}), memoised. */
export const ladderD = (arrow: ArrowId): Turns => {
  const key = String(arrow);
  const hit = ladderDist.get(key);
  if (hit !== undefined) return hit;
  const d = dOracle(tiling.geometry, ladderBase, A, arrow);
  ladderDist.set(key, d);
  return d;
};

export interface Portion {
  readonly heads: number;
  readonly spent?: number;
  readonly speedOverride?: MergeOverride;
  readonly count: number;
}

/**
 * The ladder with A's stack on `a0`. Off territory (default) `a0` is A's trail;
 * `onOwn` makes `a0` A's territory as well, for a `leave_home` row.
 */
export const ladderState = (a0: ArrowId, p: Portion, onOwn = false): GameState =>
  stateWith({
    territory: onOwn ? [LADDER_HOME, a0] : [LADDER_HOME],
    trail: onOwn ? [] : [a0],
    stacks: [
      {
        arrow: a0,
        heads: p.heads,
        ...(p.spent === undefined ? {} : { spent: p.spent }),
        ...(p.speedOverride === undefined ? {} : { speedOverride: p.speedOverride }),
      },
    ],
  });

export interface Found {
  readonly state: GameState;
  readonly move: StepMove;
  readonly facts: HomeIn;
  readonly portion: Portion;
}

/**
 * The first ladder step (portions in the order given, then `a0`, then exit, in
 * `compareArrows` order) whose oracle facts satisfy `want`. A `Given` names the
 * facts; the board supplies a step that has them.
 */
export const findLadderStep = (
  portions: readonly Portion[],
  want: (facts: HomeIn) => boolean,
  label: string,
  onOwn = false,
): Found => {
  for (const portion of portions) {
    for (const a0 of ladderArrows) {
      if (!onOwn && ladderD(a0) === 0) continue;
      const exits = [...tiling.geometry.outArrows(tiling.geometry.target(a0))].toSorted(compareArrows);
      if (!onOwn) {
        // Cheap prefilter on the memoised distances before building a state.
        const pre = exits.some((exit) =>
          want({
            ...factsFromDistances(portion, ladderD(a0), ladderD(exit)),
            exitOwn: exit === LADDER_HOME,
          }),
        );
        if (!pre) continue;
      }
      const state = ladderState(a0, portion, onOwn);
      for (const exit of exits) {
        const move = step(a0, exit, portion.count);
        const facts = homeInOracle(tiling.geometry, state, A, move);
        if (want(facts)) return { state, move, facts, portion };
      }
    }
  }
  throw new Error(`setup: no ladder step for ${label}`);
};

const factsFromDistances = (p: Portion, dFrom: Turns, dExit: Turns): Omit<HomeIn, 'exitOwn'> => {
  const spent = p.spent ?? 0;
  const spd = p.speedOverride ?? speed(p.count);
  const v = speed(p.count);
  return {
    spd,
    spent,
    v,
    dFrom,
    dExit,
    before: turnsHome(dFrom, spd - spent, v),
    after: turnsHome(dExit, spd - spent - 1, v),
  };
};

/** Portions tried, smallest first. 32768 heads is speed 16: the only way `homeIn before` is 0 beside a capped exit. */
export const PORTIONS: readonly Portion[] = [
  { heads: 1, count: 1 },
  { heads: 3, count: 3 },
  { heads: 3, spent: 1, count: 3 },
  { heads: 4, count: 4 },
  { heads: 32768, count: 32768 },
];

/**
 * Ladder bank: for each distance 1..16 and the cap, the first two arrows (by id)
 * at that distance, each with four stacks — 1 head, 3 heads, 3 heads spent 1,
 * 4 heads with merge override 1. Whole offers are rendered from these.
 */
export const ladderCases = (): { readonly label: string; readonly state: GameState }[] => {
  const classes: Turns[] = [...Array.from({ length: DIST_CAP }, (_, i) => i + 1), 'none'];
  const stacks: readonly Omit<StackSpec, 'arrow'>[] = [
    { heads: 1 },
    { heads: 3 },
    { heads: 3, spent: 1 },
    { heads: 4, speedOverride: 1 },
  ];
  return classes.flatMap((d) =>
    ladderArrows
      .filter((arrow) => ladderD(arrow) === d)
      .slice(0, 2)
      .flatMap((a0) =>
        stacks.map((s) => ({
          label: `ladder d=${String(d)} ${String(a0)} ${JSON.stringify(s)}`,
          state: stateWith({ territory: [LADDER_HOME], trail: [a0], stacks: [{ arrow: a0, ...s }] }),
        })),
      ),
  );
};

// ---------------------------------------------------------------------------
// Spacious with no A territory — every distance capped

export const SP_TIP = sp('0', '1');

export const noTerritoryState = (board: Board = spacious, heads = 3): GameState => {
  const tip =
    board === spacious
      ? SP_TIP
      : [...board.geometry.outArrows(board.geometry.seedPoint())].toSorted(compareArrows)[0];
  if (tip === undefined) throw new Error(`setup: ${board.name} has no seed out-arrow`);
  return stateWith({ stacks: [{ arrow: tip, heads }], trail: [tip] });
};

// ---------------------------------------------------------------------------
// The ring — the same position, with the same distances, on every board

/**
 * A's 3-head stack on trail arrow `t` (the seed point's lowest out-arrow). A's
 * territory is every out-arrow of every exit's target, so on any board every
 * exit is 1 from home and `t` is 2.
 */
export const ringState = (board: Board): { readonly state: GameState; readonly tip: ArrowId } => {
  const g = board.geometry;
  const tip = [...g.outArrows(g.seedPoint())].toSorted(compareArrows)[0];
  if (tip === undefined) throw new Error(`setup: ${board.name} has no seed out-arrow`);
  const territory = g.outArrows(g.target(tip)).flatMap((exit) => g.outArrows(g.target(exit)));
  return { state: stateWith({ territory, trail: [tip], stacks: [{ arrow: tip, heads: 3 }] }), tip };
};

// ---------------------------------------------------------------------------
// The closing tip — the shortest walk home encloses ground and spawner borders

export interface ClosingTip {
  readonly state: GameState;
  readonly tip: ArrowId;
  /** `homewardPath`'s walk, start included, and its landing. */
  readonly walk: readonly ArrowId[];
  readonly landing: ArrowId;
  readonly trail: readonly ArrowId[];
}

/**
 * Tiling, A's territory the radius-1 window. A forward BFS out of that window
 * gives each tip `t` a shortest trail from home; the first `t` (by id) whose
 * trail has 4+ arrows, whose walk home is 1–2 steps (one turn for a 3-stack),
 * shares nothing with the trail but `t`, and encloses at least three arrows is
 * the fixture. Spawners: the vertex with the most borders in the claim, and
 * the first with exactly one, so `S` counts borders, not vertices. B holds one
 * far arrow with one head, so the close does not end the match.
 */
/** B's one arrow in {@link closingTip}: the last arrow, by id, of a radius-8 window — far from A. */
const CLOSING_FOE: ArrowId = (() => {
  const far = tiling.geometry.window(tiling.geometry.seedPoint(), 8).arrows.toSorted(compareArrows).at(-1);
  if (far === undefined) throw new Error('setup: empty tiling window');
  return far;
})();

export const closingTip = (): ClosingTip => {
  const g = tiling.geometry;
  const homeArrows = g.window(g.seedPoint(), 1).arrows.toSorted(compareArrows);
  const home = new Set(homeArrows.map(String));
  const prev = new Map<string, ArrowId | null>();
  const byKey = new Map<string, ArrowId>();
  let frontier: ArrowId[] = [];
  for (const a of homeArrows) {
    for (const e of [...g.outArrows(g.target(a))].toSorted(compareArrows)) {
      if (home.has(String(e)) || prev.has(String(e))) continue;
      prev.set(String(e), null);
      byKey.set(String(e), e);
      frontier.push(e);
    }
  }
  for (let depth = 2; depth <= 5; depth += 1) {
    const next: ArrowId[] = [];
    for (const a of frontier) {
      for (const e of [...g.outArrows(g.target(a))].toSorted(compareArrows)) {
        if (home.has(String(e)) || prev.has(String(e))) continue;
        prev.set(String(e), a);
        byKey.set(String(e), e);
        next.push(e);
      }
    }
    frontier = next;
  }
  for (const tip of [...byKey.values()].toSorted(compareArrows)) {
    const trail: ArrowId[] = [];
    for (let at: ArrowId | null | undefined = tip; at !== null && at !== undefined; at = prev.get(String(at))) {
      trail.unshift(at);
    }
    if (trail.length < 4) continue;
    const bare = stateWith({ territory: homeArrows, trail, stacks: [{ arrow: tip, heads: 3 }] });
    const walk = homewardPath(g, bare, A, tip);
    if (walk.landing === undefined || walk.distance < 1 || walk.distance > 2) continue;
    if (walk.path.some((arrow, i) => i > 0 && trail.includes(arrow))) continue;
    const ground = new Set<ArrowId>([...homeArrows, ...trail, ...walk.path]);
    const enclosed = tiling.rules.enclosedBy(ground, A);
    if (enclosed.length < 3) continue;
    const claim = new Set<ArrowId>([...trail, ...walk.path, ...enclosed]);
    const vertices = new Map<string, VertexId>();
    for (const arrow of claim) for (const v of g.flankVertices(arrow)) vertices.set(String(v), v);
    const ranked = [...vertices.values()]
      .toSorted(compareVertices)
      .map((v) => ({ v, n: g.borderArrows(v).filter((b) => claim.has(b)).length }));
    const most = ranked.toSorted((x, y) => y.n - x.n)[0];
    const one = ranked.find((r) => r.n === 1);
    if (most === undefined || one === undefined) continue;
    const state = stateWith({
      territory: homeArrows,
      trail,
      stacks: [{ arrow: tip, heads: 3 }],
      spawners: [most.v, one.v],
      foe: CLOSING_FOE,
    });
    return { state, tip, walk: walk.path, landing: walk.landing, trail };
  }
  throw new Error('setup: no closing tip on the tiling');
};

/** The walk played out: the whole stack, step by step, then onto the landing. */
export const walkMoves = (c: ClosingTip, heads: number): StepMove[] =>
  [...c.walk.slice(1), c.landing].map((exit, i) => {
    const from = c.walk[i];
    if (from === undefined) throw new Error('setup: walk index out of range');
    return step(from, exit, heads);
  });

export const landOf = (state: GameState, me: PlayerId): number =>
  [...state.territory.values()].filter((owner) => owner === me).length;

export const sharesOf = (geometry: GeometryPort, state: GameState, me: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) if (state.territory.get(arrow) === me) n += 1;
  }
  return n;
};

// ---------------------------------------------------------------------------
// Banks

export interface Case {
  readonly label: string;
  readonly board: Board;
  readonly state: GameState;
  readonly me: PlayerId;
}

export const corpusCases = (): Case[] =>
  CORPUS_NAMES.flatMap((name) => corpusPositions(corpusLog(name))).map((position) => ({
    label: positionId(position.log, position.moveIndex),
    board: tiling,
    state: position.state,
    me: position.seat,
  }));

/** `leave_home` rows: one 3-head stack on each arrow of a territory window. */
export const leaveHomeCases = (): Case[] => {
  const tilingWindow = tiling.geometry.window(tiling.geometry.seedPoint(), 2).arrows;
  const fixtureOne = (board: Board): Case[] =>
    allArrows(board).map((a0) => ({
      label: `${board.name} lone ${String(a0)}`,
      board,
      state: stateWith({ territory: [a0], stacks: [{ arrow: a0, heads: 3 }] }),
      me: A,
    }));
  return [
    ...tilingWindow.map((a0) => ({
      label: `tiling r=2 stack on ${String(a0)}`,
      board: tiling,
      state: stateWith({ territory: tilingWindow, stacks: [{ arrow: a0, heads: 3 }] }),
      me: A,
    })),
    ...tilingWindow.map((a0) => ({
      label: `tiling lone ${String(a0)}`,
      board: tiling,
      state: stateWith({ territory: [a0], stacks: [{ arrow: a0, heads: 3 }] }),
      me: A,
    })),
    ...fixtureOne(spacious),
    ...fixtureOne(minimal),
  ];
};

/** Constructions whose pre-P83 rows the golden records (the corpus has no capped row). */
export const goldenConstructions = (): Case[] => {
  const ladder = (d: Turns): ArrowId => {
    const a0 = ladderArrows.find((arrow) => ladderD(arrow) === d);
    if (a0 === undefined) throw new Error(`setup: no ladder arrow at ${String(d)}`);
    return a0;
  };
  const onLadder = (label: string, a0: ArrowId): Case => ({
    label,
    board: tiling,
    state: stateWith({ territory: [LADDER_HOME], trail: [a0], stacks: [{ arrow: a0, heads: 3 }] }),
    me: A,
  });
  return [
    { label: 'spacious no territory', board: spacious, state: noTerritoryState(spacious), me: A },
    { label: 'minimal no territory', board: minimal, state: noTerritoryState(minimal), me: A },
    onLadder('ladder d=16', ladder(16)),
    onLadder('ladder d=none', ladder('none')),
    onLadder('ladder d=3', ladder(3)),
    onLadder('ladder d=6', ladder(6)),
    ...[tiling, spacious, minimal].map((board) => ({
      label: `ring ${board.name}`,
      board,
      state: ringState(board).state,
      me: A,
    })),
  ];
};

// ---------------------------------------------------------------------------
// The pre-P83 golden

const here = dirname(fileURLToPath(import.meta.url));

export const GOLDEN_PATH = join(here, '../../../docs/design/fixtures/P83-pre-offer-golden.json');

export interface Golden {
  /** position id → every pre-P83 `LEGAL_MOVES` row, in offer order (the two grok logs). */
  readonly offerRows: Readonly<Record<string, readonly string[]>>;
  /** {@link goldenConstructions} label → its pre-P83 rows. */
  readonly constructedRows: Readonly<Record<string, readonly string[]>>;
  /** P75 measurement position id → pre-P83 `buildUserPrompt` length. */
  readonly promptChars: Readonly<Record<string, number>>;
}

const stringArrays = (value: unknown, label: string): Record<string, string[]> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`setup: golden ${label} is not an object`);
  }
  const out: Record<string, string[]> = {};
  for (const [key, lines] of Object.entries(value)) {
    if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
      throw new Error(`setup: golden ${label}.${key} is not a string array`);
    }
    out[key] = lines as string[];
  }
  return out;
};

export const golden = (): Golden => {
  const raw: unknown = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  if (typeof raw !== 'object' || raw === null) throw new Error('setup: golden is not an object');
  const rec = raw as Record<string, unknown>;
  const chars = rec['promptChars'];
  if (typeof chars !== 'object' || chars === null) throw new Error('setup: golden promptChars missing');
  const promptChars: Record<string, number> = {};
  for (const [key, n] of Object.entries(chars)) {
    if (typeof n !== 'number') throw new Error(`setup: golden promptChars.${key} is not a number`);
    promptChars[key] = n;
  }
  return {
    offerRows: stringArrays(rec['offerRows'], 'offerRows'),
    constructedRows: stringArrays(rec['constructedRows'], 'constructedRows'),
    promptChars,
  };
};

export const GROK_LOGS = ['grok-2026-09-10T0657', 'grok-2026-09-10T1442'] as const;

/** P75 Decision 15's measurement positions: P83 Decision 11 measures growth on these. */
export const MEASUREMENT_POSITIONS: readonly (readonly [string, number])[] = [
  ['grok-2026-09-10T1442', 34],
  ['grok-2026-09-10T1442', 13],
  ['grok-2026-09-10T1442', 24],
  ['grok-2026-09-10T1442', 43],
  ['grok-2026-09-10T1442', 53],
  ['grok-2026-09-10T0657', 45],
  ['playtest-2026-10-29', 212],
];
