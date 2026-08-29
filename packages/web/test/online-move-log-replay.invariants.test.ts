/**
 * EARS invariants 6–12 of docs/spec/online-move-log-replay/online-move-log-replay.md
 * — the client-side ones. Deterministic generators; no `Math.random` anywhere.
 *
 * Invariants 1–5 belong to the route and live in
 * packages/online-api/test/online-move-log-replay.invariants.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { Move, ReplayBatch } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import { replay } from '@conquarrow/rules-core';
import type { SeatKind } from '../src/seatPlan';
import { arrowsOfMove, isSpectatedSeat } from '../src/spectate';
import {
  commitSequence,
  divergenceReport,
  hopMoves,
  planFromWake,
  stateDigest,
} from '../src/online-replay';
import { ALICE, GAME_ONE, GROUP_HASH, gameHash, makePagesHarness } from './online-web.support';
import {
  batch,
  hop,
  logScript,
  logWindow,
  mark,
  openingThree,
  pass,
  rules,
  snapshotScript,
  wake,
} from './online-move-log-replay.support';

const VERSIONS = [0, 1, 2, 3, 5, 8, 13, 21] as const;
const SEAT_KINDS: readonly SeatKind[] = ['human', 'heuristic', 'byok'];
const BOOLS = [false, true] as const;

/** Deterministic move shapes, one per batch size. */
const movesFor = (n: number, tag: string): readonly Move[] => {
  const out: Move[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(i % 3 === 0 ? hop(`${tag}${String(i)}`, `${tag}${String(i)}x`) : mark(`${tag}${String(i)}`));
  }
  if (n > 0) out.push(pass());
  return out;
};

describe('6: no displayed baseline installs the snapshot and replays nothing', () => {
  it('every wake with no baseline is an install of the wake version', () => {
    for (const to of VERSIONS) {
      for (const window of [
        undefined,
        logWindow(0, to, []),
        logWindow(0, to, movesFor(2, 'w')),
        logWindow(0, to, [], true),
      ]) {
        expect(planFromWake({ baseline: undefined, to, window })).toEqual({
          kind: 'install',
          version: to,
        });
      }
    }
  });

  it('cold start opens at the current position and fetches no log', async () => {
    for (const to of VERSIONS) {
      const h = makePagesHarness({
        hash: gameHash(GROUP_HASH, GAME_ONE),
        sessionToken: ALICE.bearer,
        fetchScript: [snapshotScript(to)],
      });

      await h.adapter.boot();

      expect(h.adapter.board()?.version).toBe(to);
      expect(h.adapter.pendingReplays()).toEqual([]);
      expect(planFromWake({ baseline: undefined, to, window: logWindow(0, to, []) })).toEqual({
        kind: 'install',
        version: to,
      });
    }
  });
});

describe('7: wakes during a replay are queued and replayed in arrival order', () => {
  it('every arrival order is preserved and no batch is skipped', async () => {
    const arrivals = [5, 6, 7, 8];
    const script = arrivals.flatMap((to) => [
      snapshotScript(to),
      logScript(logWindow(to - 1, to, movesFor(2, `v${String(to)}`))),
    ]);
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: script,
    });
    h.adapter.noteDisplayed(4);

    for (const to of arrivals) await h.adapter.receiveStateChanged(wake(to));

    expect(h.adapter.pendingReplays().map((b) => b.to)).toEqual(arrivals);
    const drained: number[] = [];
    for (;;) {
      const next = h.adapter.takeReplay();
      if (next === undefined) break;
      drained.push(next.to);
    }
    expect(drained).toEqual(arrivals);
  });
});

