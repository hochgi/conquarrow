/**
 * P107 — the server's match log's record of one applied move: the event
 * resolver's facts (`resolveEvents`, the one the web animates with), projected
 * to ids and counts, then the spawner-share changes, which need the geometry
 * the resolver does not take. Pure: no clock, no randomness, ordered output.
 *
 * @see docs/spec/match-log-v2/match-log-v2.md
 */

import type { AppliedStep, ArrowId, GameEvent, GeometryPort, LogEvent, PlayerId } from '@conquarrow/contracts';
import { resolveEvents } from './events';
import { shareCountOf } from './victory';

const id = (value: ArrowId | PlayerId): string => String(value);

/** `{ [key]: String(value) }`, or nothing when the value is absent (D2: left out of the JSON). */
const optionalId = <K extends string>(
  key: K,
  value: ArrowId | PlayerId | undefined,
): { readonly [P in K]?: string } =>
  (value === undefined ? {} : { [key]: String(value) }) as { readonly [P in K]?: string };

/**
 * P107 D2: the match log's record of one resolved event — its facts with arrow
 * lists reduced to counts — or `undefined` for a presentation-only event the
 * move itself already says (`moved`, `trailLaid`, `stackSplit`, `sentryLeft`,
 * `stackMerged`).
 */
export const toLogEvent = (event: GameEvent): LogEvent | undefined => {
  switch (event.kind) {
    case 'combat':
      return {
        kind: 'combat',
        arrow: id(event.arrow),
        attacker: id(event.attacker),
        defender: id(event.defender),
        attackerSent: event.attackerSent,
        defenderBefore: event.defenderBefore,
        attackerLost: event.attackerLost,
        defenderLost: event.defenderLost,
        ...optionalId('holder', event.holder),
      };
    case 'trailCut':
      return {
        kind: 'trailCut',
        victim: id(event.victim),
        attacker: id(event.attacker),
        ...optionalId('cutArrow', event.cutArrow),
        arrowCount: event.arrows.length,
      };
    case 'enclosureClosed':
      return {
        kind: 'enclosureClosed',
        player: id(event.player),
        ...optionalId('closingArrow', event.closingArrow),
        boundaryCount: event.boundary.length,
        claimedCount: event.claimed.length,
      };
    case 'territoryCaptured':
      return {
        kind: 'territoryCaptured',
        player: id(event.player),
        arrowCount: event.arrows.length,
        takenFrom: event.takenFrom.map(id),
      };
    case 'territoryLost':
      return {
        kind: 'territoryLost',
        player: id(event.player),
        ...optionalId('to', event.to),
        arrowCount: event.arrows.length,
      };
    case 'unitsConverted':
      return { kind: 'unitsConverted', arrow: id(event.arrow), from: id(event.from), to: id(event.to), heads: event.heads };
    case 'unitsProduced':
      return { kind: 'unitsProduced', player: id(event.player), arrow: id(event.arrow), amount: event.amount };
    case 'seatVanished':
      return { kind: 'seatVanished', player: id(event.player), arrowCount: event.arrows.length };
    case 'turnPassed':
      return { kind: 'turnPassed', from: id(event.from), to: id(event.to) };
    case 'matchWon':
      return { kind: 'matchWon', player: id(event.player) };
    default:
      return undefined;
  }
};

/**
 * P107 D1: one `sharesChanged` per player whose spawner-share count
 * (`shareCountOf`) differs between `before` and `after`, in turn order (`players`).
 * Geometry-aware, which is why it is beside `resolveEvents` and not inside it.
 */
export const resolveShareEvents = (geometry: GeometryPort, step: AppliedStep): readonly LogEvent[] => {
  const { before, after } = step;
  const out: LogEvent[] = [];
  // `players` is never reordered or shrunk (GameState): `before`'s list is every seat, in turn order.
  for (const player of before.players) {
    const from = shareCountOf(before, player, geometry);
    const to = shareCountOf(after, player, geometry);
    if (from !== to) out.push({ kind: 'sharesChanged', player: id(player), from, to });
  }
  return out;
};

/**
 * P107 D2: what the server's match log records for one applied move — the
 * web's events, projected, then the share changes.
 */
export const logEventsOf = (geometry: GeometryPort, step: AppliedStep): readonly LogEvent[] => {
  const out: LogEvent[] = [];
  for (const event of resolveEvents(step)) {
    const logged = toLogEvent(event);
    if (logged !== undefined) out.push(logged);
  }
  out.push(...resolveShareEvents(geometry, step));
  return out;
};
