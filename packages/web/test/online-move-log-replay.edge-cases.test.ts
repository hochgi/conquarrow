/**
 * docs/spec/online-move-log-replay/online-move-log-replay.edge-cases.feature —
 * the client-side rules: fallback, backlog, replay content, divergence.
 * One it() per scenario. The route-boundary and gap-reporting rules are
 * server-side and live in packages/online-api.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, Move } from '@conquarrow/contracts';
import { replay } from '@conquarrow/rules-core';
import {
  commitSequence,
  divergenceReport,
  hopMoves,
  parseLogWindow,
  planFromWake,
} from '../src/online-replay';
import { ALICE, GAME_ONE, GROUP_HASH, gameHash, makePagesHarness } from './online-web.support';
import type { PagesHarness, ScriptedFetch } from './online-web.support';
import {
  batch,
  failedLogScript,
  logRoute,
  logScript,
  logWindow,
  mark,
  openingThree,
  pass,
  rules,
  sincesRequested,
  snapshotScript,
  wake,
} from './online-move-log-replay.support';

const seatedAt = (
  baseline: number,
  fetchScript: readonly ScriptedFetch[],
): PagesHarness => {
  const h = makePagesHarness({
    hash: gameHash(GROUP_HASH, GAME_ONE),
    sessionToken: ALICE.bearer,
    fetchScript,
  });
  h.adapter.noteDisplayed(baseline);
  return h;
};

describe('The client falls back rather than inventing a picture', () => {
  it('A gap installs the snapshot', async () => {
    const h = seatedAt(1, [snapshotScript(6), logScript(logWindow(1, 6, [], true))]);

    await h.adapter.receiveStateChanged(wake(6));

    expect(h.adapter.board()?.version).toBe(6);
    expect(h.adapter.pendingReplays()).toEqual([]);
    expect(
      planFromWake({ baseline: 1, to: 6, window: logWindow(1, 6, [], true) }),
    ).toEqual({ kind: 'install', version: 6 });
  });

  it('A failed log request installs the snapshot', async () => {
    const h = seatedAt(5, [snapshotScript(6), failedLogScript()]);

    await h.adapter.receiveStateChanged(wake(6));

    expect(h.adapter.board()?.version).toBe(6);
    expect(h.adapter.pendingReplays()).toEqual([]);
    expect(planFromWake({ baseline: 5, to: 6, window: undefined })).toEqual({
      kind: 'install',
      version: 6,
    });
  });

  /**
   * Copilot, PR #39. A `kind` check alone let a malformed step through, and the
   * camera reads `exit` off it. A window carrying one is not the match's moves,
   * so it is unusable — and D4 already says an unusable window installs.
   */
  it('A window carrying a malformed move installs the snapshot', async () => {
    const h = seatedAt(4, [
      snapshotScript(5),
      {
        method: 'GET',
        path: logRoute(),
        status: 200,
        // A step with no `exit` — `arrowsOfMove` would read `undefined` off it.
        body: { from: 4, to: 5, gap: false, moves: [{ kind: 'step', from: 'a', count: 1 }] },
      },
    ]);

    await h.adapter.receiveStateChanged(wake(5));

    expect(h.adapter.board()?.version).toBe(5);
    expect(h.adapter.pendingReplays()).toEqual([]);
    expect(
      parseLogWindow({ from: 4, to: 5, gap: false, moves: [{ kind: 'step', from: 'a', count: 1 }] }),
    ).toBeUndefined();
    // A well-formed window through the same path does replay, so the assertion
    // above is about the malformed move and not about an absent script.
    expect(
      parseLogWindow({ from: 4, to: 5, gap: false, moves: [{ kind: 'endTurn' }] }),
    ).toEqual(logWindow(4, 5, [pass()]));
  });

  /**
   * Copilot, PR #39. `GET /games` and `GET /log` are two reads of a store that
   * moves between them. A window describing a different stretch than the
   * snapshot must not be replayed: its `to` would carry `displayed` past the
   * version this client actually holds.
   */
  it('A window disagreeing with the snapshot version installs the snapshot', async () => {
    const ahead = [mark('v7a')];
    const h = seatedAt(4, [
      snapshotScript(6),
      { method: 'GET', path: logRoute(), status: 200, body: logWindow(4, 7, ahead) },
    ]);

    await h.adapter.receiveStateChanged(wake(6));

    expect(h.adapter.board()?.version).toBe(6);
    expect(h.adapter.pendingReplays()).toEqual([]);
    expect(planFromWake({ baseline: 4, to: 6, window: logWindow(4, 7, ahead) })).toEqual({
      kind: 'install',
      version: 6,
    });
    // A window that starts somewhere other than where we asked is refused too.
    expect(planFromWake({ baseline: 4, to: 6, window: logWindow(3, 6, ahead) })).toEqual({
      kind: 'install',
      version: 6,
    });
  });

  it('A tab becoming visible after an absence installs the snapshot', async () => {
    const catchUp = logWindow(2, 9, [mark('v9a')]);
    // The log fixture is scripted and must stay unconsumed: visibility installs.
    const h = seatedAt(2, [snapshotScript(9), logScript(catchUp), snapshotScript(9), logScript(catchUp)]);

    await h.adapter.becomeVisible();

    expect(h.adapter.board()?.version).toBe(9);
    expect(sincesRequested(h)).toEqual([]);
    expect(h.adapter.pendingReplays()).toEqual([]);
    // The same fixture, reached through a wake, does replay — so the assertion
    // above is about visibility, not about an absent script.
    await h.adapter.receiveStateChanged(wake(9));
    expect(h.adapter.pendingReplays()).toEqual([batch(2, 9, catchUp.moves)]);
  });
});

