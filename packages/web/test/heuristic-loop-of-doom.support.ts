/**
 * Fixtures for the loop of doom (docs/design/backlog.md, "The loop of doom";
 * docs/research/playtest-2026-11-0{6,7}/FINDINGS.md).
 *
 * Two verbatim playtest logs, replayed from `makeMatch(config)`. At the named
 * move the looping seat starts the turn that walks its stack onto a short ring
 * of its own trail; from then on the live seat walks that ring every turn and
 * never drives home, although home is within one turn's reach of every ring
 * arrow.
 *
 * Each fixture gives two positions:
 * - `replayed` — the logged position as it stands;
 * - `minimal` — the same with every enemy stack and trail removed and only the
 *   looping stack left of the seat's own. Enemy land and the spawners stay:
 *   without enemy land the seat dominates at once, and without spawners the
 *   match plays out differently. Both are still needed for the loop.
 *
 * In both, the other seats pass (`endTurn`) while the looping seat plays: the
 * loop does not need an enemy move to persist.
 */

import { endTurn, speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { homewardPath } from '../src/botEvaluate';
import type { ChooseTurn } from '../src/botSearch';
import { geometry, rules } from './bot-turn-search.support';
import {
  loadReplay,
  loggedTurn,
  seatOf,
  stateAt,
  type SeatLabel,
} from './heuristic-never-idle.support';

export { geometry, rules };

export type LoopFixture = {
  readonly id: string;
  readonly log: string;
  /** Move index that starts the looping seat's turn into the ring. */
  readonly index: number;
  readonly seat: SeatLabel;
  /** The looping stack's arrow at `index`. */
  readonly stack: string;
  readonly heads: number;
  /** The ring of own trail the live seat walks from this turn on. */
  readonly ring: readonly string[];
};

export const LOOP_FIXTURES: readonly LoopFixture[] = [
  {
    id: 'L1',
    log: 'playtest-2026-11-06',
    index: 208,
    seat: 'A',
    stack: 'tiling:a:4,1,2',
    heads: 4,
    ring: ['tiling:a:4,0,2', 'tiling:a:4,-1,1', 'tiling:a:3,0,0'],
  },
  {
    id: 'L2',
    log: 'playtest-2026-11-07',
    index: 101,
    seat: 'B',
    stack: 'tiling:a:-1,3,1',
    heads: 2,
    ring: ['tiling:a:-2,4,2', 'tiling:a:-2,3,1', 'tiling:a:-3,4,0'],
  },
];

const replayOf = (f: LoopFixture) => loadReplay(f.log, `${f.log}.match-log.json`);

/** The logged turn into the ring: the live seat's own choice at `index`. */
export const turnIntoRing = (f: LoopFixture): readonly Move[] => loggedTurn(replayOf(f), f.index);

export type LoopPosition = { readonly state: GameState; readonly me: PlayerId };

const arrow = (id: string): ArrowId => id as ArrowId;

export const replayed = (f: LoopFixture): LoopPosition => {
  const state = stateAt(replayOf(f), f.index);
  const me = seatOf(state, f.seat);
  if (state.activePlayer !== me) {
    throw new Error(`setup: ${f.id} move ${String(f.index)} is not ${f.seat}'s turn`);
  }
  const group = state.groups.get(arrow(f.stack));
  if (group?.owner !== me || group.heads !== f.heads) {
    throw new Error(`setup: ${f.id} has no ${f.seat} ×${String(f.heads)} on ${f.stack}`);
  }
  if (state.trails.get(me)?.has(arrow(f.stack)) !== true) {
    throw new Error(`setup: ${f.id} stack ${f.stack} is not on its own trail`);
  }
  return { state, me };
};

export const minimal = (f: LoopFixture): LoopPosition => {
  const { state, me } = replayed(f);
  return {
    me,
    state: {
      ...state,
      groups: new Map([...state.groups].filter(([a]) => a === arrow(f.stack))),
      trails: new Map(
        [...state.trails].map(([p, t]): [PlayerId, ReadonlySet<ArrowId>] => [
          p,
          p === me ? t : new Set<ArrowId>(),
        ]),
      ),
    },
  };
};

export const landOf = (state: GameState, me: PlayerId): number =>
  [...state.territory.values()].filter((p) => p === me).length;

export const trailSizeOf = (state: GameState, me: PlayerId): number =>
  state.trails.get(me)?.size ?? 0;

/** Apply `plan` to `state`. */
export const fold = (state: GameState, plan: readonly Move[]): GameState =>
  plan.reduce((at, move) => rules.apply(at, move), state);

/** Every other seat ends its turn until `me` is active again (or the match ends). */
export const othersPass = (state: GameState, me: PlayerId): GameState => {
  let at = state;
  while (at.winner === undefined && at.activePlayer !== me) at = rules.apply(at, endTurn());
  return at;
};

/**
 * `turns` of `me`'s turns chosen by `choose`, the others passing between them.
 * Returns the land `me` holds after each of its turns.
 */
export const landPerTurn = (
  choose: ChooseTurn,
  start: LoopPosition,
  turns: number,
): readonly number[] => {
  const out: number[] = [];
  let at = start.state;
  for (let k = 0; k < turns && at.winner === undefined; k += 1) {
    at = fold(at, choose(geometry, rules, at, start.me));
    out.push(landOf(at, start.me));
    at = othersPass(at, start.me);
  }
  return out;
};

/**
 * The close the live seat passes up, from the position after its turn into
 * the ring: the stack walks the grain-shortest path home. Throws `setup:` when
 * no single own stack stands on the ring, or home is beyond one turn's reach.
 */
export const closeHomeFromRing = (
  f: LoopFixture,
  intoRing: GameState,
  me: PlayerId,
): { readonly before: GameState; readonly after: GameState; readonly steps: number } => {
  const before = othersPass(intoRing, me);
  const onRing = [...before.groups].filter(
    ([a, g]) => g.owner === me && f.ring.includes(String(a)),
  );
  const [only] = onRing;
  if (onRing.length !== 1 || only === undefined) {
    throw new Error(`setup: ${f.id} after the turn into the ring, no single own stack is on it`);
  }
  const [from, group] = only;
  const path = homewardPath(geometry, before, me, from);
  if (path.landing === undefined || path.distance > speed(group.heads)) {
    throw new Error(`setup: ${f.id} home is not within one turn of ${String(from)}`);
  }
  let at = before;
  let on = from;
  for (const exit of [...path.path.slice(1), path.landing]) {
    at = rules.apply(at, { kind: 'step', from: on, exit, count: group.heads });
    on = exit;
  }
  return { before, after: at, steps: path.distance };
};

// ---------------------------------------------------------------------------
// P91 unit positions (docs/spec/heuristic-loop-of-doom/heuristic-loop-of-doom.md,
// "Fixtures"). Every premise a test states is checked here and throws `setup:`.
// ---------------------------------------------------------------------------

const step = (from: string, exit: string, count: number): Move => ({
  kind: 'step',
  from: arrow(`tiling:a:${from}`),
  exit: arrow(`tiling:a:${exit}`),
  count,
});

/** Spec Fixtures, T₂: the ring turn from O₁, `3,0,0 → 4,0,2 → 4,-1,1 → 3,0,0` ×4. */
export const L1_RING_TURN: readonly Move[] = [
  step('3,0,0', '4,0,2', 4),
  step('4,0,2', '4,-1,1', 4),
  step('4,-1,1', '3,0,0', 4),
  endTurn(),
];

/** Spec Fixtures: the nested plan main `229892d` returns at L1's minimal O₁. */
export const L1_NESTED_PLAN_AT_O1: readonly Move[] = [
  step('3,0,0', '4,0,0', 2),
  step('3,0,0', '4,0,2', 2),
  step('4,0,0', '5,0,0', 2),
  endTurn(),
];

const fixture = (id: string): LoopFixture => {
  const f = LOOP_FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`setup: no loop fixture ${id}`);
  return f;
};

