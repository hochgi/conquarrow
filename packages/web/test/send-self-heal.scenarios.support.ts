/**
 * Probed HTTP door for the P104 sequence diagrams. The host is the component;
 * `PagesApi.send` is the leaf. The clock is a counted fake. One rig per test.
 *
 * @see docs/spec/send-self-heal/SCENARIOS.md
 */

import { createRig, type Rig } from '@hochgi/test-kit';
import { createProbedMock } from '@hochgi/test-kit-mock';
import {
  endTurn,
  GOOGLE_ID_TOKEN_SESSION_KEY,
  type InviteSeat,
  type OnlineHostPort,
  type OnlinePagesHttpResponse,
} from '@conquarrow/contracts';
import { createOnlineHost } from '../src/online-host';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  GROUP_HASH,
  aliceBobSeats,
  gameHash,
  jsonState,
  makePagesFakes,
} from './online-web.support';
import { http, once, type PagesApi, type ScenarioRig } from './session-expired.scenarios.support';

export const GAME_PATH = `/games/${GROUP_HASH}/${GAME_ONE}`;
export const MOVES_PATH = `${GAME_PATH}/moves`;
export const START_MS = 1_700_000_000_000;

export interface HealRig extends ScenarioRig {
  readonly host: OnlineHostPort;
  /** Move the injected clock forward. */
  readonly advance: (ms: number) => void;
  /** How many times the adapter read the clock. */
  readonly clockReads: () => number;
}

export const createHealRig = (options?: { readonly replayStallMs?: number }): HealRig => {
  const rig: Rig = createRig();
  const api = rig.attach(createProbedMock<PagesApi>({ harness: rig, methods: ['send'] }));
  let t = START_MS;
  let reads = 0;
  const now = (): number => {
    reads += 1;
    return t;
  };
  const fakes = makePagesFakes({
    now,
    hash: gameHash(GROUP_HASH, GAME_ONE),
    sessionToken: ALICE.bearer,
  });
  const host = createOnlineHost({
    ...fakes.deps,
    ...(options?.replayStallMs === undefined ? {} : { replayStallMs: options.replayStallMs }),
    fetch: (request) => api.adapter.send(request),
  });
  return {
    host,
    api,
    gis: fakes.gis,
    session: fakes.session,
    location: fakes.location,
    close: () => rig.close(),
    advance: (ms) => {
      t += ms;
    },
    clockReads: () => reads,
  };
};

/** A game body: version, active letter, seats (alice is A by default). */
export const board = (
  version: number,
  active = 'A',
  seats: readonly InviteSeat[] = aliceBobSeats(),
): OnlinePagesHttpResponse => http(200, { version, state: jsonState({ activePlayer: active }), seats });

export const me = (userHash: string = ALICE.userHash): OnlinePagesHttpResponse => http(200, { userHash });
export const posted = (version: number): OnlinePagesHttpResponse => http(200, { version });
export const unauthorized = http(401, { error: 'unauthorized' });

/** Seats that do not seat alice — the stale-seats case. */
export const seatsWithoutAlice = (): readonly InviteSeat[] => [
  { kind: 'human', userHash: BOB.userHash },
  { kind: 'human', userHash: CAROL.userHash },
  { kind: 'heuristic' },
];

/** Boot on the game at `version`, alice to move. */
export const bootAt = async (rig: HealRig, version: number): Promise<void> => {
  once(rig, 'GET', '/me', me());
  once(rig, 'GET', GAME_PATH, board(version));
  await rig.host.boot();
};

/**
 * The stuck hold: a submit at `version` answered 401, then the token came back
 * without a GIS credential, so `sendHeld` never ran.
 */
export const holdAt = async (rig: HealRig, version: number): Promise<void> => {
  await bootAt(rig, version);
  once(rig, 'POST', MOVES_PATH, unauthorized);
  await rig.host.submitMoves([endTurn()]);
  rig.session.setItem(GOOGLE_ID_TOKEN_SESSION_KEY, ALICE.bearer);
};

/**
 * A batch from `from` to `from + 1` queued by a wake and taken by App, never
 * reported displayed.
 */
export const stuckBatch = async (rig: HealRig, from: number): Promise<void> => {
  await bootAt(rig, from);
  rig.host.adapter().noteDisplayed(from);
  once(rig, 'GET', GAME_PATH, board(from + 1, 'B'));
  once(
    rig,
    'GET',
    `${GAME_PATH}/log`,
    http(200, { from, to: from + 1, gap: false, moves: [{ kind: 'endTurn' }] }),
  );
  await rig.host.adapter().receiveStateChanged({
    type: 'stateChanged',
    version: from + 1,
    groupHash: GROUP_HASH,
    gameNumber: GAME_ONE,
  });
  rig.host.adapter().takeReplay();
};