describe('Backlog — queue and replay everything, in order', () => {
  it('A wake arriving mid-replay is queued and replayed after it', async () => {
    const five = [mark('v5a')];
    const six = [mark('v6a')];
    const h = seatedAt(4, [
      snapshotScript(5),
      logScript(logWindow(4, 5, five)),
      snapshotScript(6),
      logScript(logWindow(5, 6, six)),
    ]);

    await h.adapter.receiveStateChanged(wake(5));
    // App has not finished the version 5 batch, so it has reported no baseline.
    await h.adapter.receiveStateChanged(wake(6));

    expect(h.adapter.pendingReplays()).toEqual([batch(4, 5, five), batch(5, 6, six)]);
    expect(commitSequence(h.adapter.pendingReplays())).toEqual([...five, ...six]);
    expect(h.adapter.takeReplay()).toEqual(batch(4, 5, five));
    expect(h.adapter.takeReplay()).toEqual(batch(5, 6, six));
    h.adapter.noteDisplayed(6);
    expect(planFromWake({ baseline: 6, to: 6, window: logWindow(6, 6, []) })).toEqual({
      kind: 'nothing',
    });
  });

  /**
   * Regression (phase 4). "In flight" is not "still queued": once App's drain
   * loop has taken a batch, the queue is empty and the displayed baseline is
   * still the pre-batch one, because App only reports it when the batch
   * *finishes*. A wake landing in that gap must not re-fetch — and re-apply —
   * the moves that are on screen right now.
   */
  it('A wake arriving after the batch was dequeued resumes from it, not from the baseline', async () => {
    const five = [mark('v5a')];
    const six = [mark('v6a')];
    const h = seatedAt(4, [
      snapshotScript(5),
      logScript(logWindow(4, 5, five)),
      snapshotScript(6),
      logScript(logWindow(5, 6, six)),
    ]);

    await h.adapter.receiveStateChanged(wake(5));
    // App has taken the batch and is playing it; it has reported no baseline yet.
    expect(h.adapter.takeReplay()).toEqual(batch(4, 5, five));
    await h.adapter.receiveStateChanged(wake(6));

    expect(sincesRequested(h)).toEqual(['4', '5']);
    expect(h.adapter.pendingReplays()).toEqual([batch(5, 6, six)]);
    expect(commitSequence(h.adapter.pendingReplays())).toEqual(six);
  });

  it('Two wakes arriving during one replay both play, in arrival order', async () => {
    const five = [mark('v5a')];
    const six = [mark('v6a')];
    const seven = [mark('v7a'), pass()];
    const h = seatedAt(4, [
      snapshotScript(5),
      logScript(logWindow(4, 5, five)),
      snapshotScript(6),
      logScript(logWindow(5, 6, six)),
      snapshotScript(7),
      logScript(logWindow(6, 7, seven)),
    ]);

    await h.adapter.receiveStateChanged(wake(5));
    await h.adapter.receiveStateChanged(wake(6));
    await h.adapter.receiveStateChanged(wake(7));

    expect(h.adapter.pendingReplays().map((b) => b.to)).toEqual([5, 6, 7]);
    expect(commitSequence(h.adapter.pendingReplays())).toEqual([...five, ...six, ...seven]);
    h.adapter.noteDisplayed(7);
    expect(planFromWake({ baseline: 7, to: 7, window: logWindow(7, 7, []) })).toEqual({
      kind: 'nothing',
    });
  });
});

