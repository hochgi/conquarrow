/**
 * EARS invariants for docs/spec/online-game-library/online-game-library.md — API.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check.
 */

import { describe, expect, it } from 'vitest';
import type { LibraryGameStatus } from '@conquarrow/contracts';
import { parsePersistedEnvelope } from '../src/game-snapshot';
import {
  cloneS3,
  expectS3Unchanged,
  gameMetaRecord,
  libraryRowOf,
  lostPlayerIdsOf,
} from './game-library.support';
import {
  ALICE,
  BOB,
  CAROL,
  EXPIRED_BEARER,
  GAME_ONE,
  INVALID_BEARER,
  aliceBobGroupHash,
  expectNoSubLeak,
  expectStatus,
  gameStateKey,
  getGame,
  getMyGames,
  libraryGamesOf,
  makeHarness,
  parseBody,
  seedOpeningState,
  startAliceBob,
} from './support';

const STATUSES: readonly LibraryGameStatus[] = ['your-turn', 'waiting', 'won', 'lost'];

describe('online-game-library API invariants', () => {
  it('When GET /my-games lists a started game, the system shall include a caller-relative status of your-turn, waiting, won, or lost', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    for (const user of [ALICE, BOB]) {
      const lib = libraryGamesOf(parseBody(expectStatus(await getMyGames(api, user.bearer), 200)));
      const row = libraryRowOf(lib.games, groupHash, GAME_ONE);
      expect(STATUSES, `${user.sub} status`).toContain(row.status);
    }
  });

  it('When the bearer occupies the active living seat and winner is unset, the system shall report your-turn for that bearer and shall not report your-turn for another bound human on that game', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    const alice = libraryRowOf(
      libraryGamesOf(parseBody(expectStatus(await getMyGames(api, ALICE.bearer), 200))).games,
      groupHash,
    );
    const bob = libraryRowOf(
      libraryGamesOf(parseBody(expectStatus(await getMyGames(api, BOB.bearer), 200))).games,
      groupHash,
    );
    expect(alice.status).toBe('your-turn');
    expect(bob.status).not.toBe('your-turn');
  });

  it('When a persist writes state.json, the system shall write players, activePlayer, and lostPlayers onto that game meta.json, and winner when it is set, and shall keep seats', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const persisted = parsePersistedEnvelope(s3.get(gameStateKey(groupHash, GAME_ONE)) ?? '');
    expect(persisted).toBeDefined();
    if (persisted === undefined) return;
    const meta = gameMetaRecord(s3, groupHash, GAME_ONE);
    expect(meta['players']).toEqual([...persisted.game.players].map(String));
    expect(meta['activePlayer']).toBe(String(persisted.game.activePlayer));
    expect(meta['lostPlayers']).toEqual(lostPlayerIdsOf(persisted.game));
    expect(meta).toHaveProperty('seats');
    if (persisted.game.winner === undefined) {
      expect(meta).not.toHaveProperty('winner');
    } else {
      expect(meta['winner']).toBe(String(persisted.game.winner));
    }
  });

  it('When meta.json lacks a library summary and state.json exists, GET /my-games shall classify from that state and shall not write S3', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);
    const before = cloneS3(s3);

    const lib = libraryGamesOf(parseBody(expectStatus(await getMyGames(api, ALICE.bearer), 200)));
    expect(libraryRowOf(lib.games, groupHash).status).toBe('your-turn');
    expectS3Unchanged(before, s3);
  });

  it('The system shall not include another user lobbies or games in GET /my-games', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const res = expectStatus(await getMyGames(api, CAROL.bearer), 200);
    const lib = libraryGamesOf(parseBody(res));
    expect(lib.games.some((row) => row.groupHash === groupHash)).toBe(false);
    expect(lib.lobbies).toEqual([]);
  });

  it('When a request has no valid Google ID token, the system shall respond 401 on GET /my-games', async () => {
    const { api } = makeHarness();
    for (const bearer of [undefined, EXPIRED_BEARER, INVALID_BEARER] as const) {
      expectStatus(await getMyGames(api, bearer), 401);
    }
  });

  it('The system shall not include Google sub in /my-games bodies', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    for (const user of [ALICE, BOB]) {
      const res = expectStatus(await getMyGames(api, user.bearer), 200);
      expectNoSubLeak(res, ALICE.sub);
      expectNoSubLeak(res, BOB.sub);
      expectNoSubLeak(res, CAROL.sub);
    }
  });
});
