/**
 * Fixtures and oracles for P75 byok-offer-vertex-join.
 * docs/spec/byok-offer-vertex-join/byok-offer-vertex-join.md
 *
 * Adapter only. Everything is observed through the public offer —
 * `annotateMove` / `formatLegalMoves` / `buildUserPrompt` / `snapshotForPrompt`
 * / `threatLineFromCounts` — and read back as text.
 *
 * Boards:
 * - `spacious` (readable scenarios) and `minimal` — every arrow flanks exactly
 *   two vertices, and every vertex is a directed 3-cycle `a → x → y → a`
 *   ({@link cycleOf}), so "A holds the other borders" is two named arrows.
 * - The generated tiling, for the closing row (fill wants the real tiling) and
 *   for an arrow whose `flankVertices` order is not `compareVertices` order
 *   (fixture boards always return them sorted; the tiling mostly does not).
 * - Every turn start of the P79 corpus (three logs, 155 positions).
 *
 * The **oracle** {@link expectedClauses} is the spec's Terms + Decisions 1, 2,
 * 4, 9 written out on their own: re-walk ⇒ nothing; else one clause per flanked
 * spawner in `compareVertices` order, `h` = the seat's territory among the
 * vertex's *other* borders in `after`, ` denies=` when the exit is another seat's
 * territory in `after`.
 *
 * The **golden** (`docs/design/fixtures/P75-pre-offer-golden.json`) was written
 * from f1d971a, before P75: every `LEGAL_MOVES` row at every turn start of the
 * two grok logs. It is frozen — it records "the pre-P75 text" (Decision 5, I9).
 * Never regenerate it from a post-P75 tree.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  Move,
  PlayerId,
  Rational,
  RulesPort,
  Spawner,
  StepMove,
  VertexId,
} from '@conquarrow/contracts';
import { compareArrows, compareVertices } from '@conquarrow/rules-core';
import { CORPUS_NAMES, corpusLog, corpusPositions, positionId } from '../bench/src/corpus';
import type { CorpusPosition } from '../bench/src/corpus';
import { annotateMove, formatLegalMoves } from '../src/byokBot';
import { A, B, minimal, spacious, tiling } from './byok-interior-mill.support';
import type { Board } from './byok-interior-mill.support';

export { A, B, minimal, spacious, tiling };
export type { Board };

/** Decision 15: ⌊3871 × 1.15⌋ — the #34 user prompt measured on main fc19f5a. */
export const BUDGET_POSITION = { log: 'grok-2026-09-10T1442', moveIndex: 34 } as const;
export const BUDGET_CEILING = 4451;

/** Decision 12, verbatim. */
export const LEGEND_SENTENCE =
  'advances=<vertex> h/3→h+1/3 force=f: your territory shares of that spawner now → once this exit is your territory (absent when the exit is already your trail or territory); denies=<seat>:k/3→k-1/3: that seat\'s shares if you take this exit.';

export const LEGEND_PREFIX = 'LEGAL_MOVES grouped by from (arrow id).';

export const QUARTER: Rational = { num: 1, den: 4 };
export const THIRD: Rational = { num: 1, den: 3 };

// ---------------------------------------------------------------------------
// Board structure

/** Every arrow of a finite fixture board (its diameter window is the whole board). */
export const allArrows = (board: Board): readonly ArrowId[] =>
  board.geometry.window(board.geometry.seedPoint(), 2).arrows;

export interface Cycle {
  readonly vertex: VertexId;
  /** The border leaving `target(a)`. */
  readonly x: ArrowId;
  /** The border entering `origin(a)` — a stack on `y` can step onto `a`. */
  readonly y: ArrowId;
}

/** The 3-cycle `a → x → y → a` that bounds `vertex`, read through the port. */
export const cycleOf = (geometry: GeometryPort, a: ArrowId, vertex: VertexId): Cycle => {
  const others = geometry.borderArrows(vertex).filter((arrow) => arrow !== a);
  const x = others.find((arrow) => geometry.origin(arrow) === geometry.target(a));
  const y = others.find((arrow) => geometry.target(arrow) === geometry.origin(a));
  if (x === undefined || y === undefined || others.length !== 2) {
    throw new Error(`setup: ${String(vertex)} is not a 3-cycle through ${String(a)}`);
  }
  return { vertex, x, y };
};

/** Flanked vertices of `a`, in `compareVertices` order. */
export const flanksSorted = (geometry: GeometryPort, a: ArrowId): VertexId[] =>
  [...geometry.flankVertices(a)].toSorted(compareVertices);

