/**
 * Fixtures for P62 BYOK teaching-prompt tests.
 * Adapter only — read the teaching file from disk (no fetch, no ?raw).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintPlayerId, movesEqual, SPAWNER_BANDS, step } from '@conquarrow/contracts';
import type { GameState, Move, PlayerId, StepMove } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { chooseMove } from '../src/opponent';
import {
  byokBotSource,
  geometry,
  offerSteps,
  pagesHeuristicSource,
  rules,
  THREE_MATCH,
} from './byok-batch-turn.support';

export {
  byokBotSource,
  geometry,
  offerSteps,
  pagesHeuristicSource,
  rules,
  THREE_MATCH,
};

const here = dirname(fileURLToPath(import.meta.url));

/** Canonical teaching file — Vitest loads it with readFileSync, never fetch. */
export const teachingFilePath = (): string => join(here, '../../../docs/byok-teaching.md');

export const readTeachingFile = (): string => readFileSync(teachingFilePath(), 'utf8');

export const readSpecMd = (): string => readFileSync(join(here, '../../../SPEC.md'), 'utf8');

export const specSection1 = (): string => {
  const spec = readSpecMd();
  const start = spec.indexOf('## 1.');
  const end = spec.indexOf('## 2.');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('setup: SPEC.md is missing §1 or §2 headings');
  }
  return spec.slice(start, end);
};

export const botTurnSearchDir = (): string =>
  join(here, '../../../docs/spec/bot-turn-search');

export const byokBatchTurnDir = (): string =>
  join(here, '../../../docs/spec/byok-batch-turn');

export const opponentSource = (): string =>
  readFileSync(join(here, '../src/opponent.ts'), 'utf8');

/** BSSN 3 verbatim locks. Subscript two matches SPEC.md. */
export const SPEED_FORMULA = 'speed(N) = 1 + floor(log₂ N)';

export const TEACHING_LOCKS: readonly string[] = [
  SPEED_FORMULA,
  'On a split, both parts inherit',
  'spent',
  'majority',
  'speed 0',
  'follows the grain',
  '3-in / 3-out',
  'girth is 3',
  'unbounded',
  'one seat remains',
  'starvation',
  '"moves"',
  'endTurn',
];

export const TEACHING_ALSO: readonly string[] = ['risk heads', '2^k'];

export const CLOSE_VS_CUT_LABELS = [
  'Close vs cut',
  'Before',
  'After close',
  'After cut',
] as const;

export const SUGGESTION_ONLY =
  'Suggestion only — you may return any ordered indices from this offer.';

/** Gherkin T1 reconstruction — dominationN matches other web tests. */
export const t1Opening = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly offer: StepMove[];
} => {
  const state = makeMatch({
    dominationN: 5,
    R: 7,
    homeOffset: 5,
    playerCount: 3,
    spawnerSeed: 1,
  });
  return { state, me: state.activePlayer, offer: offerSteps(state) };
};

export const requireStep = (move: Move, label: string): StepMove => {
  if (move.kind !== 'step') throw new Error(`setup: ${label} was not a step`);
  return move;
};

export const chooseOfferStep = (state: GameState, me: PlayerId): StepMove =>
  requireStep(chooseMove(geometry, rules, state, me), 'chooseMove');

export const offerIndexOf = (offer: readonly Move[], move: Move): number => {
  const i = offer.findIndex((entry) => movesEqual(entry, move));
  if (i < 0) throw new Error('setup: step not in this offer');
  return i;
};

export const baselineLine = (index: number, move: StepMove): string =>
  `A weak one-ply baseline would play \`[${String(index)}]\` (\`count=${String(move.count)} from=${String(move.from)} exit=${String(move.exit)}\`).`;

export const withEmptyTerritory = (state: GameState): GameState => ({
  ...state,
  territory: new Map(),
});

/** P74 budget: the teaching body before P74, in characters (git 363e7de). */
export const P74_BASELINE_CHARS = 6279;

/** Rough tokenizer (no BPE dependency in the repo): chars / 4, rounded up. */
export const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/** P74: section body under one `## ` heading, up to the next. */
export const teachingSection = (teaching: string, heading: string): string => {
  const start = teaching.indexOf(`## ${heading}\n`);
  if (start < 0) throw new Error(`setup: teaching has no ## ${heading}`);
  const next = teaching.indexOf('\n## ', start + 1);
  return next < 0 ? teaching.slice(start) : teaching.slice(start, next);
};

const ratio = (q: { readonly num: number; readonly den: number }): string =>
  `${String(q.num)}/${String(q.den)}`;

/** P74: the Gradient table rows, derived from `SPAWNER_BANDS` so the two cannot drift. */
export const bandTableRows = (): readonly string[] => {
  let lo = 0;
  return SPAWNER_BANDS.map((band) => {
    const hi = Number.isFinite(band.upTo) ? String(band.upTo) : 'R';
    const row = `| ${String(lo)}–${hi} | ${ratio(band.force)} | ${ratio(band.density)} |`;
    lo = band.upTo + 1;
    return row;
  });
};

/** P74: the message `apply` throws for a self-converting step, read from the engine. */
export const selfConvertRefusal = (): string => {
  const A = mintPlayerId('A');
  const B = mintPlayerId('B');
  const from = geometry.outArrows(geometry.seedPoint())[0];
  if (from === undefined) throw new Error('setup: tiling offered no out-arrow at its seed');
  const exit = geometry.outArrows(geometry.target(from))[0];
  if (exit === undefined) throw new Error('setup: no grain out');
  const state: GameState = {
    players: [A, B],
    activePlayer: A,
    groups: new Map([[from, { owner: A, heads: 1, spent: 0 }]]),
    trails: new Map([[A, new Set([from])]]),
    territory: new Map([[exit, B]]),
    accumulators: new Map(),
    spawners: new Map(),
    starvationStreaks: new Map(),
    dominationN: 5,
    winner: undefined,
  };
  try {
    rules.apply(state, step(from, exit, 1));
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error('setup: a stack-grade step onto enemy territory was not refused');
};

export const withTrailLen =(state: GameState, me: PlayerId, len: number): GameState => {
  const owned = [...state.territory.keys()].filter((id) => state.territory.get(id) === me);
  const others = [...state.territory.keys()].filter((id) => state.territory.get(id) !== me);
  const ids = [...owned, ...others];
  if (ids.length < len) throw new Error(`setup: need ${String(len)} arrows for trail`);
  const trails = new Map(state.trails);
  trails.set(me, new Set(ids.slice(0, len)));
  return { ...state, trails };
};