describe('8: a finished batch reports its to as the new displayed baseline', () => {
  it('a baseline at or past to leaves nothing to show', () => {
    for (const to of VERSIONS) {
      expect(planFromWake({ baseline: to, to, window: logWindow(to, to, []) })).toEqual({
        kind: 'nothing',
      });
      expect(
        planFromWake({ baseline: to + 1, to, window: logWindow(to, to, []) }),
      ).toEqual({ kind: 'nothing' });
    }
  });

  it('a baseline behind a contiguous window replays exactly that window', () => {
    for (const to of VERSIONS) {
      const from = to - 1;
      if (from < 0) continue;
      const moves = movesFor(3, `v${String(to)}`);
      expect(planFromWake({ baseline: from, to, window: logWindow(from, to, moves) })).toEqual({
        kind: 'replay',
        batch: batch(from, to, moves),
      });
    }
  });
});

describe('9: every replayed move goes through the same commit path, in order', () => {
  it('the commit sequence is the concatenation of the queued batches', () => {
    for (const sizes of [[1], [1, 2], [3, 1, 2], [2, 2, 2, 2]]) {
      const batches: ReplayBatch[] = [];
      const expected: Move[] = [];
      let at = 0;
      for (const size of sizes) {
        const moves = movesFor(size, `b${String(at)}`);
        batches.push(batch(at, at + 1, moves));
        expected.push(...moves);
        at += 1;
      }
      expect(commitSequence(batches)).toEqual(expected);
    }
  });

  it('a move that shows nothing still commits, and only steps earn a hop', () => {
    const moves = [pass(), mark('m'), hop('a', 'b'), endTurn()];
    expect(commitSequence([batch(0, 1, moves)])).toEqual(moves);
    expect(hopMoves(moves)).toEqual(moves.filter((m) => arrowsOfMove(m).length > 0));
  });
});

describe('10: a divergence is reported and nothing is changed', () => {
  it('a report appears exactly when the digests differ', () => {
    const opening = openingThree();
    const one = replay(rules, opening, [pass()]);
    const two = replay(rules, one, [pass()]);
    const states = [opening, one, two];

    for (const replayed of states) {
      for (const snapshot of states) {
        const report = divergenceReport({
          groupHash: GROUP_HASH,
          gameNumber: GAME_ONE,
          version: 5,
          replayed,
          snapshot,
        });
        const same = stateDigest(replayed) === stateDigest(snapshot);
        expect(report === undefined).toBe(same);
        if (report !== undefined) {
          expect(report).toContain(GROUP_HASH);
          expect(report).toContain(GAME_ONE);
        }
      }
    }
  });

  it('the digest is deterministic and equal for equal positions', () => {
    const opening = openingThree();
    const left = replay(rules, opening, [pass(), pass()]);
    const right = replay(rules, opening, [pass(), pass()]);
    expect(stateDigest(left)).toBe(stateDigest(right));
    expect(stateDigest(left)).toBe(stateDigest(left));
    expect(stateDigest(left)).not.toBe(stateDigest(opening));
  });
});

describe('11: no local move is accepted while a replay is in flight', () => {
  it('no move kind is submitted while a batch is queued', async () => {
    for (const move of [pass(), mark('x'), hop('p', 'q')]) {
      const h = makePagesHarness({
        hash: gameHash(GROUP_HASH, GAME_ONE),
        sessionToken: ALICE.bearer,
        fetchScript: [snapshotScript(5), logScript(logWindow(4, 5, movesFor(2, 'q')))],
      });
      h.adapter.noteDisplayed(4);
      await h.adapter.receiveStateChanged(wake(5));

      await h.adapter.submitMove(move);

      expect(h.fetchLog.filter((req) => req.method === 'POST')).toEqual([]);
      expect(h.adapter.pendingReplays()).toHaveLength(1);
    }
  });
});

describe('12: an online seat that is not ours is spectated', () => {
  it('the whole truth table', () => {
    for (const seatKind of SEAT_KINDS) {
      for (const online of BOOLS) {
        for (const tutorial of BOOLS) {
          for (const ownSeat of ['ours', 'theirs', undefined] as const) {
            const expected =
              !tutorial &&
              (online ? ownSeat === 'theirs' : seatKind !== 'human');
            expect(
              isSpectatedSeat({
                seatKind,
                online,
                tutorial,
                ...(ownSeat === undefined ? {} : { ownSeat }),
              }),
            ).toBe(expected);
          }
        }
      }
    }
  });
});
