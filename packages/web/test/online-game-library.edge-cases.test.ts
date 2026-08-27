/**
 * docs/spec/online-game-library/online-game-library.edge-cases.feature — adapter/shell.
 *
 * Sign-out clearing `/my-games` is already asserted in
 * `online-web.invariants.test.ts`. This file adds the P45 status field on the
 * listed row before sign-out so the scenario stays red until parse keeps status.
 *
 * @see docs/spec/online-game-library/online-game-library.md
 */

import { describe, expect, it } from 'vitest';
import { parseMyGames } from '../src/online-parse';
import { libraryOffered } from '../src/online-shell-ui';
import {
  ALICE,
  GAME_ONE,
  GROUP_HASH,
  apiCalls,
  gameHash,
  getGameScript,
  makeHostHarness,
  myGamesScript,
  openingBoard,
} from './online-shell.support';
import { makePagesHarness } from './online-web.support';

describe('Adapter and shell chrome', () => {
  it('Malformed status fails the library parse', () => {
    expect(
      parseMyGames({
        lobbies: [],
        games: [{ groupHash: GROUP_HASH, gameNumber: GAME_ONE, status: 'open' }],
      }),
    ).toBeUndefined();
  });

  it('Missing status fails the library parse', () => {
    expect(
      parseMyGames({
        lobbies: [],
        games: [{ groupHash: GROUP_HASH, gameNumber: GAME_ONE }],
      }),
    ).toBeUndefined();
  });

  it('Sign-out clears the library', async () => {
    const listed = { groupHash: GROUP_HASH, gameNumber: GAME_ONE, status: 'your-turn' as const };
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [myGamesScript([listed])],
    });
    await h.adapter.boot();
    await h.adapter.refreshLibrary();
    expect(h.adapter.myGames()?.games[0]?.status).toBe('your-turn');

    h.adapter.signOut();

    expect(h.adapter.myGames()).toBeUndefined();
  });

  it('Local mode does not offer My games', () => {
    expect(libraryOffered('local', true)).toBe(false);
  });

  it('Unsigned Online does not offer My games', () => {
    expect(libraryOffered('online', false)).toBe(false);
  });

  it('Finished library row still opens the game', async () => {
    const listed = { groupHash: 'G', gameNumber: GAME_ONE, status: 'won' as const };
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        myGamesScript([listed]),
        getGameScript(openingBoard(), listed.groupHash, listed.gameNumber),
      ],
    });
    await h.host.boot();
    await h.host.refreshLibrary();
    expect(h.host.adapter().myGames()?.games[0]?.status).toBe('won');

    await h.host.openMyGame(listed.groupHash, listed.gameNumber);

    expect(h.location.hash).toBe(gameHash('G', GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/G/${GAME_ONE}`)).toHaveLength(1);
  });
});
