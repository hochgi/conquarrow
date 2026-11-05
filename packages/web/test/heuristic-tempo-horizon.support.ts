/**
 * Fixture replay, premise checks and constructed boards for P85
 * (docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md).
 *
 * Committed fixtures, replayed from `makeMatch(config)`:
 * - `playtest-2026-11-02.match-log.json`, `playtest-2026-11-03.match-log.json`
 *   (verbatim playtest logs; 3 seats, A and B heuristic, C human);
 * - `mirror-p85-s{1,2,3}.moves.json` (the baseline `mirror` cells, `main` `c7ee34c`);
 * - `p85-pre-outputs.json` — what the pre-P85 code returned at every intercept
 *   and sortie fixture position (nested search, `chooseMove`, `evaluate`),
 *   recorded on `50a716f` for decision 10 / invariant 8.
 *
 * Every premise a scenario states is checked against the test-side oracle in
 * `tempo-race.support.ts` and throws `setup:` when it fails — never a red
 * test for the wrong reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, Group, Move, PlayerId, StepMove } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { exposure } from '../src/botClose';
import { homewardPath } from '../src/botEvaluate';
// Binds the P55 reply search `exposure` reads.
import '../src/botSearch';
import { isCutMove } from '../src/opponent';
import {
  afterOpeningOpenTrailUnderFire,
  geometry,
  legalSteps,
  rules,
  SMALL_MATCH,
  THREE_MATCH,
} from './bot-turn-search.support';
import {
  isTurnStart,
  loadReplay,
  seatOf,
  stateAt,
  type Replay,
  type SeatLabel,
} from './heuristic-never-idle.support';
import {
  compareArrowIds,
  comparePlayerIds,
  landOf,
  specBareMarks,
  specInterceptDistance,
  specInterceptOf,
  specPassableDistance,
  specSortie,
  specSortieCredit,
  SPEC_SORTIE_TOTAL_CAP,
  trailSize,
  type SpecRace,
} from './tempo-race.support';

export * from './tempo-race.support';
export {
  foldPlan,
  geometry,
  hasStep,
  isTurnStart,
  loggedTurn,
  passTurnAt,
  planIsLegalSequence,
  planTerminates,
  PLAYTEST_PASS_TURNS,
  playtest,
  rules,
  sameMoves,
  seatOf,
  shuffleCloseMaps,
  stateAt,
  stepIsLegal,
  turnStarts,
  type Replay,
  type SeatLabel,
} from './heuristic-never-idle.support';
export { boxedAfterOccupy } from './opponent-ply-and-denial.support';
export { legalSteps, SMALL_MATCH, THREE_MATCH } from './bot-turn-search.support';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture logs
// ---------------------------------------------------------------------------

export type LogName =
  | 'playtest-2026-11-02'
  | 'playtest-2026-11-03'
  | 'mirror-p85-s1'
  | 'mirror-p85-s2'
  | 'mirror-p85-s3';

const FILES: Readonly<Record<LogName, string>> = {
  'playtest-2026-11-02': 'playtest-2026-11-02.match-log.json',
  'playtest-2026-11-03': 'playtest-2026-11-03.match-log.json',
  'mirror-p85-s1': 'mirror-p85-s1.moves.json',
  'mirror-p85-s2': 'mirror-p85-s2.moves.json',
  'mirror-p85-s3': 'mirror-p85-s3.moves.json',
};

/**
 * Logs recorded under rules that have since changed, cut at their first move the
 * current rules refuse. playtest-2026-11-03 predates P88 (SPEC §6.1, §7 after P86):
 * from move 265 on it no longer replays. Every fixture index here is below the cut.
 */
const UNTIL: Readonly<Partial<Record<LogName, number>>> = {
  'playtest-2026-11-03': 265,
};

export const replayOf = (log: LogName): Replay => loadReplay(log, FILES[log], UNTIL[log]);

// ---------------------------------------------------------------------------
// The fixture tables (spec "Fixtures")
// ---------------------------------------------------------------------------

export type InterceptFixture = {
  readonly id: string;
  readonly log: LogName;
  readonly index: number;
  readonly seat: SeatLabel;
  readonly enemy: SeatLabel;
  readonly mine: number;
  readonly theirs: number;
};

