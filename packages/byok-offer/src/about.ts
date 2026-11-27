/**
 * P108 — what an offer is told besides the state: the seat table and the
 * recent history, and how the builder renders them. Pure; the door and the
 * BYOK seat build the input, this module renders it, so both give a model the
 * same text.
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 */

import type { GameState, GeometryPort, LogEvent, Move, PlayerId } from '@conquarrow/contracts';
import { logEventsOf, makeRules } from '@conquarrow/rules-core';

export type OfferSeatKind = 'human' | 'agent' | 'heuristic';
export type OfferRelation = 'you' | 'also you' | 'your owner';

/** D1: one seat, in turn order. */
export interface OfferSeat {
  readonly player: string;
  readonly kind: OfferSeatKind;
  readonly name: string;
  readonly relation?: OfferRelation;
}

/** D3: one applied move, the seat whose turn it was, and its P107 log events. */
export interface RecentLine {
  readonly seat: string;
  readonly move: Move;
  readonly events: readonly LogEvent[];
}

/** What the caller knows besides the state. An absent field leaves its block out. */
export interface OfferAbout {
  readonly seats?: readonly OfferSeat[];
  readonly recent?: readonly RecentLine[];
}

/** D1: a name is one line of at most this many characters. */
export const SEAT_NAME_CAP = 40;
/** D3: printed events per run before `… +k more`. A presentation cap, not balance. */
export const RUN_EVENT_CAP = 12;

const oneLine = (name: string): string => name.replace(/[\r\n]+/g, ' ').trim().slice(0, SEAT_NAME_CAP);

/** D1: `Seats in turn order:` then one row per seat. */
export const seatTableLines = (seats: readonly OfferSeat[]): readonly string[] => [
  'Seats in turn order:',
  ...seats.map(
    (seat) =>
      `${seat.player} ${seat.kind} ${oneLine(seat.name)}${seat.relation === undefined ? '' : ` (${seat.relation})`}`,
  ),
];

/** D2: the starvation clock, read from the state. */
export const starvationLine = (state: GameState): string => {
  const streaks = state.players
    .map((player) => `${String(player)} ${String(state.starvationStreaks.get(player) ?? 0)}`)
    .join(', ');
  return `Starvation: a living seat with no spawner share loses after dominationN=${String(state.dominationN)} full rounds in a row. Streaks: ${streaks}.`;
};

/** A seat and a move: all `recentWindow` needs to cut turns. */
interface SeatMove {
  readonly seat: string;
  readonly move: Move;
}

/**
 * D3: the index the window starts at: the start of `me`'s last completed run
 * (a run ending in `endTurn`), else 0.
 */
export const windowStart = (lines: readonly SeatMove[], me: string): number => {
  let start = 0;
  let runStart = 0;
  for (const [index, line] of lines.entries()) {
    if (lines[index - 1]?.seat !== line.seat) runStart = index;
    if (line.seat === me && line.move.kind === 'endTurn') start = runStart;
  }
  return start;
};

/** D3: every line from the start of `me`'s last completed run to the end. */
export const recentWindow = <L extends SeatMove>(lines: readonly L[], me: string): readonly L[] =>
  lines.slice(windowStart(lines, me));

const optional = (prefix: string, value: string | undefined): string =>
  value === undefined ? '' : `${prefix}${value}`;

