/**
 * P108 — the door's `OfferAbout`: the seat table from the invite's chairs and
 * the profile names, and the recent lines from `log.jsonl`. The builder in
 * `@conquarrow/byok-offer` renders it, exactly as for a BYOK seat.
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 */

import type { InviteSeat } from '@conquarrow/contracts';
import { chairUserHash, seatLabel, seatLetter } from '@conquarrow/contracts';
import type { OfferAbout, OfferRelation, OfferSeat, RecentLine } from '@conquarrow/byok-offer';
import type { ObjectStore } from './api-types';
import { parseLogLine } from './game-log';
import { gameLogKey } from './s3-keys';
import { getObject } from './store-io';
import { readProfileDisplayName } from './user-profile';

/** D1: `you`, `also you` (another chair of the same agent) or `your owner`. */
const relationOf = (
  seat: InviteSeat,
  index: number,
  meIndex: number,
  agentUser: string | undefined,
): OfferRelation | undefined => {
  if (index === meIndex) return 'you';
  if (agentUser === undefined || chairUserHash(seat) !== agentUser) return undefined;
  return seat.kind === 'agent' ? 'also you' : 'your owner';
};

/**
 * D1: one row per chair in seat (= turn) order. `names` maps a user hash to
 * its profile display name; the wording is P105's, with no caller view.
 */
export const offerSeatsOf = (
  seats: readonly InviteSeat[],
  players: readonly string[],
  meIndex: number,
  names: ReadonlyMap<string, string>,
): OfferSeat[] => {
  const agentUser = seats[meIndex] === undefined ? undefined : chairUserHash(seats[meIndex]);
  return seats.map((seat, index) => {
    const hash = chairUserHash(seat);
    const player = players[index] ?? seatLetter(index);
    const name = seatLabel({
      letter: player,
      kind: seat.kind,
      relation: 'other',
      ownerName: hash === undefined ? undefined : names.get(hash),
    });
    const relation = relationOf(seat, index, meIndex, agentUser);
    return { player, kind: seat.kind, name, ...(relation === undefined ? {} : { relation }) };
  });
};

/** D3: every P107 move line (one with a seat and events), in order; older lines are skipped. */
export const recentOfLog = (raw: string | undefined): RecentLine[] => {
  const out: RecentLine[] = [];
  for (const text of (raw ?? '').split('\n')) {
    const line = text === '' ? undefined : parseLogLine(text);
    if (line?.seat === undefined || line.events === undefined) continue;
    out.push({ seat: line.seat, move: line.move, events: line.events });
  }
  return out;
};

/** The about for the agent on chair `meIndex`: profile names read once per user, then the log. */
export const readOfferAbout = async (
  store: ObjectStore,
  located: { readonly groupHash: string; readonly gameNumber: string },
  seats: readonly InviteSeat[],
  players: readonly string[],
  meIndex: number,
): Promise<OfferAbout> => {
  const names = new Map<string, string>();
  for (const seat of seats) {
    const hash = chairUserHash(seat);
    if (hash === undefined || names.has(hash)) continue;
    const name = await readProfileDisplayName(store, hash);
    if (name !== undefined) names.set(hash, name);
  }
  const raw = await getObject(store, gameLogKey(located.groupHash, located.gameNumber));
  return { seats: offerSeatsOf(seats, players, meIndex, names), recent: recentOfLog(raw) };
};
