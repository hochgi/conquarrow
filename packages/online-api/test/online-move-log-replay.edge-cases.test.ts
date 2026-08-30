/**
 * docs/spec/online-move-log-replay/online-move-log-replay.edge-cases.feature —
 * the server-side rules: "Route argument boundaries" and "Gaps are reported,
 * never guessed". One it() per scenario (each Outline example is a scenario).
 *
 * @see docs/spec/online-move-log-replay/online-move-log-replay.md
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import {
  ALICE,
  GAME_ONE,
  GROUP_ABSENT,
  aliceBobGroupHash,
  carriesNoMoves,
  expectStatus,
  gameLogKey,
  getLog,
  logBody,
  makeHarness,
  seedLog,
  seedStateAtVersion,
  stampedLine,
  startAliceBob,
  unstampedLine,
} from './support';

/**
 * A distinguishable move to seed a log line with.
 *
 * A step rather than the no-op kind P51 deleted: what these tests need is a move
 * whose identity is readable in the line, and a step from a named arrow is that.
 */
const mark = (name: string): Move => step(mintArrowId(name), mintArrowId(`${name}-exit`), 1);

const startedAtVersionThree = async (): Promise<{
  readonly api: Awaited<ReturnType<typeof makeHarness>>['api'];
  readonly s3: Map<string, string>;
  readonly groupHash: string;
}> => {
  const { api, s3 } = makeHarness();
  await startAliceBob(api);
  const groupHash = aliceBobGroupHash();
  seedStateAtVersion(s3, groupHash, GAME_ONE, 3, 3);
  seedLog(s3, groupHash, GAME_ONE, [
    stampedLine(0, mark('v0')),
    stampedLine(1, mark('v1')),
    stampedLine(2, mark('v2')),
    stampedLine(3, mark('v3')),
  ]);
  return { api, s3, groupHash };
};

describe('Route argument boundaries', () => {
  const malformed: readonly (string | undefined)[] = [undefined, 'abc', '1.5', '-1'];

  for (const since of malformed) {
    it(`A malformed since is unprocessable: ${since ?? '(absent)'}`, async () => {
      const { api, groupHash } = await startedAtVersionThree();

      const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, since);

      expectStatus(res, 422);
      expect(carriesNoMoves(res)).toBe(true);
    });
  }

  it('A since ahead of the server yields no moves and no gap', async () => {
    const { api, groupHash } = await startedAtVersionThree();

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '9');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.to).toBe(3);
    expect(body.moves).toEqual([]);
    expect(body.gap).toBe(false);
  });

  it('An unknown game is not found', async () => {
    const { api } = makeHarness();

    const res = await getLog(api, GROUP_ABSENT, GAME_ONE, ALICE.bearer, '0');

    expectStatus(res, 404);
  });

  it('An unsigned caller is rejected', async () => {
    const { api, groupHash } = await startedAtVersionThree();

    const res = await getLog(api, groupHash, GAME_ONE, undefined, '0');

    expectStatus(res, 401);
    expect(carriesNoMoves(res)).toBe(true);
  });
});

describe('Gaps are reported, never guessed', () => {
  const seedUnstampedHead = async (): Promise<{
    readonly api: Awaited<ReturnType<typeof startedAtVersionThree>>['api'];
    readonly groupHash: string;
    readonly tail: Move;
  }> => {
    const { api, s3, groupHash } = await startedAtVersionThree();
    const tail = mark('v3');
    seedLog(s3, groupHash, GAME_ONE, [
      unstampedLine(mark('old0')),
      unstampedLine(mark('old1')),
      unstampedLine(mark('old2')),
      stampedLine(3, tail),
    ]);
    return { api, groupHash, tail };
  };

  it('A window needing a pre-P49 unstamped line reports a gap', async () => {
    const { api, groupHash } = await seedUnstampedHead();

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '1');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.gap).toBe(true);
    expect(body.moves).toEqual([]);
  });

  it('A window entirely inside the stamped tail replays', async () => {
    const { api, groupHash, tail } = await seedUnstampedHead();

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '2');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.gap).toBe(false);
    expect(body.moves).toEqual([tail]);
  });

  it('A missing version inside the window reports a gap', async () => {
    const { api, s3, groupHash } = await startedAtVersionThree();
    seedStateAtVersion(s3, groupHash, GAME_ONE, 3, 4);
    seedLog(s3, groupHash, GAME_ONE, [
      stampedLine(0, mark('v0')),
      stampedLine(1, mark('v1')),
      stampedLine(2, mark('v2')),
      stampedLine(4, mark('v4')),
    ]);

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '1');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.gap).toBe(true);
    expect(body.moves).toEqual([]);
  });

  it('A missing log file reports a gap', async () => {
    const { api, s3, groupHash } = await startedAtVersionThree();
    s3.delete(gameLogKey(groupHash, GAME_ONE));

    const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '0');

    expectStatus(res, 200);
    const body = logBody(res);
    expect(body.gap).toBe(true);
    expect(body.moves).toEqual([]);
  });
});
