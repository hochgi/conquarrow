/**
 * Turn-plan search seam (P53 / P55). Adapter only — no game rule.
 *
 * `chooseTurnGreedy` is frozen greedy-v1 (today's `chooseMove` loop).
 * `chooseTurnBeam` is beam-v1 with optional one-ply opponent replies (P55).
 */

import { endTurn } from '@conquarrow/contracts';
import type {
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { evaluate, MOBILITY_SCALE } from './botEvaluate';
import {
  bindReplySearch,
  DEFAULT_REPLY_DIST_CAP,
  enterBeamSearch,
  inBeamSearch,
  leaveBeamSearch,
  REPLY_BEAM,
  REPLY_BRANCH,
  REPLY_MAX_APPLIES,
  REPLY_MAX_PLAN,
  REPLY_TURN_APPLIES,
  worstReachableReply,
  type ReplySearchFn,
} from './botReply';
import { collectFindings, DEFAULT_FINDINGS_CAPS } from './findings';
import { playLayout } from './playLayout';
import { chooseMove } from './opponent';

export type ChooseTurn = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
) => readonly Move[];

/** Optional budget for tests (spec “On exhaustion” / BSSN 8). */
export interface ChooseTurnBudget {
  readonly beam?: number;
  readonly branch?: number;
  readonly maxPlan?: number;
  readonly maxApplies?: number;
  /** Default false. Live `chooseTurnBeam` passes true (P55). */
  readonly withReplies?: boolean;
}

export const BEAM = 8;
export const BRANCH = 6;
export const MAX_PLAN = 8;
export const MAX_APPLIES = 2000;
/** Prefer a stepped plan over `[endTurn]` unless passing is better by more than this. */
export const IDLE_SLACK = MOBILITY_SCALE;
export {
  REPLY_BEAM,
  REPLY_BRANCH,
  REPLY_MAX_PLAN,
  REPLY_MAX_APPLIES,
  REPLY_TURN_APPLIES,
  MOBILITY_SCALE,
  evaluate,
};

const MAX_MOVES_PER_TURN = 64;
const UNRANKED = Number.POSITIVE_INFINITY;

export const moveKey = (move: Move): string => {
  switch (move.kind) {
    case 'step':
      return `step:${String(move.from)}>${String(move.exit)}:${String(move.count)}`;
    case 'endTurn':
      return 'endTurn';
  }
};

export const planKey = (moves: readonly Move[]): string => moves.map(moveKey).join('|');

const enemyReplySearch: ReplySearchFn = (geometry, rules, state, me, budget) =>
  chooseTurnBeamWithBudget(geometry, rules, state, me, {
    beam: budget?.beam ?? REPLY_BEAM,
    branch: budget?.branch ?? REPLY_BRANCH,
    maxPlan: budget?.maxPlan ?? REPLY_MAX_PLAN,
    maxApplies: budget?.maxApplies ?? REPLY_MAX_APPLIES,
    withReplies: false,
  });

/** Min bot-evaluate after reachable replies (P55). */
export const replyScore = (
  geometry: GeometryPort,
  rules: RulesPort,
  terminal: GameState,
  me: PlayerId,
  budget?: { readonly turnAppliesLeft: number },
): number =>
  worstReachableReply(
    geometry,
    rules,
    terminal,
    me,
    DEFAULT_REPLY_DIST_CAP,
    budget?.turnAppliesLeft ?? REPLY_TURN_APPLIES,
    enemyReplySearch,
    (state) => evaluate(geometry, state, me, rules),
  ).botScore;

/** Two `count=1` steps in the same plan that share `from` and `exit`. */
export const isShuttle = (moves: readonly Move[]): boolean => {
  const ones: StepMove[] = [];
  for (const move of moves) {
    if (move.kind === 'step' && move.count === 1) ones.push(move);
  }
  for (let i = 0; i < ones.length; i += 1) {
    const a = ones[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < ones.length; j += 1) {
      const b = ones[j];
      if (b === undefined) continue;
      if (a.from === b.from && a.exit === b.exit) return true;
    }
  }
  return false;
};

export type CompletePlan = {
  readonly moves: readonly Move[];
  readonly state: GameState;
  readonly replyScore?: number;
};

type Incomplete = CompletePlan;

type Search = {
  applies: number;
  best: CompletePlan | undefined;
  bestStepped: CompletePlan | undefined;
  readonly geometry: GeometryPort;
  rules: RulesPort;
  readonly inner: RulesPort;
  readonly me: PlayerId;
  readonly maxApplies: number;
  readonly withReplies: boolean;
  replyTurnAppliesLeft: number;
};

const APPLY_CAP = 'bot-search:apply-cap';

const capRules = (inner: RulesPort, search: Search): RulesPort => ({
  ...inner,
  apply(state, move) {
    if (search.applies >= search.maxApplies) {
      throw new Error(APPLY_CAP);
    }
    const next = inner.apply(state, move);
    search.applies += 1;
    return next;
  },
});