/** O₀ (the turn into the ring begins), T₁ (after it), O₁ (the others passed). */
export type RingStart = {
  readonly me: PlayerId;
  readonly o0: GameState;
  readonly t1: GameState;
  readonly o1: GameState;
};

export const ringStart = (f: LoopFixture, start: LoopPosition): RingStart => {
  const t1 = fold(start.state, turnIntoRing(f));
  const o1 = othersPass(t1, start.me);
  if (o1.activePlayer !== start.me || o1.winner !== undefined) {
    throw new Error(`setup: ${f.id} after the turn into the ring, ${f.seat} is not to move`);
  }
  return { me: start.me, o0: start.state, t1, o1 };
};

export type L1Units = RingStart & { readonly t2: GameState };

/**
 * L1's minimal unit positions with the spec's premises checked: O₀ trail 9;
 * T₁ trail 12, `sortieCredit` > 0; O₁ A ×4 alone on `3,0,0`, trail 12; T₂
 * trail 12, `sortieCredit` > 0.
 */
export const l1Units = (credit: (state: GameState, me: PlayerId) => number): L1Units => {
  const start = ringStart(fixture('L1'), minimal(fixture('L1')));
  const { me, o0, t1, o1 } = start;
  if (trailSizeOf(o0, me) !== 9) throw new Error('setup: L1 O₀ trail is not 9');
  if (trailSizeOf(t1, me) !== 12) throw new Error('setup: L1 T₁ trail is not 12');
  if (!(credit(t1, me) > 0)) throw new Error('setup: L1 sortieCredit(T₁) is not > 0');
  const own = [...o1.groups].filter(([, g]) => g.owner === me);
  const [only] = own;
  if (own.length !== 1 || only?.[0] !== arrow('tiling:a:3,0,0') || only[1].heads !== 4) {
    throw new Error('setup: L1 O₁ is not A ×4 alone on 3,0,0');
  }
  if (trailSizeOf(o1, me) !== 12) throw new Error('setup: L1 O₁ trail is not 12');
  const t2 = fold(o1, L1_RING_TURN);
  if (trailSizeOf(t2, me) !== 12) throw new Error('setup: L1 T₂ trail is not 12');
  if (!(credit(t2, me) > 0)) throw new Error('setup: L1 sortieCredit(T₂) is not > 0');
  return { ...start, t2 };
};

