/**
 * docs/spec/online-game-library/online-game-library.core.feature — API scenarios.
 *
 * @see docs/spec/online-game-library/online-game-library.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { parsePersistedEnvelope } from '../src/game-snapshot';
import {
  gameMetaRecord,
  libraryRowOf,
  lostPlayerIdsOf,
  writeStateEnvelope,
} from './game-library.support';
import {
  ALICE,
  BOB,
  GAME_ONE,
  aliceBobGroupHash,
  authorWinningWrapState,
  expectStatus,
  gameLogKey,
  gameMetaKey,
  gameStateKey,
  getGame,
  getMyGames,
  libraryGamesOf,
  makeHarness,
  openingMatch,
  parseBody,
  persistEnvelope,
  postMove,
  seatSummaries,
  startAliceBob,
  startBobAliceHeuristic,
} from './support';

const listedStatus = async (
  api: ReturnType<typeof makeHarness>['api'],
  bearer: string,
  groupHash: string,
): Promise<string | undefined> => {
  const lib = libraryGamesOf(parseBody(expectStatus(await getMyGames(api, bearer), 200)));
  return libraryRowOf(lib.games, groupHash, GAME_ONE).status;
};

describe('Caller-relative status', () => {
  it('Active human sees your-turn and the other human sees waiting', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('your-turn');
    expect(await listedStatus(api, BOB.bearer, groupHash)).toBe('waiting');
  });

  it('Winner sees won and the other human sees lost', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const opening = openingMatch(3);
    const winner = opening.players[0];
    if (winner === undefined) throw new Error('setup: makeMatch has no players');
    writeStateEnvelope(s3, groupHash, GAME_ONE, { ...opening, winner });

    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('won');
    expect(await listedStatus(api, BOB.bearer, groupHash)).toBe('lost');
  });

  it('Start before first GET is waiting for both humans', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expect(s3.has(gameStateKey(groupHash, GAME_ONE))).toBe(false);

    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('waiting');
    expect(await listedStatus(api, BOB.bearer, groupHash)).toBe('waiting');
  });
});

describe('Persist stamps the summary', () => {
  it('Persist writes library fields onto game meta', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const beforeMeta = s3.get(gameMetaKey(groupHash, GAME_ONE));
    expect(beforeMeta).toBeDefined();

    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    const persisted = parsePersistedEnvelope(s3.get(gameStateKey(groupHash, GAME_ONE)) ?? '');
    expect(persisted).toBeDefined();
    if (persisted === undefined) return;
    const meta = gameMetaRecord(s3, groupHash, GAME_ONE);
    expect(meta['players']).toEqual([...persisted.game.players].map(String));
    expect(meta['activePlayer']).toBe(String(persisted.game.activePlayer));
    expect(meta['lostPlayers']).toEqual(lostPlayerIdsOf(persisted.game));
    expect(meta).not.toHaveProperty('winner');
    expect(seatSummaries(meta)).toEqual(seatSummaries(JSON.parse(beforeMeta ?? '{}') as unknown));
  });

  it('Persist that sets a winner also stamps winner on meta', async () => {
    const { api, s3 } = makeHarness();
    await startBobAliceHeuristic(api);
    const groupHash = aliceBobGroupHash();
    const authored = authorWinningWrapState();
    s3.set(gameStateKey(groupHash, GAME_ONE), persistEnvelope(0, authored.state));
    s3.set(gameLogKey(groupHash, GAME_ONE), '');

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);

    const persisted = parsePersistedEnvelope(s3.get(gameStateKey(groupHash, GAME_ONE)) ?? '');
    expect(persisted).toBeDefined();
    if (persisted === undefined) return;
    expect(persisted.game.winner).toBeDefined();
    const meta = gameMetaRecord(s3, groupHash, GAME_ONE);
    expect(meta['winner']).toBe(String(persisted.game.winner));
    expect(meta['players']).toEqual([...persisted.game.players].map(String));
    expect(meta['activePlayer']).toBe(String(persisted.game.activePlayer));
    expect(meta['lostPlayers']).toEqual(lostPlayerIdsOf(persisted.game));
    expect(seatSummaries(meta)).toHaveLength(3);
  });
});
