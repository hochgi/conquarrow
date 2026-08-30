/**
 * docs/spec/delete-skip-move/delete-skip-move.edge-cases.feature — P51,
 * the wire decode boundary (`POST /games/{group}/{game}/moves`).
 *
 * A persisted or wired record naming the deleted kind is rejected through the
 * decoder's existing failure path — 422, no new error shape, nothing written.
 *
 * The skip payload is built as data, not through a constructor: after the
 * deletion there is no constructor, and data is how such a record arrives.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md — "No backward compatibility"
 */

import { describe, expect, it } from 'vitest';
import type { Move } from '@conquarrow/contracts';
import {
  ALICE,
  GAME_ONE,
  aliceBobCarolGroupHash,
  expectStatus,
  firstLegalStep,
  gameLogKey,
  getGame,
  makeHarness,
  openingMatch,
  parseBody,
  parseLogJsonl,
  postMove,
  startAliceBobCarol,
  storedVersion,
} from './support';

/** The source arrow of a legal step — an arrow the caller really does own. */
const ownedArrow = (): string => {
  const move = firstLegalStep(openingMatch(3));
  if (move.kind !== 'step') throw new Error('setup: firstLegalStep is not a step');
  return String(move.from);
};

/** A stale record naming the deleted kind, as it arrives from a log or a client. */
const skipRecord = (): Move => ({ kind: 'skip', from: ownedArrow() }) as unknown as Move;

/** A record naming a kind the vocabulary never had. */
const unknownRecord = (): Move => ({ kind: 'teleport', from: ownedArrow() }) as unknown as Move;

const openGame = async (): Promise<{
  readonly api: Awaited<ReturnType<typeof makeHarness>>['api'];
  readonly s3: Map<string, string>;
  readonly groupHash: string;
}> => {
  const { api, s3 } = makeHarness();
  await startAliceBobCarol(api);
  const groupHash = aliceBobCarolGroupHash();
  expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
  return { api, s3, groupHash };
};

describe('A persisted skip is rejected, never translated', () => {
  it('A move record naming skip fails to decode', async () => {
    const { api, s3, groupHash } = await openGame();

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, skipRecord(), 0);

    expectStatus(res, 422);
    // No move is produced: nothing is applied, nothing is logged, no version moves.
    expect(parseLogJsonl(s3.get(gameLogKey(groupHash, GAME_ONE)))).toEqual([]);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
  });

  it('The rejection is the decoders ordinary failure, not a new shape', async () => {
    const skipCase = await openGame();
    const unknownCase = await openGame();

    const onSkip = await postMove(
      skipCase.api,
      skipCase.groupHash,
      GAME_ONE,
      ALICE.bearer,
      skipRecord(),
      0,
    );
    const onUnknown = await postMove(
      unknownCase.api,
      unknownCase.groupHash,
      GAME_ONE,
      ALICE.bearer,
      unknownRecord(),
      0,
    );

    expect(onSkip.statusCode).toBe(onUnknown.statusCode);
    expect(parseBody(onSkip)).toEqual(parseBody(onUnknown));
  });

  it('A step record still decodes', async () => {
    const { api, s3, groupHash } = await openGame();
    const move = firstLegalStep(openingMatch(3));

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, move, 0);

    expectStatus(res, 200);
    expect(parseLogJsonl(s3.get(gameLogKey(groupHash, GAME_ONE)))).toEqual([move]);
  });
});
