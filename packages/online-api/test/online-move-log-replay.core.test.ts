/**
 * docs/spec/online-move-log-replay/online-move-log-replay.core.feature —
 * the server-side scenarios. One it() per scenario.
 *
 * Rules "Log lines carry the version their batch produced" and "GET the log
 * since a version". The client-side rules live in
 * packages/web/test/online-move-log-replay.core.test.ts.
 *
 * @see docs/spec/online-move-log-replay/online-move-log-replay.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  aliceBobGroupHash,
  carriesNoMoves,
  expectStatus,
  firstLegalStep,
  gameLogKey,
  getGame,
  getLog,
  logBody,
  logStamps,
  makeHarness,
  openingMatch,
  parseLogJsonl,
  parseLogLines,
  postMove,
  seedLog,
  seedStateAtVersion,
  stampedLine,
  startAliceBob,
  startAliceHeuristicBob,
  startHeuristicThenAliceBob,
} from './support';

/**
 * A distinguishable move to seed a log line with.
 *
 * A step rather than the no-op kind P51 deleted: what these tests need is a move
 * whose identity is readable in the line, and a step from a named arrow is that.
 */
const mark = (name: string): Move => step(mintArrowId(name), mintArrowId(`${name}-exit`), 1);

describe('Log lines carry the version their batch produced', () => {
  it('A human move stamps one line with the new version', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const move = firstLegalStep(openingMatch(3));

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, move, 0), 200);

    const lines = parseLogLines(s3.get(gameLogKey(groupHash, GAME_ONE)));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.v).toBe(1);
    expect(lines[0]?.move).toEqual(move);
  });

  it('A heuristic burst stamps every line with the same version', async () => {
    const { api, s3 } = makeHarness();
    await startAliceHeuristicBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const alicePasses = endTurn();

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, alicePasses, 0), 200);

    const raw = s3.get(gameLogKey(groupHash, GAME_ONE));
    const moves = parseLogJsonl(raw);
    expect(moves.length).toBeGreaterThan(1);
    expect(moves[0]).toEqual(alicePasses);
    expect(moves.slice(1)).toEqual(moves.slice(1).map(() => endTurn()));
    expect(logStamps(raw)).toEqual(moves.map(() => 1));
  });

  it('The opening burst is stamped version 0', async () => {
    const { api, s3 } = makeHarness();
    await startHeuristicThenAliceBob(api);
    const groupHash = aliceBobGroupHash();

    expectStatus(await getGame(api, groupHash, GAME_ONE, BOB.bearer), 200);

    const stamps = logStamps(s3.get(gameLogKey(groupHash, GAME_ONE)));
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps).toEqual(stamps.map(() => 0));
  });
});

describe('GET the log since a version', () => {
  const batchZero = [mark('v0a')];
  const batchOne = [mark('v1a')];
  const batchTwo = [mark('v2a'), mark('v2b')];
  const batchThree = [mark('v3a')];

  const seedFourBatches = (s3: Map<string, string>, groupHash: string): void => {
    seedStateAtVersion(s3, groupHash, GAME_ONE, 3, 3);
    seedLog(s3, groupHash, GAME_ONE, [
      ...batchZero.map((move) => stampedLine(0, move)),
      ...batchOne.map((move) => stampedLine(1, move)),
      ...batchTwo.map((move) => stampedLine(2, move)),
      ...batchThree.map((move) => stampedLine(3, move)),
    ]);
  };

  it('Moves since the caller version are served in order', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    seedFourBatches(s3, groupHash);

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '1');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.from).toBe(1);
    expect(body.to).toBe(3);
    expect(body.gap).toBe(false);
    expect(body.moves).toEqual([...batchTwo, ...batchThree]);
  });

  it('A caller already at the current version gets nothing to replay', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    seedFourBatches(s3, groupHash);

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '3');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.to).toBe(3);
    expect(body.gap).toBe(false);
    expect(body.moves).toEqual([]);
  });

  it('A non-member may not read the log', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    seedFourBatches(s3, groupHash);

    const res = await getLog(api, groupHash, GAME_ONE, CAROL.bearer, '0');

    expectStatus(res, 403);
    expect(carriesNoMoves(res)).toBe(true);
  });
});