describe('Replay content edge cases', () => {
  it('A batch of only endTurn moves commits without a camera hop', async () => {
    const only = [pass()];
    const h = seatedAt(4, [snapshotScript(5), logScript(logWindow(4, 5, only))]);

    await h.adapter.receiveStateChanged(wake(5));

    expect(commitSequence(h.adapter.pendingReplays())).toEqual(only);
    expect(hopMoves(only)).toEqual([]);
    h.adapter.noteDisplayed(5);
    expect(planFromWake({ baseline: 5, to: 5, window: logWindow(5, 5, []) })).toEqual({
      kind: 'nothing',
    });
  });

  it('A batch that ends the match replays to the win', () => {
    // The engine resolves a loss on the move that causes it, so a batch whose
    // opening position is one move from a win is one move long. What is asserted
    // is what the scenario asks: nothing is dropped, and the end state carries
    // the winner.
    const { state, moves } = matchEndingBatch();
    const queued = [batch(4, 5, moves)];

    const replayed = replay(rules, state, commitSequence(queued));

    expect(commitSequence(queued)).toEqual(moves);
    expect(replayed.winner).toBeDefined();
  });

  it('Local input is refused while a replay is in flight', async () => {
    const five = [mark('v5a')];
    const h = seatedAt(4, [snapshotScript(5), logScript(logWindow(4, 5, five))]);
    await h.adapter.receiveStateChanged(wake(5));
    const before = h.fetchLog.filter((req) => req.method === 'POST').length;

    await h.adapter.submitMove(pass());

    expect(h.adapter.pendingReplays()).toEqual([batch(4, 5, five)]);
    expect(h.fetchLog.filter((req) => req.method === 'POST')).toHaveLength(before);
  });

  /** Regression (phase 4): a dequeued batch is still in flight until it finishes. */
  it('Local input is refused while a dequeued batch is still playing', async () => {
    const five = [mark('v5a')];
    const h = seatedAt(4, [snapshotScript(5), logScript(logWindow(4, 5, five))]);
    await h.adapter.receiveStateChanged(wake(5));
    expect(h.adapter.takeReplay()).toEqual(batch(4, 5, five));
    expect(h.adapter.pendingReplays()).toEqual([]);

    await h.adapter.submitMove(pass());

    expect(h.fetchLog.filter((req) => req.method === 'POST')).toEqual([]);
    // Only App reporting the batch finished hands control back.
    h.adapter.noteDisplayed(5);
    await h.adapter.submitMove(pass());
    expect(h.fetchLog.filter((req) => req.method === 'POST')).toHaveLength(1);
  });
});

describe('Divergence is loud and inert', () => {
  it('A replayed state disagreeing with the snapshot is reported and left alone', () => {
    const opening = openingThree();
    const drifted = replay(rules, opening, [pass()]);

    const report = divergenceReport({
      groupHash: GROUP_HASH,
      gameNumber: GAME_ONE,
      version: 5,
      replayed: drifted,
      snapshot: opening,
    });

    expect(report).toBeDefined();
    expect(report).toContain(GROUP_HASH);
    expect(report).toContain(GAME_ONE);
    expect(report).toContain('5');
    // Nothing is mitigated: the replayed state stands, untouched.
    expect(drifted).toEqual(replay(rules, opening, [pass()]));
    expect(
      divergenceReport({
        groupHash: GROUP_HASH,
        gameNumber: GAME_ONE,
        version: 5,
        replayed: drifted,
        snapshot: drifted,
      }),
    ).toBeUndefined();
  });
});

/** A position one move from a win, and the batch that finishes it. */
function matchEndingBatch(): { readonly state: GameState; readonly moves: readonly Move[] } {
  const opening = openingThree();
  const winner = opening.players[0];
  if (winner === undefined) throw new Error('fixture: no players');
  const state: GameState = {
    ...opening,
    groups: new Map([...opening.groups].filter(([, group]) => group.owner === winner)),
    territory: new Map([...opening.territory].filter(([, owner]) => owner === winner)),
  };
  return { state, moves: [pass()] };
}
