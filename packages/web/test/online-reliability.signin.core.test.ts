/**
 * A credential on the lobby lists My games (D13).
 *
 * Diagram 6, alt lobby route — scripted fetch, not test-kit.
 *
 * @see docs/spec/online-reliability/online-reliability.signin.core.feature
 * @see docs/spec/online-reliability/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import { ALICE, apiCalls, makeHostHarness, myGamesScript } from './online-shell.support';
import { withLibraryIdentity } from './online-web.support';
import { GAME_ONE, GROUP_G, listedGames } from './online-reliability.signin.support';

describe('A signed-in lobby lists My games', () => {
  it('A credential on the lobby signs the shell in and lists My games', async () => {
    const listed = withLibraryIdentity({
      groupHash: GROUP_G,
      gameNumber: GAME_ONE,
      status: 'your-turn',
    });
    const h = makeHostHarness({
      fetchScript: [myGamesScript([listed])],
    });
    await h.host.boot();
    expect(h.host.signedIn()).toBe(false);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(0);

    await h.host.handleGisCredential(ALICE.bearer);

    expect(h.host.signedIn()).toBe(true);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(1);
    expect(listedGames(h)).toEqual([
      { groupHash: GROUP_G, gameNumber: GAME_ONE, status: 'your-turn' },
    ]);
    expect(h.host.adapter().myGames()?.games).toHaveLength(1);
    expect(h.host.adapter().myGames()?.games[0]).toMatchObject({
      groupHash: listed.groupHash,
      gameNumber: listed.gameNumber,
      status: listed.status,
    });
  });
});