/** Spec "Intercept fixtures" — the six multi-turn misses of list 1. */
export const INTERCEPT_FIXTURES: readonly InterceptFixture[] = [
  { id: 'I1', log: 'playtest-2026-11-02', index: 193, seat: 'A', enemy: 'C', mine: 2, theirs: 2 },
  { id: 'I2', log: 'playtest-2026-11-02', index: 249, seat: 'B', enemy: 'C', mine: 1, theirs: 1 },
  { id: 'I3', log: 'playtest-2026-11-03', index: 102, seat: 'B', enemy: 'C', mine: 2, theirs: 2 },
  { id: 'I4', log: 'playtest-2026-11-03', index: 134, seat: 'A', enemy: 'C', mine: 5, theirs: 5 },
  { id: 'I5', log: 'playtest-2026-11-03', index: 154, seat: 'A', enemy: 'C', mine: 3, theirs: 3 },
  { id: 'I6', log: 'mirror-p85-s1', index: 153, seat: 'A', enemy: 'B', mine: 2, theirs: 2 },
];

/** Spec acceptance: ≥ 5 of 6 intercept fixtures pass. */
export const INTERCEPT_FLOOR = 5;

export type SortieFixture = {
  readonly id: string;
  readonly log: LogName;
  readonly index: number;
  readonly seat: SeatLabel;
  readonly loot: number;
};

/** Spec "Sortie fixtures" — the 36 non-dominant small sorties (S15 dropped by P88: its log diverges at move 265), at the turn the logged seat landed. */
export const SORTIE_FIXTURES: readonly SortieFixture[] = [
  { id: 'S1', log: 'playtest-2026-11-02', index: 12, seat: 'A', loot: 2 },
  { id: 'S2', log: 'playtest-2026-11-02', index: 43, seat: 'A', loot: 3 },
  { id: 'S3', log: 'playtest-2026-11-02', index: 69, seat: 'B', loot: 3 },
  { id: 'S4', log: 'playtest-2026-11-02', index: 87, seat: 'B', loot: 2 },
  { id: 'S5', log: 'playtest-2026-11-02', index: 130, seat: 'B', loot: 2 },
  { id: 'S6', log: 'playtest-2026-11-02', index: 168, seat: 'A', loot: 3 },
  { id: 'S7', log: 'playtest-2026-11-02', index: 259, seat: 'A', loot: 1 },
  { id: 'S8', log: 'playtest-2026-11-02', index: 367, seat: 'A', loot: 2 },
  { id: 'S9', log: 'playtest-2026-11-03', index: 12, seat: 'A', loot: 2 },
  { id: 'S10', log: 'playtest-2026-11-03', index: 43, seat: 'A', loot: 3 },
  { id: 'S11', log: 'playtest-2026-11-03', index: 72, seat: 'B', loot: 3 },
  { id: 'S12', log: 'playtest-2026-11-03', index: 89, seat: 'A', loot: 3 },
  { id: 'S13', log: 'playtest-2026-11-03', index: 93, seat: 'B', loot: 2 },
  { id: 'S14', log: 'playtest-2026-11-03', index: 137, seat: 'B', loot: 2 },
  { id: 'S16', log: 'mirror-p85-s1', index: 8, seat: 'B', loot: 3 },
  { id: 'S17', log: 'mirror-p85-s1', index: 29, seat: 'B', loot: 3 },
  { id: 'S18', log: 'mirror-p85-s1', index: 33, seat: 'A', loot: 3 },
  { id: 'S19', log: 'mirror-p85-s1', index: 54, seat: 'A', loot: 3 },
  { id: 'S20', log: 'mirror-p85-s1', index: 57, seat: 'B', loot: 3 },
  { id: 'S21', log: 'mirror-p85-s1', index: 64, seat: 'B', loot: 1 },
  { id: 'S22', log: 'mirror-p85-s1', index: 68, seat: 'A', loot: 2 },
  { id: 'S23', log: 'mirror-p85-s1', index: 75, seat: 'A', loot: 1 },
  { id: 'S24', log: 'mirror-p85-s1', index: 91, seat: 'B', loot: 1 },
  { id: 'S25', log: 'mirror-p85-s2', index: 10, seat: 'B', loot: 2 },
  { id: 'S26', log: 'mirror-p85-s2', index: 28, seat: 'A', loot: 3 },
  { id: 'S27', log: 'mirror-p85-s2', index: 32, seat: 'B', loot: 3 },
  { id: 'S28', log: 'mirror-p85-s2', index: 46, seat: 'B', loot: 3 },
  { id: 'S29', log: 'mirror-p85-s2', index: 50, seat: 'A', loot: 2 },
  { id: 'S30', log: 'mirror-p85-s2', index: 109, seat: 'A', loot: 2 },
  { id: 'S31', log: 'mirror-p85-s2', index: 120, seat: 'A', loot: 2 },
  { id: 'S32', log: 'mirror-p85-s2', index: 135, seat: 'A', loot: 2 },
  { id: 'S33', log: 'mirror-p85-s3', index: 27, seat: 'A', loot: 3 },
  { id: 'S34', log: 'mirror-p85-s3', index: 43, seat: 'B', loot: 3 },
  { id: 'S35', log: 'mirror-p85-s3', index: 105, seat: 'A', loot: 1 },
  { id: 'S36', log: 'mirror-p85-s3', index: 134, seat: 'B', loot: 1 },
  { id: 'S37', log: 'mirror-p85-s3', index: 158, seat: 'B', loot: 1 },
];

