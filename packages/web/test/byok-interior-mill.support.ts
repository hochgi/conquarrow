/**
 * Fixtures and oracles for P80 byok-interior-mill.
 * docs/spec/byok-interior-mill/byok-interior-mill.md
 *
 * Adapter only. Everything is observed through the public offer —
 * `formatLegalMoves` / `annotateMove` / `buildUserPrompt` / `millOmit` — and
 * read back as text: the row's `edgeDist=a→b` / `tipDist=d0→d1` and its tags.
 *
 * Boards:
 * - `spacious` with every arrow but `0>1` as A's territory — the readable bank.
 *   Every edge distance on it is 0–3, so each scenario names its arrows.
 * - Both fixture boards with territory = every arrow but one, for every choice of
 *   the one (the property bank), and with territory = every arrow (no edge at
 *   all, so every distance is capped).
 * - The generated tiling with territory = a radius-3 window, for depth.
 * - The two archived grok logs from the P79 corpus.
 *
 * The **oracle** {@link edgeDistOracle} is the spec's Terms definition written
 * out independently: grain BFS to the nearest arrow not in `me`'s territory,
 * `0` off territory, `DIST_CAP + 1 = 17` when nothing is found within 16.
 *
 * The **golden** (`docs/design/fixtures/P80-pre-offer-golden.json`) was written
 * from main at 9d7af96, before P80: every `LEGAL_MOVES` row whose `from` is not
 * the seat's territory, and `homewardPath` results, at every turn start of the
 * two grok logs. It is frozen — it records "the pre-P80 text" (I6) and "the
 * same results as before the generalisation" (I8). Never regenerate it from a
 * post-P80 tree.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintArrowId, mintPlayerId } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  Move,
  PlayerId,
  RulesPort,
} from '@conquarrow/contracts';
import { MINIMAL, SPACIOUS, fixtureArrow, makeFixture } from '@conquarrow/geometry-fixtures';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { corpusLog, corpusPositions, positionId } from '../bench/src/corpus';
import type { CorpusPosition } from '../bench/src/corpus';
import { homewardPath } from '../src/botEvaluate';
import type { HomewardPath } from '../src/botEvaluate';
import { formatLegalMoves } from '../src/byokBot';
import type { OfferTagRow } from '../src/byokBot';

export { MINIMAL, SPACIOUS, fixtureArrow };

export const A: PlayerId = mintPlayerId('A');
export const B: PlayerId = mintPlayerId('B');

/** `DIST_CAP` in botEvaluate.ts; the spec's capped value is `DIST_CAP + 1`. */
export const DIST_CAP = 16;
export const CAPPED = DIST_CAP + 1;

export const BASELINE = 'A weak one-ply baseline would play';

export interface Board {
  readonly name: string;
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
}

const boardOf = (name: string, geometry: GeometryPort): Board => ({
  name,
  geometry,
  rules: makeRules(geometry),
});

export const spacious: Board = boardOf('spacious', makeFixture(SPACIOUS));
export const minimal: Board = boardOf('minimal', makeFixture(MINIMAL));
export const tiling: Board = boardOf('tiling', makeTiling());

/** Every arrow of a finite fixture board (its diameter window is the whole board). */
export const allArrows = (board: Board): readonly ArrowId[] =>
  board.geometry.window(board.geometry.seedPoint(), 2).arrows;

export const sp = (from: string, to: string): ArrowId => fixtureArrow(SPACIOUS, from, to);

/** The one non-territory arrow of the readable `spacious` bank. */
export const SP_EDGE = sp('0', '1');

// ---------------------------------------------------------------------------
// States

export interface Stack {
  readonly arrow: ArrowId;
  readonly heads: number;
}

/**
 * A on the move, B present with nothing (rules accept it; no seat is removed
 * mid-turn). No spawner, so no `borders_spawner` / `share+N`; no enemy trail, so
 * no `cut` / `near_trail` — the rows carry only what P80 is about.
 */
export const stateOf = (
  territory: Iterable<ArrowId>,
  stacks: readonly Stack[],
  trail: Iterable<ArrowId> = [],
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const stack of stacks) groups.set(stack.arrow, { owner: A, heads: stack.heads, spent: 0 });
  const trailSet = new Set(trail);
  return {
    players: [A, B],
    activePlayer: A,
    groups,
    trails: trailSet.size === 0 ? new Map() : new Map([[A, trailSet]]),
    territory: new Map([...territory].map((arrow) => [arrow, A])),
    accumulators: new Map(),
    spawners: new Map(),
    starvationStreaks: new Map(),
    dominationN: 5,
    winner: undefined,
  };
};

/** `spacious`, A's territory = every arrow but {@link SP_EDGE} (and `extraEdges`). */
export const spaciousInterior = (
  stacks: readonly Stack[],
  extraEdges: readonly ArrowId[] = [],
  trail: readonly ArrowId[] = [],
): GameState => {
  const off = new Set([SP_EDGE, ...extraEdges].map(String));
  return stateOf(
    allArrows(spacious).filter((arrow) => !off.has(String(arrow))),
    stacks,
    trail,
  );
};

// ---------------------------------------------------------------------------
// Reading the offer