const completeScore = (
  geometry: GeometryPort,
  rules: RulesPort,
  me: PlayerId,
  complete: CompletePlan,
): number => {
  if (complete.replyScore !== undefined) return complete.replyScore;
  if (!inBeamSearch()) return replyScore(geometry, rules, complete.state, me);
  return evaluate(geometry, complete.state, me, rules);
};

export const pickBetterComplete = (
  geometry: GeometryPort,
  me: PlayerId,
  rules: RulesPort | undefined,
  a: CompletePlan,
  b: CompletePlan,
): CompletePlan => {
  if (rules === undefined) {
    const ea = evaluate(geometry, a.state, me, rules);
    const eb = evaluate(geometry, b.state, me, rules);
    if (ea > eb) return a;
    if (eb > ea) return b;
  } else {
    const ea = completeScore(geometry, rules, me, a);
    const eb = completeScore(geometry, rules, me, b);
    if (ea > eb) return a;
    if (eb > ea) return b;
  }
  const ka = planKey(a.moves);
  const kb = planKey(b.moves);
  return ka <= kb ? a : b;
};

const scoreWithReplies = (search: Search, child: CompletePlan): CompletePlan => {
  const terminal = child.state;
  if (!search.withReplies || terminal.winner !== undefined) {
    return {
      ...child,
      replyScore: evaluate(search.geometry, terminal, search.me, search.inner),
    };
  }
  const before = search.replyTurnAppliesLeft;
  const result = worstReachableReply(
    search.geometry,
    search.inner,
    terminal,
    search.me,
    DEFAULT_REPLY_DIST_CAP,
    search.replyTurnAppliesLeft,
    enemyReplySearch,
    (state) => evaluate(search.geometry, state, search.me, search.inner),
  );
  search.replyTurnAppliesLeft = Math.max(0, before - result.appliesUsed);
  return { ...child, replyScore: result.botScore };
};

const planHasStep = (moves: readonly Move[]): boolean =>
  moves.some((m) => m.kind === 'step');

const isIdlePlan = (moves: readonly Move[]): boolean =>
  moves.length === 1 && moves[0]?.kind === 'endTurn';

const adoptComplete = (search: Search, child: CompletePlan): void => {
  const scored = search.withReplies ? scoreWithReplies(search, child) : child;
  search.best =
    search.best === undefined
      ? scored
      : pickBetterComplete(search.geometry, search.me, search.inner, search.best, scored);
  if (planHasStep(scored.moves)) {
    search.bestStepped =
      search.bestStepped === undefined
        ? scored
        : pickBetterComplete(
            search.geometry,
            search.me,
            search.inner,
            search.bestStepped,
            scored,
          );
  }
};

const considerEnd = (search: Search, parent: Incomplete): void => {
  const after =
    search.applies < search.maxApplies
      ? search.rules.apply(parent.state, endTurn())
      : search.inner.apply(parent.state, endTurn());
  adoptComplete(search, { moves: [...parent.moves, endTurn()], state: after });
};

const findingRank = (
  findings: readonly { readonly move: StepMove }[],
  move: StepMove,
): number => {
  const i = findings.findIndex((f) => f.move.from === move.from && f.move.exit === move.exit);
  return i < 0 ? UNRANKED : i;
};

