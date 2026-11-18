/**
 * Probed HTTP door for the P98 sequence diagrams. The host is the component.
 * `PagesApi.send` is the leaf. GIS `prompt` is synchronous, so the kit cannot
 * probe it; the counting fake stays. One rig per test.
 *
 * @see docs/spec/session-expired/SCENARIOS.md
 */

import { createRig, type Rig } from '@hochgi/test-kit';
import { createProbedMock, type ProbedMock } from '@hochgi/test-kit-mock';
import {
  type OnlineHostPort,
  type OnlinePagesHttpRequest,
  type OnlinePagesHttpResponse,
  type OnlinePagesLocation,
  type PlannedSeatKind,
} from '@conquarrow/contracts';
import { createOnlineHost } from '../src/online-host';
import {
  ACCEPT_PATH,
  credentialToken,
  expiredToken,
  FROZEN_NOW,
  frozenNow,
  GAME_PATH,
  hourToken,
  INVITE_GET,
  minuteToken,
  START_PATH,
  TWO_PLAYERS,
  waitingSeats,
} from './session-expired.support';
import {
  DEFAULT_ENV,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  aliceHostSeats,
  gameHash,
  inviteHash,
  makePagesFakes,
  openingBoard,
  pathOf,
  type HarnessGis,
  type HarnessSession,
} from './online-web.support';

/** The injected fetch, as a Promise method the kit can probe. */
export interface PagesApi {
  send(request: OnlinePagesHttpRequest): Promise<OnlinePagesHttpResponse>;
}

export interface ScenarioRig {
  readonly host: OnlineHostPort;
  readonly api: ProbedMock<PagesApi>;
  readonly gis: HarnessGis;
  readonly session: HarnessSession;
  readonly location: OnlinePagesLocation;
  readonly close: () => Promise<void>;
}

export const createScenarioRig = (options?: {
  readonly sessionToken?: string;
  readonly hash?: string;
  readonly now?: () => number;
}): ScenarioRig => {
  const rig: Rig = createRig();
  const api = rig.attach(
    createProbedMock<PagesApi>({ harness: rig, methods: ['send'] }),
  );
  const fakes = makePagesFakes({
    now: options?.now ?? frozenNow,
    ...(options?.hash === undefined ? {} : { hash: options.hash }),
    ...(options?.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
  });
  const host = createOnlineHost({
    ...fakes.deps,
    fetch: (request) => api.adapter.send(request),
  });
  return {
    host,
    api,
    gis: fakes.gis,
    session: fakes.session,
    location: fakes.location,
    close: () => rig.close(),
  };
};

const requestOf = (args: readonly unknown[]): OnlinePagesHttpRequest => {
  const request = args[0];
  if (request === undefined || typeof request !== 'object') {
    throw new Error('PagesApi.send was called without a request');
  }
  return request as OnlinePagesHttpRequest;
};

export const http = (
  status: number,
  body: unknown,
): OnlinePagesHttpResponse => ({
  status,
  body: JSON.stringify(body),
});

/** One shot for this method and path. Register before the When, in call order. */
export const once = (
  rig: ScenarioRig,
  method: 'GET' | 'POST',
  path: string,
  response: OnlinePagesHttpResponse,
): void => {
  rig.api.probe
    .on('send')
    .filter((call) => {
      const request = requestOf(call.args);
      return request.method === method && pathOf(request.url, DEFAULT_ENV.VITE_API_BASE) === path;
    }, `${method} ${path}`)
    .once()
    .answer(response);
};

export const onceThrow = (rig: ScenarioRig, method: 'GET' | 'POST', path: string): void => {
  rig.api.probe
    .on('send')
    .filter((call) => {
      const request = requestOf(call.args);
      return request.method === method && pathOf(request.url, DEFAULT_ENV.VITE_API_BASE) === path;
    }, `${method} ${path} throws`)
    .once()
    .reject(new Error('network down'));
};

export const sent = (rig: ScenarioRig): readonly OnlinePagesHttpRequest[] =>
  rig.api.probe.on('send').calls.map((call) => requestOf(call.args));

export const sentPaths = (rig: ScenarioRig): readonly string[] =>
  sent(rig).map(
    (request) => `${request.method} ${pathOf(request.url, DEFAULT_ENV.VITE_API_BASE)}`,
  );

export const bearerOf = (request: OnlinePagesHttpRequest | undefined): string | undefined => {
  const header = request?.headers['Authorization'];
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : undefined;
};

export const jsonBody = (request: OnlinePagesHttpRequest | undefined): unknown =>
  request?.body === undefined ? undefined : (JSON.parse(request.body) as unknown);

/** Recorded sends for one method and path, in call order. */
export const byPath = (
  rig: ScenarioRig,
  method: 'GET' | 'POST',
  path: string,
): readonly OnlinePagesHttpRequest[] =>
  sent(rig).filter(
    (request) =>
      request.method === method && pathOf(request.url, DEFAULT_ENV.VITE_API_BASE) === path,
  );

export const meOk = http(200, { userHash: 'alice-user-hash' });
export const emptyGames = http(200, { lobbies: [], games: [] });
export const unauthorized = http(401, { error: 'unauthorized' });
export const created = http(201, { token: INVITE_TOKEN, seats: aliceHostSeats() });
export const gameOk = http(200, openingBoard('scenario'));

export const armLobbyCreate = (rig: ScenarioRig, plan: readonly PlannedSeatKind[] = TWO_PLAYERS): void => {
  rig.host.selectMode('online');
  rig.host.setSeatPlan(plan);
  rig.host.adapter().setInviteName('Friday');
};

export {
  ACCEPT_PATH,
  FROZEN_NOW,
  GAME_ONE,
  GAME_PATH,
  GROUP_HASH,
  INVITE_GET,
  INVITE_TOKEN,
  START_PATH,
  credentialToken,
  expiredToken,
  gameHash,
  hourToken,
  inviteHash,
  minuteToken,
  waitingSeats,
};
