/**
 * P49 replay fixture — a served window is exactly the moves that carry the
 * client from its baseline to the current version.
 *
 * Turn flow: start → ensure GET → three posted turns → GET the log since each
 * baseline. Folding a served window onto the snapshot of its `from` version must
 * reproduce the `to` snapshot exactly. That is the whole promise of the route,
 * and it is where accidental nondeterminism (a re-ordered batch, a dropped
 * heuristic move) would show up first.
 *
 * @see docs/spec/online-move-log-replay/online-move-log-replay.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { GameState, Move } from '@conquarrow/contracts';
import { makeRules, replay } from '@conquarrow/rules-core';
import { makeTiling } from '@conquarrow/geometry-tiling';
import {
  ALICE,
  BOB,
  GAME_ONE,
  aliceBobGroupHash,
  expectStatus,
  foldLog,
  gameLogKey,
  getGame,
  getLog,
  logBody,
  logStamps,
  makeHarness,
  parseBody,
  parseLogJsonl,
  postMove,
  snapshotState,
  startAliceBob,
  stateOfBody,
  startAliceHeuristicBob,
  versionOf,
} from './support';

const rules = makeRules(makeTiling());

const fold = (from: GameState, moves: readonly Move[]): GameState =>
  replay(rules, from, moves);

describe('a served window carries the client from its baseline to the head', () => {
  it('folding the window onto the from-snapshot reproduces the to-snapshot', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    const snapshots: GameState[] = [];
    const record = async (): Promise<void> => {
      const got = expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
      snapshots.push(foldLog(3, parseLogJsonl(s3.get(gameLogKey(groupHash, GAME_ONE)))));
      expect(stateOfBody(parseBody(got))).toEqual(
        snapshotState(snapshots[snapshots.length - 1] as GameState),
      );
    };
    await record();
    // Seats are Alice, Bob, heuristic: three human turns, one bot burst between.
    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);
    await record();
    expectStatus(await postMove(api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 1), 200);
    await record();

    for (let since = 0; since < snapshots.length - 1; since += 1) {
      const body = logBody(
        await getLog(api, groupHash, GAME_ONE, ALICE.bearer, String(since)),
      );
      expect(body.gap).toBe(false);
      const from = snapshots[since];
      const to = snapshots[snapshots.length - 1];
      if (from === undefined || to === undefined) throw new Error('fixture: missing snapshot');
      expect(snapshotState(fold(from, body.moves))).toEqual(snapshotState(to));
    }
  });

  it('one batch of a heuristic burst replays as one version, in order, twice the same', async () => {
    const { api, s3 } = makeHarness();
    await startAliceHeuristicBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const before = foldLog(3, parseLogJsonl(s3.get(gameLogKey(groupHash, GAME_ONE))));

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);

    const first = logBody(await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '0'));
    const second = logBody(await getLog(api, groupHash, GAME_ONE, ALICE.bearer, '0'));
    expect(second.moves).toEqual(first.moves);
    expect(logStamps(s3.get(gameLogKey(groupHash, GAME_ONE)))).toContain(1);
    expect(snapshotState(fold(before, first.moves))).toEqual(
      snapshotState(fold(before, second.moves)),
    );
    const got = expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    expect(versionOf(parseBody(got))).toBe(1);
    expect(stateOfBody(parseBody(got))).toEqual(snapshotState(fold(before, first.moves)));
  });
});