const orderSteps = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): readonly StepMove[] => {
  const findings = collectFindings(
    geometry,
    rules,
    state,
    me,
    DEFAULT_FINDINGS_CAPS,
    playLayout,
  );
  const steps = rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');
  return steps.toSorted((a, b) => {
    const ra = findingRank(findings, a);
    const rb = findingRank(findings, b);
    if (ra !== rb) return ra < rb ? -1 : ra > rb ? 1 : 0;
    if (a.count !== b.count) return a.count > b.count ? -1 : a.count < b.count ? 1 : 0;
    const ka = moveKey(a);
    const kb = moveKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
};

const rankIncompletes = (search: Search, plans: readonly Incomplete[]): Incomplete[] => {
  const scored = plans.map((plan) => ({
    plan,
    score: evaluate(search.geometry, plan.state, search.me, search.rules),
    key: planKey(plan.moves),
  }));
  return scored
    .toSorted((a, b) => {
      if (a.score !== b.score) return a.score > b.score ? -1 : a.score < b.score ? 1 : 0;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .map((row) => row.plan);
};

const exitKey = (move: StepMove): string =>
  `${String(move.from)}>${String(move.exit)}`;

const selectBranch = (sorted: readonly StepMove[], branch: number): StepMove[] => {
  const picked: StepMove[] = [];
  const pickedKey = new Set<string>();
  const remember = (move: StepMove): boolean => {
    const key = moveKey(move);
    if (pickedKey.has(key)) return false;
    pickedKey.add(key);
    picked.push(move);
    return picked.length >= branch;
  };
  const seenExit = new Set<string>();
  for (const move of sorted) {
    const exit = exitKey(move);
    if (seenExit.has(exit)) continue;
    seenExit.add(exit);
    if (remember(move)) return picked;
  }
  for (const move of sorted) {
    if (move.count !== 2) continue;
    if (remember(move)) return picked;
  }
  for (const move of sorted) {
    if (remember(move)) return picked;
  }
  return picked;
};

const isExtendable = (plan: Incomplete, me: PlayerId, maxPlan: number): boolean =>
  plan.moves.length < maxPlan &&
  plan.state.activePlayer === me &&
  plan.state.winner === undefined;

const expandBeam = (
  search: Search,
  extendable: readonly Incomplete[],
  branch: number,
  maxPlan: number,
): Incomplete[] => {
  const next: Incomplete[] = [];
  for (const parent of extendable) {
    if (parent.moves.length === maxPlan - 1) {
      considerEnd(search, parent);
      continue;
    }
    if (search.applies >= search.maxApplies) break;
    const steps = selectBranch(
      orderSteps(search.geometry, search.rules, parent.state, search.me),
      branch,
    );
    let hitCap = false;
    for (const stepMove of steps) {
      if (search.applies >= search.maxApplies) {
        hitCap = true;
        break;
      }
      let after: GameState;
      try {
        after = search.rules.apply(parent.state, stepMove);
      } catch (err) {
        if (err instanceof Error && err.message === APPLY_CAP) {
          hitCap = true;
          break;
        }
        throw err;
      }
      const child: Incomplete = { moves: [...parent.moves, stepMove], state: after };
      if (after.activePlayer !== search.me || after.winner !== undefined) {
        adoptComplete(search, child);
      } else {
        next.push(child);
        if (search.withReplies && isExtendable(child, search.me, maxPlan)) {
          considerEnd(search, child);
        }
      }
    }
    if (hitCap) break;
    considerEnd(search, parent);
    if (search.applies >= search.maxApplies) break;
  }
  return next;
};

/** greedy-v1 — today's `chooseMove` loop behind `ChooseTurn`. */
export const chooseTurnGreedy: ChooseTurn = (geometry, rules, state, me) => {
  if (state.activePlayer !== me || state.winner !== undefined) return [];
  const moves: Move[] = [];
  let at = state;
  for (let i = 0; i < MAX_MOVES_PER_TURN; i += 1) {
    if (at.winner !== undefined || at.activePlayer !== me) break;
    const move = chooseMove(geometry, rules, at, me);
    at = rules.apply(at, move);
    moves.push(move);
  }
  if (at.winner === undefined && at.activePlayer === me) {
    const forced = endTurn();
    at = rules.apply(at, forced);
    moves.push(forced);
  }
  return moves;
};

export const chooseTurnBeamWithBudget: (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  budget?: ChooseTurnBudget,
) => readonly Move[] = (geometry, rules, state, me, budget) => {
  if (state.activePlayer !== me || state.winner !== undefined) return [];
  enterBeamSearch();
  try {
  const beamWidth = budget?.beam ?? BEAM;
  const branch = budget?.branch ?? BRANCH;
  const maxPlan = budget?.maxPlan ?? MAX_PLAN;
  const maxApplies = budget?.maxApplies ?? MAX_APPLIES;
  const withReplies = budget?.withReplies ?? false;
  const seed: Incomplete = { moves: [], state };
  const search: Search = {
    applies: 0,
    best: undefined,
    bestStepped: undefined,
    geometry,
    rules,
    inner: rules,
    me,
    maxApplies,
    withReplies,
    replyTurnAppliesLeft: REPLY_TURN_APPLIES,
  };
  search.rules = capRules(rules, search);
  let beam: Incomplete[] = [seed];
  for (;;) {
    const extendable = beam.filter((plan) => isExtendable(plan, me, maxPlan));
    if (extendable.length === 0) break;
    const next = expandBeam(search, extendable, branch, maxPlan);
    if (next.length === 0) break;
    beam = rankIncompletes(search, next).slice(0, beamWidth);
  }
  if (search.best === undefined) {
    const fallback = rankIncompletes(search, beam)[0] ?? seed;
    considerEnd(search, fallback);
  }
  const best = search.best;
  const stepped = search.bestStepped;
  if (
    best !== undefined &&
    stepped !== undefined &&
    isIdlePlan(best.moves) &&
    completeScore(geometry, search.inner, me, best) -
      completeScore(geometry, search.inner, me, stepped) <=
      IDLE_SLACK
  ) {
    return stepped.moves;
  }
  return best?.moves ?? [endTurn()];
  } finally {
    leaveBeamSearch();
  }
};

export const chooseTurnBeam: ChooseTurn = (geometry, rules, state, me) =>
  chooseTurnBeamWithBudget(geometry, rules, state, me, { withReplies: true });

bindReplySearch(enemyReplySearch);
