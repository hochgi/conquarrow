/**
 * docs/spec/online-game-library/online-game-library.core.feature — shell scenarios.
 *
 * @see docs/spec/online-game-library/online-game-library.md
 */

import { describe, expect, it } from 'vitest';
import {
  formatLibraryRow,
  libraryOffered,
  libraryStatusLabel,
  MY_GAMES_COPY,
  NO_GAMES_COPY,
} from '../src/online-shell-ui';
import {
  ALICE,
  GAME_ONE,
  apiCalls,
  gameHash,
  getGameScript,
  makeHostHarness,
  myGamesScript,
  openingBoard,
} from './online-shell.support';

describe('Shell list', () => {
  it('Signed-in Online offers My games with status labels', async () => {
    const listed = { groupHash: 'G', gameNumber: GAME_ONE, status: 'your-turn' as const };
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [myGamesScript([listed])],
    });
    await h.host.boot();
    h.host.selectMode('online');
    await h.host.refreshLibrary();

    expect(libraryOffered('online', true)).toBe(true);
    expect(MY_GAMES_COPY).toBe('My games');
    expect(libraryStatusLabel('your-turn')).toBe('Open (your turn)');
    expect(formatLibraryRow('your-turn', GAME_ONE)).toBe('Open (your turn) · 000001');
    expect(h.host.adapter().myGames()?.games[0]?.status).toBe('your-turn');
  });

  it('Opening a library row still resumes the game hash', async () => {
    const listed = { groupHash: 'G', gameNumber: GAME_ONE, status: 'waiting' as const };
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        myGamesScript([listed]),
        getGameScript(openingBoard(), listed.groupHash, listed.gameNumber),
      ],
    });
    await h.host.boot();
    await h.host.refreshLibrary();
    expect(h.host.adapter().myGames()?.games[0]?.status).toBe('waiting');

    await h.host.openMyGame(listed.groupHash, listed.gameNumber);

    expect(h.location.hash).toBe(gameHash('G', GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/G/${GAME_ONE}`)).toHaveLength(1);
  });

  it('Empty library uses the empty copy', () => {
    expect(NO_GAMES_COPY).toBe('No games yet');
  });
});
