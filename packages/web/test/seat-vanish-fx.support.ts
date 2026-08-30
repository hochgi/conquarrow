/**
 * Hand-authored before → after diffs for P39 seat-vanish FX.
 *
 * The event layer is a reading of the step, not a call into `isLost` / `vanishSeat`.
 * These pairs name exactly the pieces that left so a failure points at one transition.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { resolveEvents, type GameEvent } from '../src/fx/events';
import { MAX_FX_CELLS, presentEvents, type FxOverlay } from '../src/fx/present';
import { emptyMatchSummary, foldMatchSummary, type MatchSummary } from '../src/matchLog';
import { A, B, C, geometry, pick, state, tile } from './event-legibility.support';

export { A, B, C, geometry, kinds, pick, state, tile } from './event-legibility.support';
export { MAX_FX_CELLS };

export const FROM = tile(30, 0, 0);
export const TO = tile(30, 0, 1);
export const A_HOME = tile(10, 0, 0);
export const B_HOME = tile(20, 0, 0);
export const B_LAND = tile(20, 1, 0);
export const B_TRAIL = [tile(21, 0, 0), tile(21, 0, 1), tile(21, 0, 2)] as const;
export const C_HEAD = tile(2, 0, 0);
export const C_CONVERT = tile(3, 0, 0);
export const C_TRAIL = [tile(1, 0, 1), tile(1, 0, 0)] as const;
export const VACATED = [tile(0, 0, 1), tile(0, 0, 0)] as const;
export const CAPTURED = [tile(0, 1, 0), tile(0, 1, 1)] as const;
export const C_PAID_LAND = tile(0, 2, 0);

export const STEP: Move = { kind: 'step', from: FROM, exit: TO, count: 1 };
export const END_TURN: Move = { kind: 'endTurn' };

export interface StepPair {
  readonly before: GameState;
  readonly after: GameState;
  readonly move: Move;
}

export const resolveOf = (pair: StepPair): readonly GameEvent[] => resolveEvents(pair);

export const presentOf = (events: readonly GameEvent[]): readonly FxOverlay[] =>
  presentEvents(events, { geometry, seq: 1 });

export const foldOf = (pair: StepPair): MatchSummary =>
  foldMatchSummary(emptyMatchSummary(), [pair.move], pair.before, pair.after, 0);

export const hadPieces = (game: GameState, player: PlayerId): boolean => {
  for (const group of game.groups.values()) if (group.owner === player) return true;
  if ((game.trails.get(player)?.size ?? 0) > 0) return true;
  for (const owner of game.territory.values()) if (owner === player) return true;
  return false;
};

const byId = (left: ArrowId, right: ArrowId): number => {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Spec remnant oracle — tests encode the formula; production must match it. */
export const remnantArrows = (
  before: GameState,
  after: GameState,
  player: PlayerId,
): readonly ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  const consider = (arrow: ArrowId): void => {
    if (seen.has(String(arrow))) return;
    if (after.territory.has(arrow)) return;
    if (after.groups.has(arrow)) return;
    seen.add(String(arrow));
    out.push(arrow);
  };
  for (const arrow of before.trails.get(player) ?? []) {
    if (after.trails.get(player)?.has(arrow) !== true) consider(arrow);
  }
  for (const [arrow, owner] of before.territory) {
    if (owner === player && after.territory.get(arrow) === undefined) consider(arrow);
  }
  for (const [arrow, group] of before.groups) {
    if (group.owner === player && after.groups.get(arrow) === undefined) consider(arrow);
  }
  return out.toSorted(byId).slice(0, MAX_FX_CELLS);
};

export const seatVanishedFor = (
  events: readonly GameEvent[],
  player: PlayerId,
): Extract<GameEvent, { kind: 'seatVanished' }> | undefined =>
  pick(events, 'seatVanished').find((event) => event.player === player);

export const trailCutFor = (
  events: readonly GameEvent[],
  victim: PlayerId,
): Extract<GameEvent, { kind: 'trailCut' }> | undefined =>
  pick(events, 'trailCut').find((event) => event.victim === victim);

