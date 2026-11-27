/**
 * docs/spec/online-reliability/online-reliability.server.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/online-reliability/online-reliability.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { createWsHandler } from '../src/ws-event';
import { ADVANCE_BUDGET_MS, ADVANCE_MAX_MOVES, advance } from '../src/game-advance';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  aliceBobGroupHash,
  aliceFayGroupHash,
  expectStatus,
  firstLegalStep,
  gameHeaders,
  gameLogKey,
  getGame,
  makeHarness,
  openingMatch,
  overlappingGetStore,
  postMove,
  startAliceBob,
  startAliceFayBurst,
  storedVersion,
} from './support';
import { bodyOf, getVersion, movesAt, postWithId } from './online-reliability.support';

const opened = async (): Promise<ReturnType<typeof makeHarness> & { groupHash: string }> => {
  const harness = makeHarness();
  await startAliceBob(harness.api);
  const groupHash = aliceBobGroupHash();
  expectStatus(await getGame(harness.api, groupHash, GAME_ONE, ALICE.bearer), 200);
  return { ...harness, groupHash };
};

describe('online-reliability server edge cases', () => {
  it('A submit id from another user is not a duplicate', async () => {
    const { api, groupHash, s3 } = await opened();
    const move = firstLegalStep(openingMatch(3));
    expectStatus(await postWithId(api, groupHash, GAME_ONE, ALICE.bearer, move, 0, 's-1'), 200);

    const res = await postWithId(api, groupHash, GAME_ONE, BOB.bearer, move, 0, 's-1');

    expectStatus(res, 412);
    expect(bodyOf(res)).not.toHaveProperty('duplicate');
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(1);
  });

  it('A malformed submit id is unprocessable', async () => {
    const { api, groupHash, s3 } = await opened();
    const before = [...s3.entries()];

    const res = await postWithId(
      api,
      groupHash,
      GAME_ONE,
      ALICE.bearer,
      firstLegalStep(openingMatch(3)),
      0,
      'x'.repeat(65),
    );

    expectStatus(res, 422);
    expect([...s3.entries()]).toEqual(before);
  });

  it('A duplicate after the game moved on still answers its own version', async () => {
    const { api, groupHash, s3 } = await opened();
    expectStatus(await postWithId(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0, 's-1'), 200);
    // Bob's move carries no id, so it keeps Alice's as the last submit.
    expectStatus(await postMove(api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 1), 200);

    const res = await postWithId(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0, 's-1');

    expectStatus(res, 200);
    expect(bodyOf(res)['version']).toBe(1);
    expect(bodyOf(res)['duplicate']).toBe(true);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(2);
  });

  it('A submit id that is not a string is unprocessable', async () => {
    const { api, groupHash, s3 } = await opened();
    const before = [...s3.entries()];

    const res = await api.handle({
      method: 'POST',
      path: `/games/${groupHash}/${GAME_ONE}/moves`,
      headers: gameHeaders(ALICE.bearer, 0),
      body: JSON.stringify({ move: endTurn(), submitId: 7 }),
    });

    expectStatus(res, 422);
    expect([...s3.entries()]).toEqual(before);
  });

  it("A human seat that is another human's is refused without the agent-seat reason", async () => {
    const { api, groupHash } = await opened();

    const res = await postMove(api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 0);

    expectStatus(res, 403);
    expect(bodyOf(res)['reason']).not.toBe('agent-seat');
  });

  it('The advance budget is spent exactly at its edge', async () => {
    let now = 0;
    const { api, s3 } = makeHarness({
      clock: () => now,
      heuristic: () => {
        now += ADVANCE_BUDGET_MS;
        return endTurn();
      },
    });
    await startAliceFayBurst(api);
    const groupHash = aliceFayGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);

    // Alice's move and one heuristic move; the clock then reads exactly the budget.
    expect(movesAt(s3.get(gameLogKey(groupHash, GAME_ONE)), 1)).toHaveLength(2);
  });

  it('A lost race won by the same submit is a duplicate', async () => {
    const data = new Map<string, string>();
    const store = overlappingGetStore(data, (key) => key.endsWith('/state.json'));
    const { api } = makeHarness({ s3: data, store });
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const move = firstLegalStep(openingMatch(3));
    store.arm();

    const [left, right] = await Promise.all([
      postWithId(api, groupHash, GAME_ONE, ALICE.bearer, move, 0, 's-1'),
      postWithId(api, groupHash, GAME_ONE, ALICE.bearer, move, 0, 's-1'),
    ]);

    expectStatus(left, 200);
    expectStatus(right, 200);
    expect([bodyOf(left)['version'], bodyOf(right)['version']]).toEqual([1, 1]);
    expect([bodyOf(left)['duplicate'], bodyOf(right)['duplicate']].filter((d) => d === true)).toHaveLength(1);
    expect(movesAt(data.get(gameLogKey(groupHash, GAME_ONE)), 1)).toEqual([move]);
  });

  it('The advance stops at its budget and the next read continues it', async () => {
    let now = 0;
    const tick = Math.ceil((ADVANCE_BUDGET_MS * 3) / 4);
    const { api, s3 } = makeHarness({
      clock: () => now,
      heuristic: () => {
        now += tick;
        return endTurn();
      },
    });
    await startAliceFayBurst(api);
    const groupHash = aliceFayGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const players = openingMatch(6).players.map(String);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0);

    expectStatus(res, 200);
    expect(movesAt(s3.get(gameLogKey(groupHash, GAME_ONE)), 1)).toHaveLength(3);
    const after = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);
    expect(bodyOf(after)['version']).toBe(2);
    expect(movesAt(s3.get(gameLogKey(groupHash, GAME_ONE)), 2)).toHaveLength(2);
    const state = bodyOf(after)['state'] as Record<string, unknown>;
    expect(state['activePlayer']).toBe(players[5]);
  });

  it('A read that needs no advance writes nothing', async () => {
    const { api, groupHash, s3, notifies } = await opened();
    const before = [...s3.entries()];
    const woken = notifies.length;

    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    expectStatus(await getVersion(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expect([...s3.entries()]).toEqual(before);
    expect(notifies).toHaveLength(woken);
  });

  it('The version read refuses a non-member', async () => {
    const { api, groupHash } = await opened();

    expectStatus(await getVersion(api, groupHash, GAME_ONE, CAROL.bearer), 403);
  });

  it('The heartbeat route answers', async () => {
    const { ws } = makeHarness();
    const handle = createWsHandler(ws);

    const result = await handle({ requestContext: { connectionId: 'c-1', routeKey: '$default' } });

    expect(result.statusCode).toBe(200);
  });

  it('Payload sizes are logged', async () => {
    const lines: string[] = [];
    const { api } = makeHarness({ log: (line) => lines.push(line) });
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    lines.length = 0;

    const res = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed).toContainEqual({
      http: 'GET get-game',
      status: 200,
      bytes: Buffer.byteLength(res.body, 'utf8'),
    });
    expect(lines.some((line) => line.includes(groupHash))).toBe(false);
  });
});

describe('The advance is bounded (D2)', () => {
  it('Against a position that passes forever it stops at ADVANCE_MAX_MOVES, every move a server pass', () => {
    // SPEC §11 item 44: every seat lost at once leaves no winner and no step.
    const forever = { ...openingMatch(3), groups: new Map(), territory: new Map(), trails: new Map() };
    const stopped = advance(forever, [{ kind: 'heuristic' }, { kind: 'heuristic' }, { kind: 'heuristic' }], undefined, () => 0);
    expect(stopped.game.winner).toBeUndefined();
    expect(stopped.logged).toHaveLength(ADVANCE_MAX_MOVES);
    expect(stopped.logged.every((entry) => entry.move.kind === 'endTurn' && entry.by === 'server')).toBe(true);
  });
});
