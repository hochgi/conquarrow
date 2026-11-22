/**
 * P94 invariants — EARS 1–8 over every way the POSTs of a submit can be answered.
 *
 * @see docs/spec/online-turn-flow/online-turn-flow.md#invariants-ears
 */

import { describe, expect, it } from 'vitest';
import { turnControlsLocked } from '../src/botPause';
import {
  batch,
  logScript,
  logWindow,
  mark,
  snapshotScript,
} from './online-move-log-replay.support';
import {
  heldPost,
  ifMatches,
  postRejected,
  postStatus,
  posted,
  postsOf,
  queued,
  showingAt,
  snapshotReads,
} from './online-turn-flow.support';
import { SUBMIT_ATTEMPTS } from '../src/online-pages';
import { postMoveScript, quotedVersion, type ScriptedFetch } from './online-web.support';

type Answer = 'ok' | 'no-version' | 401 | 409 | 412 | 422 | 500 | 'rejected';

const ANSWERS: readonly Answer[] = ['ok', 'no-version', 401, 409, 412, 422, 500, 'rejected'];

const BASELINE = 4;

/** Every answer sequence of length 1..3 where only the last answer may stop the loop. */
const sequences = (): readonly (readonly Answer[])[] => {
  const out: Answer[][] = [];
  for (const length of [1, 2, 3]) {
    for (const last of ANSWERS) out.push([...Array<Answer>(length - 1).fill('ok'), last]);
  }
  return out;
};

/** P95 D9: a lost request or a 500 is tried SUBMIT_ATTEMPTS times with the same body. */
const RETRIED: readonly Answer[] = [500, 'rejected'];
const triesOf = (answer: Answer): number => (RETRIED.includes(answer) ? SUBMIT_ATTEMPTS : 1);

const scriptFor = (answer: Answer, version: number): ScriptedFetch => {
  if (answer === 'ok') return posted(version);
  if (answer === 'no-version') return postMoveScript(200, {});
  if (answer === 'rejected') return postRejected();
  return postStatus(answer);
};

const run = async (answers: readonly Answer[], extra = 0) => {
  const moves = answers.map((_, i) => mark(`m${String(i)}`));
  for (let i = 0; i < extra; i += 1) moves.push(mark(`x${String(i)}`));
  const landed = answers.filter((a) => a === 'ok').length;
  const to = BASELINE + Math.max(1, landed);
  const script: ScriptedFetch[] = answers.flatMap((a, i) =>
    Array.from({ length: triesOf(a) }, () => scriptFor(a, BASELINE + i + 1)),
  );
  // Answers the test would wrongly reach if the loop did not stop.
  for (let i = 0; i < extra; i += 1) script.push(posted(BASELINE + answers.length + i + 1));
  script.push(snapshotScript(to), logScript(logWindow(BASELINE, to, moves.slice(0, landed))));
  const h = await showingAt(BASELINE, script);
  const readsBefore = snapshotReads(h);
  const outcome = await h.adapter.submitMoves(moves);
  return { h, outcome, moves, landed, to, readsBefore };
};

describe('P94 invariants over every answer sequence', () => {
  for (const answers of sequences()) {
    const name = answers.join(',');

    it(`EARS 1, 2: POSTs in order with a chained If-Match, none after a stop [${name}]`, async () => {
      // Extra moves after a stopping answer must never be POSTed; after an
      // all-ok run there is no stop, so none are queued.
      const { h } = await run(answers, answers.at(-1) === 'ok' ? 0 : 2);
      const expected = answers.flatMap((a, i) =>
        Array.from({ length: triesOf(a) }, () => quotedVersion(BASELINE + i)),
      );
      expect(ifMatches(h)).toEqual(expected);
      expect(postsOf(h)).toBe(expected.length);
    });

    // P95 D10: a 401 holds the rest for the next sign-in, so it stays pending.
    it(`EARS 4, 8: the submit resolves and is pending only when held [${name}]`, async () => {
      const { h, outcome } = await run(answers);
      expect(typeof outcome).toBe('string');
      expect(h.adapter.submitPending()).toBe(answers.at(-1) === 401);
    });

    it(`EARS 5, 6: it reconciles from the displayed baseline unless unauthorised [${name}]`, async () => {
      const { h, readsBefore, moves, landed, to } = await run(answers);
      if (answers.at(-1) === 401) {
        expect(snapshotReads(h)).toBe(readsBefore);
        return;
      }
      expect(snapshotReads(h)).toBe(readsBefore + 1);
      expect(queued(h)).toEqual([batch(BASELINE, to, moves.slice(0, landed))]);
    });
  }

  it('EARS 3: no other POST while a submit is in flight', async () => {
    const held = heldPost();
    const h = await showingAt(BASELINE, [held.script, posted(6), posted(7), snapshotScript(5)]);
    const first = h.adapter.submitMoves([mark('a')]);
    const others = await Promise.all([
      h.adapter.submitMoves([mark('b')]),
      h.adapter.submitMoves([mark('c')]),
    ]);
    held.answer(5);
    await first;
    expect(others).toEqual(['sending', 'sending']);
    expect(postsOf(h)).toBe(1);
  });

  it('EARS 7: the turn controls are locked whenever a submit or a replay is running', () => {
    for (const matchOver of [false, true]) {
      for (const botBusy of [false, true]) {
        for (const aiChair of [false, true]) {
          for (const submitting of [false, true]) {
            for (const replaying of [false, true]) {
              const locked = turnControlsLocked({ matchOver, botBusy, aiChair, submitting, replaying });
              expect(locked).toBe(matchOver || botBusy || aiChair || submitting || replaying);
            }
          }
        }
      }
    }
  });
});