/** An in-arrow of `origin(a)` that borders none of `avoid`, lowest by id. */
export const feederOf = (
  geometry: GeometryPort,
  a: ArrowId,
  avoid: readonly VertexId[],
): ArrowId => {
  const avoided = new Set(avoid.flatMap((v) => geometry.borderArrows(v)));
  const feeder = [...geometry.inArrows(geometry.origin(a))]
    .toSorted(compareArrows)
    .find((arrow) => !avoided.has(arrow) && arrow !== a);
  if (feeder === undefined) throw new Error(`setup: no feeder into ${String(a)} avoiding the vertices`);
  return feeder;
};

// ---------------------------------------------------------------------------
// States

export interface Setup {
  readonly territory?: readonly (readonly [ArrowId, PlayerId])[];
  readonly trail?: readonly ArrowId[];
  readonly stack: ArrowId;
  readonly heads?: number;
  readonly spawners: readonly (readonly [VertexId, Rational])[];
}

/** A on the move with one stack; B present (as owner of whatever `territory` gives it). */
export const stateOf = (setup: Setup): GameState => {
  const groups = new Map<ArrowId, Group>([
    [setup.stack, { owner: A, heads: setup.heads ?? 1, spent: 0 }],
  ]);
  const trail = new Set(setup.trail ?? []);
  const spawners = new Map<VertexId, Spawner>(
    (setup.spawners).map(([vertex, force]) => [vertex, { force, phase: 0 }]),
  );
  return {
    players: [A, B],
    activePlayer: A,
    groups,
    trails: trail.size === 0 ? new Map() : new Map([[A, trail]]),
    territory: new Map(setup.territory ?? []),
    accumulators: new Map(),
    spawners,
    starvationStreaks: new Map(),
    dominationN: 5,
    winner: undefined,
  };
};

export const step = (from: ArrowId, exit: ArrowId, count = 1): StepMove => ({
  kind: 'step',
  from,
  exit,
  count,
});

export const rowOf = (board: Board, state: GameState, move: StepMove, me: PlayerId = A): string =>
  annotateMove(board.geometry, board.rules, state, me, move);

// ---------------------------------------------------------------------------
// Reading a row

export interface Clause {
  readonly text: string;
  readonly vertex: string;
  readonly a: number;
  readonly b: number;
  readonly force: string;
  readonly denies: { readonly seat: string; readonly k: number; readonly k1: number } | undefined;
}

const CLAUSE = / advances=(\S+) (\d+)\/3→(\d+)\/3 force=(\d+\/\d+)(?: denies=([^\s:]+):(\d+)\/3→(\d+)\/3)?/g;

export const clausesOf = (line: string): Clause[] =>
  [...line.matchAll(CLAUSE)].map((m) => ({
    text: m[0].slice(1),
    vertex: m[1] ?? '',
    a: Number(m[2]),
    b: Number(m[3]),
    force: m[4] ?? '',
    denies:
      m[5] === undefined ? undefined : { seat: m[5], k: Number(m[6]), k1: Number(m[7]) },
  }));

/** Every `advances=` occurrence, well-formed or not. */
export const advancesCount = (line: string): number => (line.match(/\badvances=/g) ?? []).length;

export const tagsOf = (line: string): string[] => {
  const tags = /\btags=(\S+)/.exec(line)?.[1];
  return tags === undefined ? [] : tags.split(',');
};

// ---------------------------------------------------------------------------
// The oracle — the spec's Terms and Decisions written out on their own

const forceText = (f: Rational): string => `${String(f.num)}/${String(f.den)}`;

export const isReWalk = (state: GameState, me: PlayerId, exit: ArrowId): boolean =>
  (state.trails.get(me)?.has(exit) ?? false) || state.territory.get(exit) === me;

/** `k(P, v)`: `v`'s borders that are `player`'s territory in `s`. */
export const holdOf = (
  geometry: GeometryPort,
  s: GameState,
  player: PlayerId,
  vertex: VertexId,
): number => geometry.borderArrows(vertex).filter((arrow) => s.territory.get(arrow) === player).length;

/** The clauses Decisions 1, 2, 4 and 9 say the row for `move` carries, in order. */
export const expectedClauses = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  move: StepMove,
): string[] => {
  if (isReWalk(state, me, move.exit)) return [];
  const after = rules.apply(state, move);
  const exitOwner = after.territory.get(move.exit);
  return flanksSorted(geometry, move.exit).flatMap((vertex) => {
    const spawner = state.spawners.get(vertex);
    if (spawner === undefined) return [];
    const h = geometry
      .borderArrows(vertex)
      .filter((arrow) => arrow !== move.exit && after.territory.get(arrow) === me).length;
    let clause = `advances=${String(vertex)} ${String(h)}/3→${String(h + 1)}/3 force=${forceText(spawner.force)}`;
    if (exitOwner !== undefined && exitOwner !== me) {
      const k = holdOf(geometry, after, exitOwner, vertex);
      clause += ` denies=${String(exitOwner)}:${String(k)}/3→${String(k - 1)}/3`;
    }
    return [clause];
  });
};