export interface Row {
  readonly line: string;
  readonly index: number;
  readonly from: string;
  readonly exit: string;
  readonly count: number;
  readonly edgeDist: readonly [number, number] | undefined;
  readonly tipDist: readonly [number, number] | undefined;
  readonly tags: readonly string[];
}

const pair = (re: RegExp, line: string): readonly [number, number] | undefined => {
  const match = re.exec(line);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return [Number(match[1]), Number(match[2])];
};

export const parseRow = (line: string): Row => {
  const head = /^(?:\[(\d+)\] )?step from=(\S+) exit=(\S+) count=(\d+)/.exec(line);
  if (head?.[2] === undefined || head[3] === undefined || head[4] === undefined) {
    throw new Error(`setup: not a step row: ${line}`);
  }
  const tags = /\btags=(\S+)/.exec(line)?.[1];
  return {
    line,
    index: head[1] === undefined ? -1 : Number(head[1]),
    from: head[2],
    exit: head[3],
    count: Number(head[4]),
    edgeDist: pair(/ edgeDist=(\d+)→(\d+)/, line),
    tipDist: pair(/ tipDist=(\d+)→(\d+)/, line),
    tags: tags === undefined ? [] : tags.split(','),
  };
};

export const offerOf = (board: Board, state: GameState): readonly Move[] =>
  board.rules.legalMoves(state);

export const legalMovesText = (board: Board, state: GameState, me: PlayerId = A): string =>
  formatLegalMoves(offerOf(board, state), board.geometry, board.rules, state, me);

export const rowsOf = (board: Board, state: GameState, me: PlayerId = A): readonly Row[] => {
  const text = legalMovesText(board, state, me);
  return text === '' ? [] : text.split('\n').map(parseRow);
};

export const tagRowsOf = (rows: readonly Row[]): OfferTagRow[] =>
  rows.map((row) => ({ index: row.index, count: row.count, tags: row.tags }));

/** The row for one step, by its `from` / `exit` (first count). */
export const rowFor = (rows: readonly Row[], from: ArrowId, exit: ArrowId): Row => {
  const row = rows.find((r) => r.from === String(from) && r.exit === String(exit));
  if (row === undefined) throw new Error(`setup: no row ${String(from)} → ${String(exit)}`);
  return row;
};

export const isOwn = (state: GameState, me: PlayerId, arrow: string): boolean =>
  state.territory.get(mintArrowId(arrow)) === me;

// ---------------------------------------------------------------------------
// The oracle — the spec's Terms definition of edgeDist, written out on its own

export const edgeDistOracle = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  start: ArrowId | string,
): number => {
  const own = (arrow: string): boolean => isOwn(state, me, arrow);
  if (!own(String(start))) return 0;
  const visited = new Set<string>([String(start)]);
  let level: ArrowId[] = [typeof start === 'string' ? mintArrowId(start) : start];
  for (let depth = 1; depth <= DIST_CAP && level.length > 0; depth += 1) {
    const nextLevel: ArrowId[] = [];
    for (const arrow of level) {
      for (const out of geometry.outArrows(geometry.target(arrow))) {
        if (!own(String(out))) return depth;
        if (visited.has(String(out))) continue;
        visited.add(String(out));
        nextLevel.push(out);
      }
    }
    level = nextLevel;
  }
  return CAPPED;
};

// ---------------------------------------------------------------------------
// Property banks — one stack of one head on every territory arrow

export interface Case {
  readonly label: string;
  readonly board: Board;
  readonly state: GameState;
  readonly me: PlayerId;
}

const stackOnEach = (label: string, board: Board, territory: readonly ArrowId[]): Case[] =>
  territory.map((arrow) => ({
    label: `${label}, stack on ${String(arrow)}`,
    board,
    state: stateOf(territory, [{ arrow, heads: 1 }]),
    me: A,
  }));

/** Fixture boards: territory = every arrow but one, for every one. */
export const minusOneCases = (board: Board): Case[] =>
  allArrows(board).flatMap((edge) => {
    const territory = allArrows(board).filter((arrow) => arrow !== edge);
    return stackOnEach(`${board.name} minus ${String(edge)}`, board, territory);
  });

/** Fixture board wholly A's: no edge within reach, every distance capped. */
export const wholeBoardCases = (board: Board): Case[] =>
  stackOnEach(`${board.name} whole`, board, allArrows(board));

/** Tiling: territory = the radius-3 window about the seed point. */
export const tilingWindowCases = (): Case[] => {
  const window = tiling.geometry.window(tiling.geometry.seedPoint(), 3).arrows;
  return stackOnEach('tiling r=3', tiling, window);
};

/** A stack on a trail arrow off territory, on `spacious` — rows that keep `tipDist`. */
export const offTerritoryCase = (): Case => ({
  label: 'spacious, stack on trail arrow 0>1',
  board: spacious,
  state: spaciousInterior([{ arrow: SP_EDGE, heads: 2 }], [sp('1', '2')], [SP_EDGE]),
  me: A,
});

export const GROK_LOGS = ['grok-2026-09-10T0657', 'grok-2026-09-10T1442'] as const;

