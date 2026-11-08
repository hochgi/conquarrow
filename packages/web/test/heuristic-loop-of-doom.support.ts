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
