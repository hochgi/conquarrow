/**
 * Host harness for the P25 Pages online shell suite.
 *
 * Reuses P19 GIS / fetch / WebSocket / session fakes. Tests drive
 * `createOnlineHost` — no jsdom, no React Testing Library.
 */

import type {
  OnlineHostPort,
  OnlinePagesEnv,
  StateChangedPayload,
} from '@conquarrow/contracts';
import { createOnlineHost } from '../src/online-host';
import {
  GAME_ONE,
  GROUP_HASH,
  makePagesFakes,
  type PagesFakes,
  type ScriptedFetch,
} from './online-web.support';

export type HostHarness = PagesFakes & {
  readonly host: OnlineHostPort;
};

export const makeHostHarness = (overrides?: {
  readonly env?: Partial<OnlinePagesEnv>;
  readonly hash?: string;
  readonly sessionToken?: string;
  readonly fetchScript?: readonly ScriptedFetch[];
  /** Epoch ms, threaded onto `OnlinePagesDeps.now`. GIS prompt counts live on `gis`. */
  readonly now?: () => number;
}): HostHarness => {
  const fakes = makePagesFakes(overrides);
  return { ...fakes, host: createOnlineHost(fakes.deps) };
};

export const stateChangedJson = (
  version: number,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): string =>
  JSON.stringify({
    type: 'stateChanged',
    version,
    groupHash,
    gameNumber,
  } satisfies StateChangedPayload);

export {
  ALICE,
  BOB,
  CAROL,
  DEFAULT_ENV,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  ONE_HUMAN_TWO_HEURISTIC,
  OTHER_GROUP_HASH,
  PAGES_ORIGIN,
  PAGES_PATHNAME,
  THREE_HEURISTIC,
  TWO_HUMAN_HEURISTIC,
  acceptInviteEmpty410Script,
  acceptInviteScript,
  accessTokenOf,
  aliceBobSeats,
  aliceHostSeats,
  apiCalled,
  apiCalls,
  bearerOf,
  boardAt,
  createdInviteBody,
  createInviteScript,
  hungCreateInvite,
  fullHumanSeats,
  gameHash,
  getGameScript,
  goneInviteEmptyBodyScript,
  goneInviteStartedScript,
  humanBoundCount,
  ifMatchOf,
  inviteHash,
  jsonState,
  myGamesScript,
  openingBoard,
  parseJson,
  peekInviteScript,
  postMoveScript,
  quotedVersion,
  startGameScript,
} from './online-web.support';