/** Spec acceptance: ≥ 30 of 36 sortie fixtures reach for a larger close. */
export const SORTIE_FLOOR = 30;

/** Spec "Baselines": the pre-P85 live seat reaches for a larger close at exactly these. */
export const SORTIE_BASELINE_PASSES = ['S7', 'S21', 'S22', 'S23'] as const;

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export type FixturePosition = {
  readonly id: string;
  readonly state: GameState;
  readonly me: PlayerId;
};

/** Replay `log` through `index`; the named seat must be to move, at the start of its turn. */
export const positionAt = (id: string, log: LogName, index: number, seat: SeatLabel): FixturePosition => {
  const replay = replayOf(log);
  const state = stateAt(replay, index);
  const me = seatOf(state, seat);
  const where = `${id} ${log}@${String(index)}`;
  if (state.winner !== undefined) throw new Error(`setup: ${where} is already won`);
  if (state.activePlayer !== me) throw new Error(`setup: ${where} is not seat ${seat}'s turn`);
  if (!isTurnStart(replay, index)) throw new Error(`setup: ${where} is not a turn start`);
  return { id, state, me };
};

/** True when some legal first step of `me` shrinks `enemy`'s trail (a cut this turn, at the origin). */
export const cutLegalAgainst = (state: GameState, me: PlayerId, enemy: PlayerId): boolean => {
  const before = trailSize(state, enemy);
  if (before === 0) return false;
  return legalSteps(state).some((m) => {
    const after = rules.apply(state, m);
    return isCutMove(state, after, me) && trailSize(after, enemy) < before;
  });
};

export type InterceptPosition = FixturePosition & {
  readonly fixture: InterceptFixture;
  readonly enemy: PlayerId;
  /** The origin's race against the tabled enemy (spec oracle). */
  readonly race: SpecRace;
};

/** An intercept fixture with every premise of the scenario checked. */
export const interceptPosition = (fixture: InterceptFixture): InterceptPosition => {
  const { id, state, me } = positionAt(fixture.id, fixture.log, fixture.index, fixture.seat);
  const enemy = seatOf(state, fixture.enemy);
  if (cutLegalAgainst(state, me, enemy)) {
    throw new Error(`setup: ${id} has a legal cut against ${fixture.enemy}`);
  }
  const race = specInterceptOf(state, me);
  if (race?.enemy !== enemy) {
    throw new Error(`setup: ${id} oracle intercept names ${String(race?.enemy)}, not ${fixture.enemy}`);
  }
  if (race.turns !== fixture.mine || race.enemyTurns !== fixture.theirs) {
    throw new Error(
      `setup: ${id} oracle race is ${String(race.turns)}/${String(race.enemyTurns)}, not ${String(fixture.mine)}/${String(fixture.theirs)}`,
    );
  }
  return { id, state, me, fixture, enemy, race };
};

export type SortiePosition = FixturePosition & { readonly fixture: SortieFixture };

export const sortiePosition = (fixture: SortieFixture): SortiePosition => ({
  ...positionAt(fixture.id, fixture.log, fixture.index, fixture.seat),
  fixture,
});

/** Spec "Intercept fixtures": the turn cuts the enemy's trail, or the origin race's distance strictly drops. */
export const interceptPasses = (pos: InterceptPosition, after: GameState): boolean => {
  if (trailSize(after, pos.enemy) < trailSize(pos.state, pos.enemy)) return true;
  return (
    specInterceptDistance(after, pos.me, pos.race) < specInterceptDistance(pos.state, pos.me, pos.race)
  );
};

