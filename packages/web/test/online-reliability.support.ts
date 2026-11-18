/**
 * Fixtures for the P95 web suite (online-reliability). Builds on the P94 and
 * P49 fakes: the same scripted fetch, socket, session and location.
 *
 * @see docs/spec/online-reliability/online-reliability.md
 */

import type { OnlinePagesDeps, OnlinePagesHttpRequest } from '@conquarrow/contracts';
import { createOnlinePages } from '../src/online-pages';
import { snapshotScript } from './online-move-log-replay.support';
import { GAME_PATH, MOVES_PATH } from './online-turn-flow.support';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  GROUP_HASH,
  apiCalls,
  gameHash,
  makePagesFakes,
  parseJson,
  tokenExpiringAt,
  type FetchSpy,
  type PagesHarness,
  type ScriptedFetch,
} from './online-web.support';

export { tokenExpiringAt };

export const VERSION_PATH = `/games/${GROUP_HASH}/${GAME_ONE}/version`;

/** `GET …/version` answered with `version` (P95 D5). */
export const versionScript = (version: number): ScriptedFetch => ({
  method: 'GET',
  path: VERSION_PATH,
  status: 200,
  body: { version, activePlayer: 'A' },
});

export const myGamesScript = (): ScriptedFetch => ({
  method: 'GET',
  path: '/my-games',
  status: 200,
  body: { lobbies: [], games: [] },
});

/** The submit ids, in POST order. */
export const submitIdsOf = (h: FetchSpy): readonly unknown[] =>
  apiCalls(h, 'POST', MOVES_PATH).map(
    (req: OnlinePagesHttpRequest) =>
      (parseJson(req.body) as Record<string, unknown> | undefined)?.['submitId'],
  );

export const versionReads = (h: FetchSpy): number => apiCalls(h, 'GET', VERSION_PATH).length;
export const snapshotReadsOf = (h: FetchSpy): number => apiCalls(h, 'GET', GAME_PATH).length;

const KNOWN_BEARERS = new Set([ALICE.bearer, BOB.bearer, CAROL.bearer]);

/** A custom JWT is not in the Alice/Bob/Carol map, so boot's `loadMe` would 401. */
const needsScriptedMe = (token: string): boolean =>
  !KNOWN_BEARERS.has(token) && token.split('.').length === 3;

const meOk = (): ScriptedFetch => ({
  method: 'GET',
  path: '/me',
  status: 200,
  body: { userHash: ALICE.userHash },
});

/**
 * A's client in the open game at `baseline`, with `extra` deps (the clock, the
 * id source) injected the way the browser runtime would.
 */
export const showingWith = async (
  baseline: number,
  fetchScript: readonly ScriptedFetch[],
  extra: Partial<Pick<OnlinePagesDeps, 'newId' | 'wait' | 'now'>> = {},
  sessionToken: string = ALICE.bearer,
): Promise<PagesHarness> => {
  const fakes = makePagesFakes({
    hash: gameHash(GROUP_HASH, GAME_ONE),
    sessionToken,
    fetchScript: [
      ...(needsScriptedMe(sessionToken) ? [meOk()] : []),
      snapshotScript(baseline),
      ...fetchScript,
    ],
  });
  const adapter = createOnlinePages({ ...fakes.deps, ...extra });
  await adapter.boot();
  adapter.noteDisplayed(baseline);
  return { ...fakes, adapter };
};

/** Sequential submit ids `id-1`, `id-2`, … */
export const sequentialIds = (): (() => string) => {
  let n = 0;
  return () => {
    n += 1;
    return `id-${String(n)}`;
  };
};