/** Decision 7(b): `apply` took some spawner vertex to 3 of `me`'s shares. */
export const applyCompletes = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  move: StepMove,
): boolean => {
  const after = rules.apply(state, move);
  return [...state.spawners.keys()].some(
    (vertex) => holdOf(geometry, after, me, vertex) === 3 && holdOf(geometry, state, me, vertex) < 3,
  );
};

export const flanksSpawner = (geometry: GeometryPort, state: GameState, exit: ArrowId): boolean =>
  geometry.flankVertices(exit).some((vertex) => state.spawners.has(vertex));

// ---------------------------------------------------------------------------
// The corpus as a bank of rows

export interface Case {
  readonly label: string;
  readonly board: Board;
  readonly state: GameState;
  readonly me: PlayerId;
}

export interface Seen extends Case {
  readonly move: StepMove;
  readonly line: string;
}

/** One `LEGAL_MOVES` line per offer step, paired with its move by `[i]`. */
export const offerLines = (
  board: Board,
  state: GameState,
  me: PlayerId,
): { readonly move: StepMove; readonly line: string }[] => {
  const offer: readonly Move[] = board.rules.legalMoves(state);
  const text = formatLegalMoves(offer, board.geometry, board.rules, state, me);
  if (text === '') return [];
  return text.split('\n').map((line) => {
    const index = Number(/^\[(\d+)\]/.exec(line)?.[1] ?? '-1');
    const move = offer[index];
    if (move?.kind !== 'step') throw new Error(`setup: [${String(index)}] is not a step: ${line}`);
    return { move, line };
  });
};

export const rowsOfCase = (c: Case): Seen[] =>
  offerLines(c.board, c.state, c.me).map(({ move, line }) => ({
    ...c,
    label: `${c.label}: ${line}`,
    move,
    line,
  }));

export const allPositions = (): readonly CorpusPosition[] =>
  CORPUS_NAMES.flatMap((name) => corpusPositions(corpusLog(name)));

export const GROK_LOGS = ['grok-2026-09-10T0657', 'grok-2026-09-10T1442'] as const;

export const grokPositions = (): readonly CorpusPosition[] =>
  GROK_LOGS.flatMap((name) => corpusPositions(corpusLog(name)));

export const idOf = (position: CorpusPosition): string => positionId(position.log, position.moveIndex);

/** Every turn start of the P79 corpus (155 positions), on the tiling the bench composes. */
export const corpusCases = (): Case[] =>
  allPositions().map((position) => ({
    label: idOf(position),
    board: tiling,
    state: position.state,
    me: position.seat,
  }));

/**
 * Fixture bank: on both fixture boards, for every arrow `a` and each vertex `v`
 * it flanks (cycle `a → x → y`, feeder `z` off both of `a`'s vertices), five
 * holdings of `v` with a spawner on `v` (and a second, 1/3, on `a`'s other
 * vertex in the double-fed shape):
 * - `own1` — A holds `y`, stack on `y` (1/3 → 2/3);
 * - `own2` — A holds `x`, `y`, stack on `y` (the third border);
 * - `held` — A holds `y` and `a` (the step onto `a` is a re-walk);
 * - `foe`  — B holds `a`, `x`, `y`; A holds `z`, stack on `z` (denies);
 * - `fed`  — A holds `z`, stack on `z`, both of `a`'s vertices spawners.
 * Every offer row of every state is checked, not just the step onto `a`.
 */
export const fixtureCases = (): Case[] =>
  [spacious, minimal].flatMap((board) =>
    allArrows(board).flatMap((a) => {
      const g = board.geometry;
      const flank = flanksSorted(g, a);
      return flank.flatMap((v) => {
        const other = flank.find((w) => w !== v);
        const { x, y } = cycleOf(g, a, v);
        const z = feederOf(g, a, flank);
        const one: Setup['spawners'] = [[v, QUARTER]];
        const label = (shape: string): string => `${board.name} a=${String(a)} v=${String(v)} ${shape}`;
        const shapes: [string, Setup][] = [
          ['own1', { territory: [[y, A]], stack: y, heads: 2, spawners: one }],
          ['own2', { territory: [[x, A], [y, A]], stack: y, heads: 2, spawners: one }],
          ['held', { territory: [[y, A], [a, A]], stack: y, heads: 2, spawners: one }],
          ['foe', { territory: [[z, A], [a, B], [x, B], [y, B]], stack: z, spawners: one }],
          [
            'fed',
            {
              territory: [[z, A]],
              stack: z,
              spawners: other === undefined ? one : [[v, QUARTER], [other, THIRD]],
            },
          ],
        ];
        return shapes.map(([shape, setup]) => ({ label: label(shape), board, state: stateOf(setup), me: A }));
      });
    }),
  );

