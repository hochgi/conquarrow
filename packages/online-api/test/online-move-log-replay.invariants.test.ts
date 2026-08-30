/**
 * EARS invariants 1–5 of docs/spec/online-move-log-replay/online-move-log-replay.md
 * — the ones the route owns. Table-driven generators in Vitest; this repo has
 * no fast-check (same style as moves-ws.invariants.test.ts).
 *
 * Invariants 6–12 are client-side and live in
 * packages/web/test/online-move-log-replay.invariants.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId, step } from '@conquarrow/contracts';
import type { Move, OnlinePort } from '@conquarrow/contracts';
import {
  ALICE,
  CAROL,
  GAME_ONE,
  aliceBobGroupHash,
  carriesNoMoves,
  expectStatus,
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

/** Deterministic batch sizes — no `Math.random` anywhere. */
const BATCH_SIZES = [1, 2, 1, 3, 1, 2, 2, 1] as const;

type Authored = {
  readonly api: OnlinePort;
  readonly groupHash: string;
  /** Moves by the version they are stamped with. */
  readonly byVersion: ReadonlyMap<number, readonly Move[]>;
  readonly top: number;
};

/** A game whose log holds one contiguous stamped batch per version `0..top`. */
const authorContiguousLog = async (top: number): Promise<Authored> => {
  const { api, s3 } = makeHarness();
  await startAliceBob(api);
  const groupHash = aliceBobGroupHash();
  const byVersion = new Map<number, readonly Move[]>();
  const lines: string[] = [];
  for (let v = 0; v <= top; v += 1) {
    const size = BATCH_SIZES[v % BATCH_SIZES.length] ?? 1;
    const moves: Move[] = [];
    for (let i = 0; i < size; i += 1) moves.push(mark(`v${String(v)}m${String(i)}`));
    byVersion.set(v, moves);
    for (const move of moves) lines.push(stampedLine(v, move));
  }
  seedStateAtVersion(s3, groupHash, GAME_ONE, 3, top);
  seedLog(s3, groupHash, GAME_ONE, lines);
  return { api, groupHash, byVersion, top };
};

const expectedWindow = (authored: Authored, since: number): readonly Move[] => {
  const out: Move[] = [];
  for (let v = since + 1; v <= authored.top; v += 1) {
    out.push(...(authored.byVersion.get(v) ?? []));
  }
  return out;
};

describe('1: only moves stamped inside (from, to] are served', () => {
  it('every since over a contiguous log serves exactly its window', async () => {
    const authored = await authorContiguousLog(6);
    for (let since = 0; since <= authored.top; since += 1) {
      const res = await getLog(
        authored.api,
        authored.groupHash,
        GAME_ONE,
        ALICE.bearer,
        String(since),
      );
      expectStatus(res, 200);
      const body = logBody(res);
      expect(body).toMatchObject({ from: since, to: authored.top, gap: false });
      expect(body.moves).toEqual(expectedWindow(authored, since));
    }
  });
});

describe('2: moves are served in the order they were persisted', () => {
  it('every window is a contiguous run of the file, in file order', async () => {
    const authored = await authorContiguousLog(6);
    const whole = expectedWindow(authored, -1);
    for (let since = 0; since <= authored.top; since += 1) {
      const res = await getLog(
        authored.api,
        authored.groupHash,
        GAME_ONE,
        ALICE.bearer,
        String(since),
      );
      const served = logBody(res).moves;
      const at = whole.length - served.length;
      expect(served).toEqual(whole.slice(at));
    }
  });
});

describe('3: an unavailable or non-contiguous window reports a gap and carries no moves', () => {
  it('every hole reports a gap for exactly the windows that need it', async () => {
    const top = 5;
    for (let hole = 1; hole <= top; hole += 1) {
      const { api, s3 } = makeHarness();
      await startAliceBob(api);
      const groupHash = aliceBobGroupHash();
      const lines: string[] = [];
      for (let v = 0; v <= top; v += 1) {
        if (v !== hole) lines.push(stampedLine(v, mark(`v${String(v)}`)));
      }
      seedStateAtVersion(s3, groupHash, GAME_ONE, 3, top);
      seedLog(s3, groupHash, GAME_ONE, lines);

      for (let since = 0; since <= top; since += 1) {
        const res = await getLog(api, groupHash, GAME_ONE, ALICE.bearer, String(since));
        expectStatus(res, 200);
        const body = logBody(res);
        expect(body.gap).toBe(since < hole);
        if (body.gap) expect(body.moves).toEqual([]);
      }
    }
  });

  it('an unstamped line is never served and gaps every window that needs it', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const top = 4;
    seedStateAtVersion(s3, groupHash, GAME_ONE, 3, top);
    seedLog(s3, groupHash, GAME_ONE, [
      unstampedLine(mark('old0')),
      unstampedLine(mark('old1')),
      stampedLine(3, mark('v3')),
      stampedLine(4, mark('v4')),
    ]);

    for (let since = 0; since <= top; since += 1) {
      const body = logBody(await getLog(api, groupHash, GAME_ONE, ALICE.bearer, String(since)));
      expect(body.gap).toBe(since < 2);
      for (const move of body.moves) {
        expect([mark('v3'), mark('v4')]).toContainEqual(move);
      }
    }
  });
});

describe('4: a since that is absent or not an integer is unprocessable', () => {
  const bad: readonly (string | undefined)[] = [
    undefined,
    '',
    'abc',
    '1.5',
    '-1',
    ' 1',
    '1e3',
    'NaN',
    'Infinity',
    '0x2',
    '2,3',
  ];

  it('every malformed since is 422 and carries no moves', async () => {
    const authored = await authorContiguousLog(3);
    for (const since of bad) {
      const res = await getLog(
        authored.api,
        authored.groupHash,
        GAME_ONE,
        ALICE.bearer,
        since,
      );
      expectStatus(res, 422);
      expect(carriesNoMoves(res)).toBe(true);
    }
  });
});

describe('5: a non-member is served no log moves', () => {
  it('no since yields a move to a non-member', async () => {
    const authored = await authorContiguousLog(4);
    for (const since of ['0', '1', '2', '3', '4']) {
      const res = await getLog(
        authored.api,
        authored.groupHash,
        GAME_ONE,
        CAROL.bearer,
        since,
      );
      expectStatus(res, 403);
      expect(carriesNoMoves(res)).toBe(true);
    }
    // A malformed `since` from a non-member: the spec fixes only that no move
    // reaches them, not which of 403 / 422 wins. Do not assert an order.
    const malformed = await getLog(
      authored.api,
      authored.groupHash,
      GAME_ONE,
      CAROL.bearer,
      'abc',
    );
    expect(malformed.statusCode).not.toBe(200);
    expect(carriesNoMoves(malformed)).toBe(true);
  });

  it('an unsigned caller is served no log moves', async () => {
    const authored = await authorContiguousLog(2);
    for (const since of ['0', '1', '2']) {
      const res = await getLog(
        authored.api,
        authored.groupHash,
        GAME_ONE,
        undefined,
        since,
      );
      expectStatus(res, 401);
      expect(carriesNoMoves(res)).toBe(true);
    }
  });
});