export const seatVanishOverlay = (
  overlays: readonly FxOverlay[],
  player: PlayerId,
): Extract<FxOverlay, { kind: 'seatVanish' }> | undefined =>
  overlays.find(
    (overlay): overlay is Extract<FxOverlay, { kind: 'seatVanish' }> =>
      overlay.kind === 'seatVanish' && overlay.player === player,
  );

export const vanishedPlayersOf = (pair: StepPair): readonly PlayerId[] =>
  pair.before.players.filter(
    (player) => hadPieces(pair.before, player) && !hadPieces(pair.after, player),
  );

export const namedSeatVanished = (
  player: PlayerId,
  arrows: readonly ArrowId[],
): Extract<GameEvent, { kind: 'seatVanished' }> => ({
  kind: 'seatVanished',
  player,
  arrows,
});

const livingAB = (
  aArrow: ArrowId,
  extra?: {
    readonly groups?: readonly (readonly [ArrowId, PlayerId, number])[];
    readonly trails?: readonly (readonly [PlayerId, readonly ArrowId[]])[];
    readonly territory?: readonly (readonly [ArrowId, PlayerId])[];
    readonly activePlayer?: PlayerId;
    readonly players?: readonly PlayerId[];
  },
): GameState =>
  state({
    ...(extra?.activePlayer !== undefined ? { activePlayer: extra.activePlayer } : {}),
    ...(extra?.players !== undefined ? { players: extra.players } : {}),
    groups: [[aArrow, A, 1], [B_HOME, B, 1], ...(extra?.groups ?? [])],
    ...(extra?.trails !== undefined ? { trails: extra.trails } : {}),
    territory: [[B_LAND, B], ...(extra?.territory ?? [])],
  });

/** C had territory, a trail and heads; the step leaves C with no pieces. Leftover land is unowned. */
export const vanishCLeavingRemnants = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    trails: [[C, [...C_TRAIL]]],
    territory: [
      [VACATED[0], C],
      [VACATED[1], C],
    ],
  }),
  after: livingAB(TO),
});

/** A's step takes C's last territory; C's trail and head also leave. Captured land is A's. */
export const vanishCLastLandCaptured = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    trails: [[C, [...C_TRAIL]]],
    territory: [
      [CAPTURED[0], C],
      [CAPTURED[1], C],
    ],
  }),
  after: livingAB(TO, {
    territory: [
      [CAPTURED[0], A],
      [CAPTURED[1], A],
    ],
  }),
});

/** C's last land is captured and C had nothing else — empty remnant. */
export const vanishCEmptyRemnant = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    territory: [
      [CAPTURED[0], C],
      [CAPTURED[1], C],
    ],
  }),
  after: livingAB(TO, {
    territory: [
      [CAPTURED[0], A],
      [CAPTURED[1], A],
    ],
  }),
});

/** A C group on C_CONVERT changes owner to A in place; C otherwise leaves. */
export const vanishCConverted = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [
      [C_CONVERT, C, 3],
      [C_HEAD, C, 1],
    ],
    trails: [[C, [...C_TRAIL]]],
  }),
  after: livingAB(TO, {
    groups: [[C_CONVERT, A, 3]],
  }),
});

/** Starvation end of turn: C held share-free land, a trail and heads, then none. */
export const starveC = (): StepPair => ({
  move: END_TURN,
  before: livingAB(A_HOME, {
    activePlayer: A,
    groups: [[C_HEAD, C, 1]],
    trails: [[C, [...C_TRAIL]]],
    territory: [
      [VACATED[0], C],
      [VACATED[1], C],
    ],
  }),
  after: livingAB(A_HOME, {
    activePlayer: B,
    groups: [],
  }),
});

/** Mid-match: C leaves, A and B remain, winner unset. */
export const vanishCMidMatch = (): StepPair => vanishCLeavingRemnants();

/** B's trail shrinks; B still holds heads, land and a remainder of trail. C is unchanged. */
export const cutLivingB = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    trails: [[B, [...B_TRAIL]]],
    territory: [[C_PAID_LAND, C]],
  }),
  after: livingAB(TO, {
    groups: [[C_HEAD, C, 1]],
    trails: [[B, [B_TRAIL[2]]]],
    territory: [[C_PAID_LAND, C]],
  }),
});