/** Every turn start of the two archived grok logs, on the tiling the bench composes. */
export const grokPositions = (): readonly CorpusPosition[] =>
  GROK_LOGS.flatMap((name) => corpusPositions(corpusLog(name)));

export const grokCases = (): Case[] =>
  grokPositions().map((position) => ({
    label: positionId(position.log, position.moveIndex),
    board: tiling,
    state: position.state,
    me: position.seat,
  }));

// ---------------------------------------------------------------------------
// Cross-geometry: the same position on every board

/**
 * A two-head stack on `a0`. `inside`: territory = `a0` and its three exits — on
 * any board whose adjacent points share one arrow (all three here) every exit
 * has edgeDist 1 and `a0` has 2. `lone`: territory = `a0` alone, every exit
 * leaves home. No spawner, no enemy, so a row names only P80's facts.
 */
export const starState = (board: Board, shape: 'inside' | 'lone'): GameState => {
  const a0 = board.geometry.outArrows(board.geometry.seedPoint())[0];
  if (a0 === undefined) throw new Error(`setup: ${board.name} has no out-arrow at its seed`);
  const exits = board.geometry.outArrows(board.geometry.target(a0));
  const territory = shape === 'inside' ? [a0, ...exits] : [a0];
  return stateOf(territory, [{ arrow: a0, heads: 2 }]);
};

/** Arrow ids are minted per geometry; the rest of the row is what must agree. */
export const withoutIds = (text: string): string =>
  text.replace(/\bfrom=\S+/g, 'from=FROM').replace(/\bexit=\S+/g, 'exit=EXIT');

/** Same position, maps built in the reverse insertion order. */
export const reinserted = (state: GameState): GameState => ({
  ...state,
  groups: new Map([...state.groups].toReversed()),
  territory: new Map([...state.territory].toReversed()),
  trails: new Map(
    [...state.trails].toReversed().map(([player, arrows]) => [player, new Set([...arrows].toReversed())]),
  ),
  spawners: new Map([...state.spawners].toReversed()),
  accumulators: new Map([...state.accumulators].toReversed()),
});

// ---------------------------------------------------------------------------
// The pre-P80 golden

const here = dirname(fileURLToPath(import.meta.url));

export const GOLDEN_PATH = join(here, '../../../docs/design/fixtures/P80-pre-offer-golden.json');

export interface Golden {
  /** position id → every pre-P80 LEGAL_MOVES row whose `from` is not the seat's territory. */
  readonly offTerritoryRows: Readonly<Record<string, readonly string[]>>;
  /** position id → {@link homewardLines}. */
  readonly homeward: Readonly<Record<string, readonly string[]>>;
}

const asStringRecord = (value: unknown, label: string): Record<string, string[]> => {
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
  return {
    offTerritoryRows: asStringRecord(rec['offTerritoryRows'], 'offTerritoryRows'),
    homeward: asStringRecord(rec['homeward'], 'homeward'),
  };
};

/** Off-territory rows of one position, as the golden records them. */
export const offTerritoryLines = (position: CorpusPosition): string[] =>
  legalMovesText(tiling, position.state, position.seat)
    .split('\n')
    .filter((line) => !isOwn(position.state, position.seat, parseRow(line).from));

const short = (arrow: ArrowId | undefined): string =>
  arrow === undefined ? '-' : String(arrow).replace(/^tiling:a:/, '');

const homewardLine = (start: ArrowId, variant: string, result: HomewardPath): string =>
  `${short(start)} ${variant} ${String(result.distance)} ${short(result.landing)} ${result.path.map(short).join(';')}`;

/** Starts: the seat's stacks and trail, and every exit on its offer. Sorted by id. */
export const homewardStarts = (position: CorpusPosition): ArrowId[] => {
  const starts = new Map<string, ArrowId>();
  for (const [arrow, group] of position.state.groups) {
    if (group.owner === position.seat) starts.set(String(arrow), arrow);
  }
  for (const arrow of position.state.trails.get(position.seat) ?? []) starts.set(String(arrow), arrow);
  for (const move of tiling.rules.legalMoves(position.state)) {
    if (move.kind === 'step') starts.set(String(move.exit), move.exit);
  }
  return [...starts.keys()].toSorted().flatMap((key) => {
    const arrow = starts.get(key);
    return arrow === undefined ? [] : [arrow];
  });
};

/**
 * Three calls per start: the default cap, `cap = 3`, and `cap = 6` toward an
 * explicit `home` set (the other seats' territory) — every parameter of
 * `homewardPath` that a caller uses today.
 */
export const homewardLines = (position: CorpusPosition): string[] => {
  const { state, seat } = position;
  const others = new Set(
    [...state.territory].filter(([, owner]) => owner !== seat).map(([arrow]) => String(arrow)),
  );
  return homewardStarts(position).flatMap((start) => [
    homewardLine(start, 'cap16', homewardPath(tiling.geometry, state, seat, start)),
    homewardLine(start, 'cap3', homewardPath(tiling.geometry, state, seat, start, 3)),
    homewardLine(start, 'others6', homewardPath(tiling.geometry, state, seat, start, 6, others)),
  ]);
};