/** Spec "Reaches for a larger close": land gained this turn > loot, or the terminal's projected sortie has more arrows. */
export const reachesForLargerClose = (pos: SortiePosition, terminal: GameState): boolean => {
  const gained = landOf(terminal, pos.me) - landOf(pos.state, pos.me);
  if (gained > pos.fixture.loot) return true;
  const sortie = specSortie(terminal, pos.me);
  return sortie !== undefined && sortie.arrows > pos.fixture.loot;
};

/** Every intercept and sortie fixture position (premises of the intercept rows checked). */
export const allFixturePositions = (): readonly FixturePosition[] => [
  ...INTERCEPT_FIXTURES.map((f) => interceptPosition(f)),
  ...SORTIE_FIXTURES.map((f) => sortiePosition(f)),
];

// ---------------------------------------------------------------------------
// The pre-P85 outputs (decision 10, invariant 8)
// ---------------------------------------------------------------------------

export type PreP85Output = {
  readonly id: string;
  /** `chooseTurnBeamWithBudget(..., { withReplies: false })`. */
  readonly nested: readonly Move[];
  /** `chooseMove`. */
  readonly chooseMove: Move;
  /** `evaluate(geometry, origin, me, rules)`. */
  readonly evaluate: number;
};

type PreP85File = {
  readonly source: string;
  readonly outputs: readonly PreP85Output[];
};

export const PRE_P85_FILE = join(here, 'fixtures', 'p85-pre-outputs.json');

export const preP85Outputs = (): ReadonlyMap<string, PreP85Output> => {
  const raw = JSON.parse(readFileSync(PRE_P85_FILE, 'utf8')) as PreP85File;
  return new Map(raw.outputs.map((o) => [o.id, o]));
};

// ---------------------------------------------------------------------------
// Constructed boards on the real tiling
// ---------------------------------------------------------------------------

const requirePlayer = (state: GameState, index: number): PlayerId => {
  const id = state.players[index];
  if (id === undefined) throw new Error(`setup: no seat ${String(index)}`);
  return id;
};

export const preds = (arrow: ArrowId): readonly ArrowId[] => geometry.inArrows(geometry.origin(arrow));
export const outs = (arrow: ArrowId): readonly ArrowId[] => geometry.outArrows(geometry.target(arrow));

/** Plain grain distance (nothing blocked). */
export const plainDistance = (from: ArrowId, to: readonly ArrowId[], depth = 16): number =>
  specPassableDistance(from, new Set(to.map(String)), () => false, depth);

/**
 * A bare 2-seat board: SMALL_MATCH's territory and spawners, no groups, no
 * trails; `Bot` (seat B) to move. Callers place exactly the groups a scenario names.
 */
export type BareBoard = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly E: PlayerId;
};

export const bareTwoSeat = (): BareBoard => {
  const opening = makeMatch(SMALL_MATCH);
  const E = requirePlayer(opening, 0);
  const Bot = requirePlayer(opening, 1);
  return { state: { ...opening, groups: new Map(), trails: new Map(), activePlayer: Bot }, Bot, E };
};

export type BareThree = {
  readonly state: GameState;
  readonly A: PlayerId;
  readonly B: PlayerId;
  readonly C: PlayerId;
};

export const bareThreeSeat = (): BareThree => {
  const opening = makeMatch(THREE_MATCH);
  const A = requirePlayer(opening, 0);
  const B = requirePlayer(opening, 1);
  const C = requirePlayer(opening, 2);
  return { state: { ...opening, groups: new Map(), trails: new Map(), activePlayer: A }, A, B, C };
};

export const withGroups = (
  state: GameState,
  placed: readonly (readonly [ArrowId, PlayerId, number])[],
): GameState => {
  const groups = new Map<ArrowId, Group>(state.groups);
  for (const [arrow, owner, heads] of placed) groups.set(arrow, { owner, heads, spent: 0 });
  return { ...state, groups };
};

export const withTrail = (state: GameState, player: PlayerId, arrows: readonly ArrowId[]): GameState => {
  const trails = new Map(state.trails);
  trails.set(player, new Set(arrows));
  return { ...state, trails };
};

export const ownedArrows = (state: GameState, player: PlayerId): readonly ArrowId[] =>
  [...state.territory.entries()]
    .filter(([, owner]) => owner === player)
    .map(([arrow]) => arrow)
    .toSorted(compareArrowIds);