let bankCache: readonly Seen[] | undefined;

/** Every offer row of the fixture bank and of every corpus position. */
export const bankRows = (): readonly Seen[] => {
  if (bankCache !== undefined) return bankCache;
  bankCache = [...fixtureCases(), ...corpusCases()].flatMap(rowsOfCase);
  return bankCache;
};

// ---------------------------------------------------------------------------
// The spawner-row interest filter (Decision 10 keeps it unchanged)

export const isInteresting = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  vertex: VertexId,
): boolean => {
  const held = new Set<string>();
  let unclaimed = 0;
  for (const arrow of geometry.borderArrows(vertex)) {
    const owner = state.territory.get(arrow);
    if (owner === undefined) unclaimed += 1;
    else held.add(String(owner));
  }
  const mine = held.has(String(me));
  const contested = held.size > 1 || (unclaimed > 0 && held.size > 0);
  return mine || contested || unclaimed === 3;
};

/** Tier 0: a border of the vertex is an arrow of `me`'s groups or an offer exit. */
export const isIncident = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  vertex: VertexId,
  offer: readonly Move[],
): boolean => {
  const incident = new Set<ArrowId>();
  for (const [arrow, group] of state.groups) if (group.owner === me) incident.add(arrow);
  for (const move of offer) if (move.kind === 'step') incident.add(move.exit);
  return geometry.borderArrows(vertex).some((arrow) => incident.has(arrow));
};

export interface SnapRows {
  readonly spawnersShown: number;
  readonly vertices: readonly string[];
}

export const asSnapRows = (snap: unknown): SnapRows => {
  if (typeof snap !== 'object' || snap === null) throw new Error('setup: snapshot is not an object');
  const rec = snap as Record<string, unknown>;
  const shown = rec['spawnersShown'];
  const rows = rec['spawners'];
  if (typeof shown !== 'number' || !Array.isArray(rows)) {
    throw new Error('setup: snapshot missing spawnersShown / spawners');
  }
  const vertices = rows.map((row: unknown) => {
    const vertex = (row as Record<string, unknown> | null)?.['vertex'];
    if (typeof vertex !== 'string') throw new Error('setup: spawner row without vertex');
    return vertex;
  });
  return { spawnersShown: shown, vertices };
};

// ---------------------------------------------------------------------------
// Normalising across P75 — what may change on a row and nothing else

/** Drop the P75 additions: every `advances=` clause and the two new tags. */
export const withoutP75 = (line: string): string =>
  dropTags(line.replace(CLAUSE, ''), ['completes_spawner', 'double_fed']);

/** Drop the retired tag from a pre-P75 row. */
export const withoutBordersSpawner = (line: string): string => dropTags(line, ['borders_spawner']);

export const dropTags = (line: string, drop: readonly string[]): string =>
  line.replace(/ tags=(\S+)/, (_whole, tags: string) => {
    const kept = tags.split(',').filter((tag) => !drop.includes(tag));
    return kept.length === 0 ? '' : ` tags=${kept.join(',')}`;
  });

/** Ids are minted per geometry; the rest of the row is what must agree. */
export const withoutIds = (text: string): string =>
  text
    .replace(/\bfrom=\S+/g, 'from=FROM')
    .replace(/\bexit=\S+/g, 'exit=EXIT')
    .replace(/\badvances=\S+/g, 'advances=VERTEX');

// ---------------------------------------------------------------------------
// The pre-P75 golden

const here = dirname(fileURLToPath(import.meta.url));

export const GOLDEN_PATH = join(here, '../../../docs/design/fixtures/P75-pre-offer-golden.json');

/** position id → every pre-P75 `LEGAL_MOVES` row, in offer order. */
export const golden = (): Readonly<Record<string, readonly string[]>> => {
  const raw: unknown = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  const rows = (raw as Record<string, unknown> | null)?.['offerRows'];
  if (typeof rows !== 'object' || rows === null || Array.isArray(rows)) {
    throw new Error('setup: golden offerRows is not an object');
  }
  const out: Record<string, string[]> = {};
  for (const [key, lines] of Object.entries(rows)) {
    if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
      throw new Error(`setup: golden offerRows.${key} is not a string array`);
    }
    out[key] = lines as string[];
  }
  return out;
};
