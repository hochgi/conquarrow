/**
 * In-process MCP tool handlers over `legalMoves` / `apply`.
 */

import { endTurn } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId, StepMove } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import {
  annotateMove,
  formatLegalMoves,
  tagsFromAnnotation,
} from './annotate';
import {
  InvalidRoster,
  NoLiveMatch,
  SeatKindMismatch,
  StaleOfferIndex,
  UnknownSeat,
  wrapContract,
} from './errors';
import { chooseTurnGreedy } from './greedy';
import { observeSeat, type ToolPayload } from './observe';
import { renderBoardSvg } from './see-board';

export type SeatKind = 'human' | 'heuristic';

export type NewMatchArgs = {
  readonly playerCount: number;
  readonly seats: readonly string[];
  readonly R?: number;
  readonly homeOffset?: number;
  readonly dominationN?: number;
  readonly spawnerSeed?: number;
};

export type NewMatchResult = {
  readonly matchId: string;
  readonly observation: ToolPayload;
};

export type StepArgs = {
  readonly from: string;
  readonly exit: string;
  readonly count: number;
};

export type ApplyStepsArgs = {
  readonly seat: string;
  readonly steps?: readonly StepArgs[];
  readonly indices?: readonly number[];
};

export type LandedStep = {
  readonly from: string;
  readonly exit: string;
  readonly count: number;
  readonly tags: readonly string[];
};

export type ApplyStepsResult = {
  readonly observation: ToolPayload;
  readonly landed: readonly LandedStep[];
};

export type LegalMovesArgs = {
  readonly seat: string;
  readonly includeMills?: boolean;
};

export type PlayHeuristicResult = {
  readonly moves: readonly Move[];
  readonly observation: ToolPayload;
};

export type McpTools = {
  readonly new_match: (args: NewMatchArgs) => NewMatchResult;
  readonly observe: (args: { readonly seat: string }) => ToolPayload;
  readonly legal_moves: (args: LegalMovesArgs) => { readonly text: string };
  readonly apply_steps: (args: ApplyStepsArgs) => ApplyStepsResult;
  readonly end_turn: (args: { readonly seat: string }) => ToolPayload;
  readonly play_heuristic_turn: (args: { readonly seat: string }) => PlayHeuristicResult;
  readonly see_board: (args: { readonly seat: string }) => { readonly svg: string };
};

type OfferRow = {
  readonly index: number;
  readonly move: StepMove;
};

type LiveMatch = {
  matchId: string;
  state: GameState;
  seats: readonly SeatKind[];
  R: number;
  offers: Map<string, readonly OfferRow[]>;
};

const geometry = makeTiling();
const rules = makeRules(geometry);
const liveByTools = new WeakMap<McpTools, { live: LiveMatch | undefined; serial: number }>();

const asPlayer = (seat: string): PlayerId => seat as PlayerId;
const asArrow = (id: string): ArrowId => id as ArrowId;

const isSeatKind = (value: string): value is SeatKind =>
  value === 'human' || value === 'heuristic';

const parseRoster = (args: NewMatchArgs): readonly SeatKind[] => {
  const { playerCount, seats } = args;
  if (playerCount !== 3 && playerCount !== 6) {
    throw new InvalidRoster('playerCount must be 3 or 6');
  }
  if (seats.length !== playerCount) {
    throw new InvalidRoster('seats length must equal playerCount');
  }
  const kinds: SeatKind[] = [];
  for (const kind of seats) {
    if (!isSeatKind(kind)) throw new InvalidRoster(`kind not human|heuristic: ${kind}`);
    kinds.push(kind);
  }
  return kinds;
};

const requireLive = (box: { live: LiveMatch | undefined }): LiveMatch => {
  if (box.live === undefined) throw new NoLiveMatch();
  return box.live;
};

const requireSeat = (live: LiveMatch, seat: string): PlayerId => {
  const me = asPlayer(seat);
  if (!live.state.players.includes(me)) throw new UnknownSeat(`unknown seat ${seat}`);
  return me;
};

const kindOf = (live: LiveMatch, seat: string): SeatKind => {
  const index = live.state.players.findIndex((player) => String(player) === seat);
  const kind = live.seats[index];
  if (kind === undefined) throw new UnknownSeat(`unknown seat ${seat}`);
  return kind;
};

const refuseIfWon = (live: LiveMatch): void => {
  if (live.state.winner === undefined) return;
  try {
    rules.apply(live.state, endTurn());
  } catch (error) {
    wrapContract(error);
  }
};

const requireActiveKind = (live: LiveMatch, seat: string, expected: SeatKind): void => {
  refuseIfWon(live);
  if (String(live.state.activePlayer) !== seat || kindOf(live, seat) !== expected) {
    throw new SeatKindMismatch();
  }
};

const observe = (live: LiveMatch, seat: string): ToolPayload =>
  observeSeat(geometry, rules, live.state, seat);

const parsePrintedOffer = (
  text: string,
  moves: readonly Move[],
): readonly OfferRow[] => {
  const rows: OfferRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\[(\d+)\] step /.exec(line.trim());
    if (match?.[1] === undefined) continue;
    const index = Number(match[1]);
    const move = moves[index];
    if (move === undefined || move.kind !== 'step') continue;
    rows.push({ index, move });
  }
  return rows;
};