/** Arrows within `radius` of `player`'s home, not territory of anyone, sorted. */
export const freeArrowsNear = (state: GameState, player: PlayerId, radius: number): readonly ArrowId[] => {
  const home = ownedArrows(state, player)[0];
  if (home === undefined) throw new Error('setup: player has no territory');
  return [...geometry.window(geometry.origin(home), radius).arrows]
    .filter((a) => !state.territory.has(a))
    .toSorted(compareArrowIds);
};

/**
 * An open trail of `length` arrows for `player`, a grain chain ending on its
 * tip, every arrow off anyone's territory, the tip `home` plain grain steps
 * from `player`'s territory. Deterministic: the first chain by arrow id.
 */
export type TrailShape = { readonly trail: readonly ArrowId[]; readonly tip: ArrowId };

export const findTrail = (
  state: GameState,
  player: PlayerId,
  length: number,
  home: number,
  avoid: ReadonlySet<string> = new Set(),
): TrailShape => {
  for (const tip of freeArrowsNear(state, player, 6)) {
    if (avoid.has(String(tip))) continue;
    if (homewardPath(geometry, state, player, tip, 16).distance !== home) continue;
    const chain = extendBack(state, [tip], length, avoid);
    if (chain !== undefined) return { trail: chain, tip };
  }
  throw new Error(`setup: no trail of ${String(length)} with tip ${String(home)} from home`);
};

const extendBack = (
  state: GameState,
  chain: readonly ArrowId[],
  length: number,
  avoid: ReadonlySet<string>,
): readonly ArrowId[] | undefined => {
  if (chain.length === length) return chain;
  const head = chain[0];
  if (head === undefined) return undefined;
  for (const p of [...preds(head)].toSorted(compareArrowIds)) {
    if (state.territory.has(p) || chain.includes(p) || avoid.has(String(p))) continue;
    const longer = extendBack(state, [p, ...chain], length, avoid);
    if (longer !== undefined) return longer;
  }
  return undefined;
};

/**
 * An arrow from which a mover's passable distance (blocking `blocked`'s
 * territory) to `targets` is exactly `d`, off territory and unoccupied,
 * avoiding `avoid`. First by arrow id among the candidates found by a backward
 * walk, so the result is deterministic.
 */
export const arrowAtDistance = (
  state: GameState,
  targets: readonly ArrowId[],
  d: number,
  blocked: (arrow: ArrowId) => boolean,
  avoid: ReadonlySet<string> = new Set(),
): ArrowId => {
  const want = new Set(targets.map(String));
  const seen = new Set<string>(want);
  let frontier: ArrowId[] = [...targets];
  const candidates: ArrowId[] = [];
  for (let k = 1; k <= d + 4 && frontier.length > 0; k += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const p of preds(arrow)) {
        const key = String(p);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(p);
        candidates.push(p);
      }
    }
    frontier = next;
  }
  const hit = candidates
    .filter((a) => !state.territory.has(a) && !state.groups.has(a) && !avoid.has(String(a)))
    .filter((a) => specPassableDistance(a, want, blocked, d + 4) === d)
    .toSorted(compareArrowIds)[0];
  if (hit === undefined) throw new Error(`setup: no arrow at passable distance ${String(d)}`);
  return hit;
};

export const mineBlocked =
  (state: GameState, me: PlayerId) =>
  (arrow: ArrowId): boolean =>
    state.territory.get(arrow) === me;

export const othersBlocked =
  (state: GameState, me: PlayerId) =>
  (arrow: ArrowId): boolean => {
    const owner = state.territory.get(arrow);
    return owner !== undefined && owner !== me;
  };

// --- safe-window boards ------------------------------------------------------

export type WindowBoard = {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly enemy: PlayerId;
  readonly X: ArrowId;
  readonly at: ArrowId;
};