/** D3: one log event as text; `null` for `turnPassed`, which every completed run ends with. */
export const eventText = (event: LogEvent): string | null => {
  switch (event.kind) {
    case 'combat':
      return `combat at ${event.arrow}: ${event.attacker} sent ${String(event.attackerSent)} vs ${event.defender} ${String(event.defenderBefore)}, ${event.attacker} lost ${String(event.attackerLost)}, ${event.defender} lost ${String(event.defenderLost)}, ${event.holder === undefined ? 'nobody holds' : `${event.holder} holds`}`;
    case 'trailCut':
      return `${event.attacker} cut ${event.victim}'s trail${optional(' at ', event.cutArrow)} (${String(event.arrowCount)} arrows)`;
    case 'enclosureClosed':
      return `${event.player} closed a loop${optional(' at ', event.closingArrow)} (${String(event.claimedCount)} claimed)`;
    case 'territoryCaptured':
      return `${event.player} took ${String(event.arrowCount)} territory from ${event.takenFrom.join(', ')}`;
    case 'territoryLost':
      return `${event.player} lost ${String(event.arrowCount)} territory${optional(' to ', event.to)}`;
    case 'unitsConverted':
      return `${String(event.heads)} heads at ${event.arrow} converted ${event.from}→${event.to}`;
    case 'unitsProduced':
      return `${event.player} +${String(event.amount)} heads at ${event.arrow} (spawner)`;
    case 'seatVanished':
      return `${event.player} is out`;
    case 'sharesChanged':
      return `${event.player} shares ${String(event.from)}→${String(event.to)}`;
    case 'matchWon':
      return `${event.player} won`;
    default:
      return null;
  }
};

const runLine = (seat: string, lines: readonly RecentLine[]): string => {
  const steps = lines.filter((line) => line.move.kind === 'step').length;
  const texts: string[] = [];
  for (const line of lines) {
    for (const event of line.events) {
      const text = eventText(event);
      if (text !== null) texts.push(text);
    }
  }
  const shown = texts.slice(0, RUN_EVENT_CAP);
  const more = texts.length - shown.length;
  const body = shown.length === 0 ? 'nothing' : shown.join('; ') + (more > 0 ? `; … +${String(more)} more` : '');
  return `${seat}, ${String(steps)} steps: ${body}`;
};

/** D3: the history block for `me`, from every recent line the caller has. */
export const recentBlockLines = (recent: readonly RecentLine[], me: string): readonly string[] => {
  const window = recentWindow(recent, me);
  if (window.length === 0) return ['Since your last turn: nothing recorded yet.'];
  const runs: { readonly seat: string; readonly lines: RecentLine[] }[] = [];
  for (const line of window) {
    const last = runs[runs.length - 1];
    if (last?.seat === line.seat) last.lines.push(line);
    else runs.push({ seat: line.seat, lines: [line] });
  }
  return [`Since your last turn (oldest first; ${me} is you):`, ...runs.map((run) => runLine(run.seat, run.lines))];
};

/** Every move's recent line from `start`, in order (seat = the mover, events = `logEventsOf`). */
export const recentLinesOf = (
  geometry: GeometryPort,
  start: GameState,
  moves: readonly Move[],
): RecentLine[] => {
  const rules = makeRules(geometry);
  const out: RecentLine[] = [];
  let at = start;
  for (const move of moves) {
    const after = rules.apply(at, move);
    out.push({ seat: String(at.activePlayer), move, events: logEventsOf(geometry, { before: at, after, move }) });
    at = after;
  }
  return out;
};

/**
 * D3 (BYOK): the window for `me` from a local match log. One pass applies every
 * move and keeps the state at the start of `me`'s last completed run; events
 * are computed for the window's moves only.
 */
export const recentFromMoves = (
  geometry: GeometryPort,
  opening: GameState,
  moves: readonly Move[],
  me: PlayerId,
): RecentLine[] => {
  const rules = makeRules(geometry);
  let start = { index: 0, state: opening };
  let run = start;
  let at = opening;
  for (const [index, move] of moves.entries()) {
    const seat = at.activePlayer;
    if (seat !== run.state.activePlayer) run = { index, state: at };
    if (seat === me && move.kind === 'endTurn') start = run;
    at = rules.apply(at, move);
  }
  return recentLinesOf(geometry, start.state, moves.slice(start.index));
};

/** D1 + D2: the lines after the offer's first line. */
export const aboutHeadLines = (state: GameState, about: OfferAbout | undefined): readonly string[] => [
  ...(about?.seats === undefined ? [] : seatTableLines(about.seats)),
  starvationLine(state),
];

/** D3: the history block, or nothing when the caller has no history. */
export const aboutHistoryLines = (about: OfferAbout | undefined, me: string): readonly string[] =>
  about?.recent === undefined ? [] : recentBlockLines(about.recent, me);