/** `n` arrow ids for a hand-made trail; `tag` keeps two seats' sets apart. */
export const syntheticTrail = (n: number, tag: number): ReadonlySet<ArrowId> =>
  new Set(Array.from({ length: n }, (_, k) => arrow(`tiling:a:${String(tag)},${String(k)},0`)));

/** A shallow copy of `base` with only `trails` replaced. */
export const withTrails = (
  base: GameState,
  trails: ReadonlyMap<PlayerId, ReadonlySet<ArrowId>>,
): GameState => ({ ...base, trails });

/** A seat of `state` other than `me`. */
export const otherSeat = (state: GameState, me: PlayerId): PlayerId => {
  const other = state.players.find((p) => p !== me);
  if (other === undefined) throw new Error('setup: no other seat');
  return other;
};

/**
 * Terminals of complete plans from `origin`: the pass, every legal single step
 * then `endTurn`, and each of `plans`. Labelled for failure messages.
 */
export const completesFrom = (
  origin: GameState,
  plans: readonly (readonly Move[])[],
): readonly { readonly label: string; readonly terminal: GameState }[] => {
  const singles = rules
    .legalMoves(origin)
    .filter((m) => m.kind === 'step')
    .map((m): readonly Move[] => [m, endTurn()]);
  return [[endTurn()], ...singles, ...plans].map((plan) => ({
    label: plan.map((m) => (m.kind === 'step' ? `${String(m.from)}>${String(m.exit)}×${String(m.count)}` : 'endTurn')).join(', '),
    terminal: fold(origin, plan),
  }));
};