/** Seat Bot at home (a 1-stack), one enemy group of `heads` at passable distance `d` from a free arrow X. */
export const loneEnemyAt = (d: number, heads: number): WindowBoard => {
  const { state: bare, Bot, E } = bareTwoSeat();
  const home = ownedArrows(bare, Bot)[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  const base = withGroups(bare, [[home, Bot, 1]]);
  const X = freeArrowsNear(base, Bot, 4).find(
    (a) => plainDistance(a, ownedArrows(base, E), 12) > 12,
  );
  if (X === undefined) throw new Error('setup: no free X');
  const at = arrowAtDistance(base, [X], d, mineBlocked(base, Bot), new Set([String(home)]));
  const state = withGroups(base, [[at, E, heads]]);
  return { state, me: Bot, enemy: E, X, at };
};

/**
 * An enemy 1-stack whose only 2-step grain path to X runs through an arrow of
 * my territory, and whose shortest path avoiding my territory is 5 steps.
 * The middle arrow of that path is painted as my territory (a pure reading
 * does not care how the land was won). First pair by arrow id.
 */
export const blockedByMyTerritory = (): WindowBoard & { readonly through: ArrowId } => {
  const { state: bare, Bot, E } = bareTwoSeat();
  const home = ownedArrows(bare, Bot)[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  const base = withGroups(bare, [[home, Bot, 1]]);
  for (const X of freeArrowsNear(base, Bot, 5)) {
    if (base.groups.has(X)) continue;
    for (const at of freeArrowsNear(base, Bot, 7)) {
      if (at === X || base.groups.has(at) || plainDistance(at, [X], 4) !== 2) continue;
      const middles = outs(at).filter((m) => outs(m).includes(X));
      const through = middles[0];
      if (middles.length !== 1 || through === undefined || base.territory.has(through)) continue;
      const territory = new Map(base.territory);
      territory.set(through, Bot);
      const state = withGroups({ ...base, territory }, [[at, E, 1]]);
      if (specPassableDistance(at, new Set([String(X)]), mineBlocked(state, Bot), 12) !== 5) continue;
      return { state, me: Bot, enemy: E, X, at, through };
    }
  }
  throw new Error('setup: no 2-through-territory / 5-around board');
};

// --- sortie boards -----------------------------------------------------------

export type SortieBoard = {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly enemy: PlayerId;
  readonly trail: readonly ArrowId[];
  readonly tip: ArrowId;
};

/**
 * Seat Bot with an open trail of `length` arrows, its tip a `heads`-stack
 * `home` grain steps from Bot's territory, no other group anywhere. Bot is to move.
 */
export const openTrailBoard = (length: number, home: number, heads: number): SortieBoard => {
  const { state: bare, Bot, E } = bareTwoSeat();
  const { trail, tip } = findTrail(bare, Bot, length, home);
  const state = withGroups(withTrail(bare, Bot, trail), [[tip, Bot, heads]]);
  return { state, me: Bot, enemy: E, trail, tip };
};

/** Place an enemy 1-stack whose passable distance to `targets` (Bot's territory blocked) is `d`. */
export const enemyAtTurns = (board: SortieBoard, targets: readonly ArrowId[], d: number): GameState => {
  const at = arrowAtDistance(
    board.state,
    targets,
    d,
    mineBlocked(board.state, board.me),
    new Set(board.trail.map(String)),
  );
  return withGroups(board.state, [[at, board.enemy, 1]]);
};

// --- intercept boards --------------------------------------------------------

export type RaceBoard = {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly enemy: PlayerId;
  readonly enemyTrail: readonly ArrowId[];
  readonly enemyTip: ArrowId;
};

/**
 * Enemy E (seat A of SMALL_MATCH) with an open trail of `length` arrows whose
 * tip is a 1-stack `home` grain steps from E's territory; my (Bot's) 1-stack
 * at passable distance `mine` to E's nearest bare mark (others' territory
 * blocked). Bot is to move.
 */
export const raceBoard = (length: number, home: number, mine: number): RaceBoard => {
  const { state: bare, Bot, E } = bareTwoSeat();
  const { trail, tip } = findTrail(bare, E, length, home);
  const withE = withGroups(withTrail(bare, E, trail), [[tip, E, 1]]);
  const marks = specBareMarks(withE, E);
  const at = arrowAtDistance(withE, marks, mine, othersBlocked(withE, Bot), new Set(trail.map(String)));
  const state = withGroups(withE, [[at, Bot, 1]]);
  return { state, me: Bot, enemy: E, enemyTrail: trail, enemyTip: tip };
};

/** Two enemies B and C, each with an open trail; A's single 1-stack wins against B in `toB` and C in `toC` turns. */
export const twoRacesBoard = (toB: number, toC: number): BareThree => {
  const three = bareThreeSeat();
  const { A, B, C } = three;
  const homeA = ownedArrows(three.state, A)[0];
  if (homeA === undefined) throw new Error('setup: A has no home');
  // Each enemy's trail tip is far from its own land (it cannot close soon).
  const tB = findTrail(three.state, B, 3, 6);
  const tC = findTrail(three.state, C, 3, 6, new Set(tB.trail.map(String)));
  let state = withGroups(withTrail(withTrail(three.state, B, tB.trail), C, tC.trail), [
    [tB.tip, B, 1],
    [tC.tip, C, 1],
  ]);
  const bMarks = specBareMarks(state, B);
  const cMarks = specBareMarks(state, C);
  const avoid = new Set([...tB.trail, ...tC.trail].map(String));
  // One A 1-stack per race; the nearer group decides each race's turns.
  const nearB = arrowAtDistance(state, bMarks, toB, othersBlocked(state, A), avoid);
  state = withGroups(state, [[nearB, A, 1]]);
  const nearC = arrowAtDistance(state, cMarks, toC, othersBlocked(state, A), new Set([...avoid, String(nearB)]));
  state = withGroups(state, [[nearC, A, 1]]);
  return { ...three, state };
};

/**
 * P59's under-fire board (`afterOpeningOpenTrailUnderFire`: my open trail,
 * an enemy feeder with positive exposure) plus a race I win: another enemy F
 * gets an open trail of 3 whose 1-stack tip is 6 grain steps from F's land,
 * and I get a 1-stack 2 passable steps from F's nearest bare mark.
 */
export const underFireRaceBoard = (): { readonly state: GameState; readonly me: PlayerId; readonly enemy: PlayerId } => {
  const { state: fire, me } = afterOpeningOpenTrailUnderFire();
  // The P59 builder relocates the first other seat's groups next to my trail.
  const feeder = fire.players.find((p) => p !== me);
  const taken = new Set([...fire.groups.keys(), ...(fire.trails.get(me) ?? [])].map(String));
  for (const F of fire.players.filter((p) => p !== me && p !== feeder).toSorted(comparePlayerIds)) {
    let trail: TrailShape;
    try {
      trail = findTrail(fire, F, 3, 6, taken);
    } catch {
      continue;
    }
    const withF = withGroups(withTrail(fire, F, trail.trail), [[trail.tip, F, 1]]);
    let at: ArrowId;
    try {
      at = arrowAtDistance(withF, specBareMarks(withF, F), 2, othersBlocked(withF, me), new Set([...taken, ...trail.trail.map(String)]));
    } catch {
      continue;
    }
    const state = withGroups(withF, [[at, me, 1]]);
    if (specInterceptOf(state, me) === undefined) continue;
    if (state.players.some((p) => p !== me && cutLegalAgainst(state, me, p))) continue;
    if (exposure(geometry, rules, state, me) <= 0) continue;
    return { state, me, enemy: F };
  }
  throw new Error('setup: no under-fire board with a won race');
};

/** I1 with each of my groups that reaches a bare mark of C within 2 turns slowed to a 1-stack (spec: "I1 altered"). */
export const i1Slowed = (): { readonly state: GameState; readonly me: PlayerId; readonly enemy: PlayerId } => {
  const fixture = INTERCEPT_FIXTURES[0];
  if (fixture === undefined) throw new Error('setup: no I1');
  const pos = interceptPosition(fixture);
  const groups = new Map<ArrowId, Group>(pos.state.groups);
  for (const [at, group] of pos.state.groups) {
    if (group.owner !== pos.me) continue;
    if (pos.race.stepsTo(at) === Number.POSITIVE_INFINITY) continue;
    groups.set(at, { ...group, heads: 1 });
  }
  return { state: { ...pos.state, groups }, me: pos.me, enemy: pos.enemy };
};

// ---------------------------------------------------------------------------
// Decision 12 — "land now" boards with the sortie credit made inapplicable
// ---------------------------------------------------------------------------

/**
 * True when no terminal `me` can reach this turn by up to `plies` legal steps
 * earns sortie credit (spec oracle). Steps only grow a trail or land it, so
 * this is the premise "the credit is inapplicable on this board".
 */
export const creditInapplicable = (state: GameState, me: PlayerId, plies: number): boolean => {
  let layer: GameState[] = [state];
  for (let k = 0; k <= plies; k += 1) {
    const next: GameState[] = [];
    for (const at of layer) {
      if (specSortieCredit(at, me) > 0) return false;
      if (k === plies || at.activePlayer !== me || at.winner !== undefined) continue;
      for (const m of legalSteps(at)) next.push(rules.apply(at, m));
    }
    layer = next;
  }
  return true;
};

/**
 * Lengthen `me`'s open trail backward from `from` (a grain chain of free
 * arrows) until `elapsed` alone puts every terminal of this turn past
 * SORTIE_TOTAL_CAP: `ceil(size ÷ speed) + 1 > 5`.
 */
export const withLongTrail = (state: GameState, me: PlayerId, from: ArrowId, heads: number): GameState => {
  const trail = state.trails.get(me);
  if (trail === undefined) throw new Error('setup: no trail to lengthen');
  const need = SPEC_SORTIE_TOTAL_CAP * speed(heads);
  const taken = new Set([...trail, ...state.groups.keys()].map(String));
  const chain = extendBack(state, [from], need - trail.size + 1, taken);
  if (chain === undefined) throw new Error('setup: no free chain behind the trail');
  return withTrail(state, me, [...new Set([...chain, ...trail])]);
};

/**
 * Add one enemy group (first by arrow id within `radius` of `near`, smallest
 * stack first) such that the credit is inapplicable for `plies` steps.
 */
export const withCreditBlocker = (
  state: GameState,
  me: PlayerId,
  near: ArrowId,
  plies: number,
  radius = 4,
): GameState => {
  const enemy = state.players.find((p) => p !== me);
  if (enemy === undefined) throw new Error('setup: no enemy seat');
  const candidates = [...geometry.window(geometry.origin(near), radius).arrows]
    .filter((a) => !state.territory.has(a) && !state.groups.has(a) && !(state.trails.get(me)?.has(a) ?? false))
    .toSorted(compareArrowIds);
  for (const heads of [1, 2, 4, 8]) {
    for (const at of candidates) {
      const next = withGroups(state, [[at, enemy, heads]]);
      if (creditInapplicable(next, me, plies)) return next;
    }
  }
  throw new Error('setup: no enemy placement makes the credit inapplicable');
};

// ---------------------------------------------------------------------------
// The P59 kite plan at playtest-2026-11-02 move 20 (spec edge scenario)
// ---------------------------------------------------------------------------

const arrow = (qrk: string): ArrowId => `tiling:a:${qrk}` as ArrowId;

/** "6,0,1>5,1,1 ×1, 5,0,0>6,0,1 ×2, 6,0,1>5,1,1 ×1, endTurn" */
export const KITE_MOVE_20_PLAN: readonly Move[] = [
  { kind: 'step', from: arrow('6,0,1'), exit: arrow('5,1,1'), count: 1 } satisfies StepMove,
  { kind: 'step', from: arrow('5,0,0'), exit: arrow('6,0,1'), count: 2 } satisfies StepMove,
  { kind: 'step', from: arrow('6,0,1'), exit: arrow('5,1,1'), count: 1 } satisfies StepMove,
  endTurn(),
];

export const KITE_MOVE = 20;

/** Every arrow `me`'s groups can step onto this turn: 1 … `speed(heads)` grain steps from each group. */
export const reachableThisTurn = (state: GameState, me: PlayerId): readonly ArrowId[] => {
  const reached = new Map<string, ArrowId>();
  for (const [at, group] of groupsOf(state, me)) {
    const seen = new Set<string>([String(at)]);
    let frontier: ArrowId[] = [at];
    for (let d = 0; d < speed(group.heads); d += 1) {
      const next: ArrowId[] = [];
      for (const a of frontier) {
        for (const o of outs(a)) {
          reached.set(String(o), o);
          if (seen.has(String(o))) continue;
          seen.add(String(o));
          next.push(o);
        }
      }
      frontier = next;
    }
  }
  return [...reached.values()].toSorted(compareArrowIds);
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const terminalOf = (state: GameState, moves: readonly Move[]): GameState => {
  let at = state;
  for (const move of moves) at = rules.apply(at, move);
  return at;
};

/** Remove every group of `owner` but keep the board. */
export const withoutGroupsOf = (state: GameState, owner: PlayerId): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [a, g] of state.groups) if (g.owner !== owner) groups.set(a, g);
  return { ...state, groups };
};

export const groupsOf = (state: GameState, owner: PlayerId): readonly (readonly [ArrowId, Group])[] =>
  [...state.groups.entries()].filter(([, g]) => g.owner === owner).toSorted(([a], [b]) => compareArrowIds(a, b));