/** Same step vanishes C and cuts living B. */
export const cutBVanishC = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    trails: [
      [B, [...B_TRAIL]],
      [C, [...C_TRAIL]],
    ],
  }),
  after: livingAB(TO, {
    trails: [[B, [B_TRAIL[2]]]],
  }),
});

/** Two seats leave, in players order A, B, C → events B then C. */
export const vanishBC = (): StepPair => ({
  move: STEP,
  before: state({
    groups: [
      [FROM, A, 1],
      [B_HOME, B, 1],
      [C_HEAD, C, 1],
    ],
    trails: [
      [B, [B_TRAIL[0], B_TRAIL[1]]],
      [C, [...C_TRAIL]],
    ],
    territory: [
      [B_LAND, B],
      [VACATED[0], C],
    ],
  }),
  after: state({
    groups: [[TO, A, 1]],
  }),
});

/** Players order A, C, B so event order is not id-sort. */
export const vanishCBPlayersOrder = (): StepPair => ({
  move: STEP,
  before: state({
    players: [A, C, B],
    groups: [
      [FROM, A, 1],
      [B_HOME, B, 1],
      [C_HEAD, C, 1],
    ],
    trails: [
      [B, [B_TRAIL[0]]],
      [C, [...C_TRAIL]],
    ],
  }),
  after: state({
    players: [A, C, B],
    groups: [[TO, A, 1]],
  }),
});

export const alreadyGoneC = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM),
  after: livingAB(TO),
});

/** C owns territory after, with no group and no trail — paid, not vanished. */
export const headlessButPaidC = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    territory: [[C_PAID_LAND, C]],
  }),
  after: livingAB(TO, {
    territory: [[C_PAID_LAND, C]],
  }),
});

export const closeOwnLoopA = (): StepPair => {
  const loop = [tile(5, 0, 0), tile(5, 0, 1), tile(5, 0, 2)] as const;
  const closing = loop[2];
  return {
    move: { kind: 'step', from: loop[1], exit: closing, count: 1 },
    before: livingAB(loop[1], {
      trails: [[A, [...loop]]],
    }),
    after: livingAB(closing, {
      trails: [[A, []]],
      territory: [
        [loop[0], A],
        [loop[1], A],
        [loop[2], A],
      ],
    }),
  };
};

/** The chair passes and nobody's holdings change — no seat vanished. */
export const passNobodyVanishes = (): StepPair => ({
  move: END_TURN,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    territory: [[C_PAID_LAND, C]],
  }),
  after: livingAB(FROM, {
    activePlayer: B,
    groups: [[C_HEAD, C, 1]],
    territory: [[C_PAID_LAND, C]],
  }),
});

/** C's trail shrinks to nothing and C has no pieces; B's trail does not shrink. */
export const vanishCTrailDrop = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    groups: [[C_HEAD, C, 1]],
    trails: [[C, [...C_TRAIL]]],
  }),
  after: livingAB(TO),
});

export const livingBTrailDrop = (): StepPair => ({
  move: STEP,
  before: livingAB(FROM, {
    trails: [[B, [B_TRAIL[0], B_TRAIL[1]]]],
  }),
  after: livingAB(TO, {
    trails: [[B, [B_TRAIL[1]]]],
  }),
});

const here = dirname(fileURLToPath(import.meta.url));

export const readWebSrc = (...parts: readonly string[]): string =>
  readFileSync(join(here, '../src', ...parts), 'utf8');

export const VANISH_PAIRS: readonly (readonly [string, StepPair])[] = [
  ['trail heads vacated', vanishCLeavingRemnants()],
  ['last land captured', vanishCLastLandCaptured()],
  ['empty remnant', vanishCEmptyRemnant()],
  ['converted stack', vanishCConverted()],
  ['starvation end-turn', starveC()],
  ['two seats', vanishBC()],
  ['cut beside vanish', cutBVanishC()],
  ['trail drop only', vanishCTrailDrop()],
];

export const LIVING_PAIRS: readonly (readonly [string, StepPair])[] = [
  ['genuine cut of B', cutLivingB()],
  ['own loop close', closeOwnLoopA()],
  ['pass, nobody gone', passNobodyVanishes()],
  ['already gone', alreadyGoneC()],
  ['headless but paid', headlessButPaidC()],
];
