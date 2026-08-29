/**
 * docs/spec/online-move-log-replay/online-move-log-replay.core.feature —
 * the client-side scenarios. One it() per scenario, against the P19 adapter
 * port and the pure `online-replay.ts` surface.
 *
 * App's rAF drain loop is deliberately untested, exactly as P48's tween runner
 * is: what App consumes — the queue, the commit order, the hop list, the
 * replay window — is asserted here, on the pure side.
 *
 * The server-side scenarios live in
 * packages/online-api/test/online-move-log-replay.core.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { SeatKind } from '../src/seatPlan';
import { isSpectatedSeat } from '../src/spectate';
import {
  commitSequence,
  hopMoves,
  inReplayWindow,
  planFromWake,
} from '../src/online-replay';
import {
  ALICE,
  GAME_ONE,
  GROUP_HASH,
  gameHash,
  makePagesHarness,
} from './online-web.support';
import {
  batch,
  hop,
  logScript,
  logWindow,
  mark,
  pass,
  sincesRequested,
  snapshotScript,
  wake,
} from './online-move-log-replay.support';

describe('A remote turn replays move by move', () => {
  it("A wake replays the opponent's turn instead of swapping the snapshot", async () => {
    const moves = [mark('r1'), mark('r2'), pass()];
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [snapshotScript(5), logScript(logWindow(4, 5, moves))],
    });
    h.adapter.noteDisplayed(4);

    await h.adapter.receiveStateChanged(wake(5));

    expect(sincesRequested(h)).toEqual(['4']);
    expect(h.adapter.pendingReplays()).toEqual([batch(4, 5, moves)]);
    // Every move reaches the commit path, in log order — one commit each.
    expect(commitSequence(h.adapter.pendingReplays())).toEqual(moves);
    // Once App reports the batch finished, that version is displayed.
    h.adapter.noteDisplayed(5);
    expect(
      planFromWake({ baseline: 5, to: 5, window: logWindow(5, 5, []) }),
    ).toEqual({ kind: 'nothing' });
  });

  it('The camera follows each replayed move', async () => {
    const first = hop('s0', 's1');
    const second = hop('s1', 's2');
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [snapshotScript(5), logScript(logWindow(4, 5, [first, second]))],
    });
    h.adapter.noteDisplayed(4);

    await h.adapter.receiveStateChanged(wake(5));

    const queued = h.adapter.pendingReplays();
    const shown = commitSequence(queued);
    // The window opens on the first replayed move and stays open until the
    // queue is drained — then the camera is restored.
    expect(inReplayWindow({ playing: true, pending: queued.length })).toBe(true);
    expect(inReplayWindow({ playing: false, pending: 0 })).toBe(false);
    expect(hopMoves(shown)).toEqual([first, second]);
  });

  it('An online seat that is not ours is spectated', () => {
    expect(
      isSpectatedSeat({
        seatKind: 'human',
        online: true,
        tutorial: false,
        ownSeat: 'theirs',
      }),
    ).toBe(true);
  });

  /**
   * The one P49 scenario that is green before phase 3: D6 keeps an online seat
   * that is ours unspectated, which is exactly today's behaviour. It is a
   * regression guard for the clause its two siblings above add.
   */
  it('Our own online seat is not spectated', () => {
    expect(
      isSpectatedSeat({ seatKind: 'human', online: true, tutorial: false, ownSeat: 'ours' }),
    ).toBe(false);
  });

  it('A server-run heuristic seat online is spectated', () => {
    const seatKind: SeatKind = 'heuristic';
    expect(
      isSpectatedSeat({ seatKind, online: true, tutorial: false, ownSeat: 'theirs' }),
    ).toBe(true);
  });
});

describe('Cold start shows the current position', () => {
  it('Opening a game from a fresh load installs the snapshot', async () => {
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [snapshotScript(7)],
    });

    await h.adapter.boot();

    expect(h.adapter.board()?.version).toBe(7);
    expect(sincesRequested(h)).toEqual([]);
    expect(h.adapter.pendingReplays()).toEqual([]);
    expect(
      planFromWake({ baseline: undefined, to: 7, window: logWindow(0, 7, []) }),
    ).toEqual({ kind: 'install', version: 7 });
  });
});
