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

/**
 * D1: `you`, `also you` (another chair of the same agent) or `your owner`.
 * `agentUser` is the caller's user hash, so a chair nobody is bound to (no
 * hash) never matches it.
 */
const relationOf = (
  seat: InviteSeat,
  index: number,
  meIndex: number,
  agentUser: string,
): OfferRelation | undefined => {
  if (index === meIndex) return 'you';
  if (chairUserHash(seat) !== agentUser) return undefined;
  return seat.kind === 'agent' ? 'also you' : 'your owner';
};

/**
 * D1: one row per chair in seat (= turn) order, lettered as everywhere else
 * (`seatLetter`). `names` maps a bound user's hash to its profile display name, if any; the
 * wording is P105's, with no caller view.
 */
export const offerSeatsOf = (
  seats: readonly InviteSeat[],
  meIndex: number,
  agentUser: string,
  names: ReadonlyMap<string | undefined, string | undefined>,
): OfferSeat[] =>
  seats.map((seat, index) => {
    const player = seatLetter(index);
    const name = seatLabel({ letter: player, kind: seat.kind, relation: 'other', ownerName: names.get(chairUserHash(seat)) });
    const relation = relationOf(seat, index, meIndex, agentUser);
    return { player, kind: seat.kind, name, ...(relation === undefined ? {} : { relation }) };
  });

/** D3: every P107 move line (one with a seat and events), in order; older lines are skipped. */
export const recentOfLog = (raw: string | undefined): RecentLine[] => {
  const out: RecentLine[] = [];
  for (const text of (raw ?? '').split('\n')) {
    const line = parseLogLine(text);
    if (line?.seat === undefined || line.events === undefined) continue;
    out.push({ seat: line.seat, move: line.move, events: line.events });
  }
  return out;
};

/** The about for the caller's agent on chair `meIndex`: each bound user's profile name, then the log. */
export const readOfferAbout = async (
  store: ObjectStore,
  located: { readonly groupHash: string; readonly gameNumber: string },
  seats: readonly InviteSeat[],
  meIndex: number,
  agentUser: string,
): Promise<OfferAbout> => {
  const names = new Map<string | undefined, string | undefined>();
  for (const hash of new Set(seats.flatMap((seat) => chairUserHash(seat) ?? []))) {
    names.set(hash, await readProfileDisplayName(store, hash));
  }
  const raw = await getObject(store, gameLogKey(located.groupHash, located.gameNumber));
  return { seats: offerSeatsOf(seats, meIndex, agentUser, names), recent: recentOfLog(raw) };
};