const resolveApplySteps = (live: LiveMatch, args: ApplyStepsArgs): readonly StepMove[] => {
  const hasSteps = args.steps !== undefined && args.steps.length > 0;
  const hasIndices = args.indices !== undefined && args.indices.length > 0;
  if (hasSteps === hasIndices) {
    throw new Error('apply_steps needs exactly one of steps or indices');
  }
  if (hasSteps) {
    return (args.steps ?? []).map((step) => ({
      kind: 'step' as const,
      from: asArrow(step.from),
      exit: asArrow(step.exit),
      count: step.count,
    }));
  }
  const offer = live.offers.get(args.seat);
  if (offer === undefined) throw new StaleOfferIndex();
  const resolved: StepMove[] = [];
  for (const index of args.indices ?? []) {
    const row = offer.find((entry) => entry.index === index);
    if (row === undefined) throw new StaleOfferIndex();
    resolved.push(row.move);
  }
  return resolved;
};

const applyStepList = (live: LiveMatch, seat: string, steps: readonly StepMove[]): ApplyStepsResult => {
  const me = asPlayer(seat);
  let next = live.state;
  const landed: LandedStep[] = [];
  for (const move of steps) {
    const tags = tagsFromAnnotation(annotateMove(geometry, rules, next, me, move));
    try {
      next = rules.apply(next, move);
    } catch (error) {
      wrapContract(error);
    }
    landed.push({
      from: String(move.from),
      exit: String(move.exit),
      count: move.count,
      tags,
    });
  }
  live.state = next;
  live.offers.delete(seat);
  return { observation: observe(live, seat), landed };
};

/**
 * Test-only seam for P38. Stamps `state.winner` so `observation.winner` is
 * not null without a domination walk. Mutation tools still refuse through the
 * engine's match-over `ContractViolation` — this is not an MCP tool.
 */
export const stampLiveWinner = (tools: McpTools, winner: string): void => {
  const box = liveByTools.get(tools);
  if (box?.live === undefined) throw new NoLiveMatch();
  box.live.state = { ...box.live.state, winner: asPlayer(winner) };
};

export const createMcpTools = (): McpTools => {
  const box: { live: LiveMatch | undefined; serial: number } = { live: undefined, serial: 0 };

  const tools: McpTools = {
    new_match: (args: NewMatchArgs): NewMatchResult => {
      const seats = parseRoster(args);
      const R = args.R ?? 7;
      const homeOffset = args.homeOffset ?? 5;
      const dominationN = args.dominationN ?? 5;
      const spawnerSeed = args.spawnerSeed ?? 1;
      const state = makeMatch({ playerCount: args.playerCount, R, homeOffset, dominationN, spawnerSeed });
      box.serial += 1;
      const matchId = `match-${String(box.serial)}`;
      box.live = { matchId, state, seats, R, offers: new Map() };
      return { matchId, observation: observe(box.live, 'A') };
    },

    observe: (args: { readonly seat: string }): ToolPayload => {
      const live = requireLive(box);
      requireSeat(live, args.seat);
      return observe(live, args.seat);
    },

    legal_moves: (args: LegalMovesArgs): { readonly text: string } => {
      const live = requireLive(box);
      requireSeat(live, args.seat);
      if (String(live.state.activePlayer) !== args.seat) return { text: '' };
      const moves = rules.legalMoves(live.state);
      let text = formatLegalMoves(moves, geometry, rules, live.state, asPlayer(args.seat));
      if (args.includeMills === false) {
        text = text
          .split('\n')
          .filter((line) => !/\btags=\S*home_mill/.test(line))
          .join('\n');
      }
      live.offers.set(args.seat, parsePrintedOffer(text, moves));
      return { text };
    },

    apply_steps: (args: ApplyStepsArgs): ApplyStepsResult => {
      const live = requireLive(box);
      requireSeat(live, args.seat);
      requireActiveKind(live, args.seat, 'human');
      const steps = resolveApplySteps(live, args);
      return applyStepList(live, args.seat, steps);
    },

    end_turn: (args: { readonly seat: string }): ToolPayload => {
      const live = requireLive(box);
      requireSeat(live, args.seat);
      requireActiveKind(live, args.seat, 'human');
      try {
        live.state = rules.apply(live.state, endTurn());
      } catch (error) {
        wrapContract(error);
      }
      live.offers.delete(args.seat);
      return observe(live, args.seat);
    },

    play_heuristic_turn: (args: { readonly seat: string }): PlayHeuristicResult => {
      const live = requireLive(box);
      requireSeat(live, args.seat);
      requireActiveKind(live, args.seat, 'heuristic');
      const me = asPlayer(args.seat);
      const moves = chooseTurnGreedy(geometry, rules, live.state, me);
      let next = live.state;
      for (const move of moves) {
        try {
          next = rules.apply(next, move);
        } catch (error) {
          wrapContract(error);
        }
      }
      live.state = next;
      live.offers.clear();
      return { moves, observation: observe(live, args.seat) };
    },

    see_board: (args: { readonly seat: string }): { readonly svg: string } => {
      const live = requireLive(box);
      requireSeat(live, args.seat);
      return { svg: renderBoardSvg(geometry, live.state, args.seat, live.R) };
    },
  };

  liveByTools.set(tools, box);
  return tools;
};
