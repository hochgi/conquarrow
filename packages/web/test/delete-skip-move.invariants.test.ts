/**
 * The adapter-side EARS invariants of docs/spec/delete-skip-move/delete-skip-move.md.
 *
 *   4. When a persisted move record names kind `skip`, the decoder shall reject
 *      it and shall not substitute any other move.
 *   7. If a match log is written after this packet, then it shall contain no
 *      record of kind `skip`.
 *
 * Invariant 4 is a property over the decoder: every well-formed skip record the
 * archive could hold — any arrow, with or without stray fields — decodes to
 * nothing. Enumerated deterministically, no seed.
 *
 * The adapter deletions (`requestSkip`, the `cannot-skip` refusal, the tutorial
 * delegation) are asserted as source text: `packages/web` has no RTL and no
 * jsdom, and a symbol that no longer exists cannot be imported by a test that
 * still has to compile today.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { parseLogWindow } from '../src/online-replay';
import { appendMoves, emptyMatchSummary, foldMatchSummary } from '../src/matchLog';
import { arrow, codeOf, gameState, newLog, skipRecord, sourceOf } from './delete-skip-move.support';

const ARROWS = ['a1', 'a2', 'a3', 'x-0', 'fixtures:minimal:a:0-1'] as const;

const window = (move: unknown): unknown => ({ from: 0, to: 1, gap: false, moves: [move] });

describe('4. a persisted skip record decodes to nothing', () => {
  it('rejects every skip record the archive could hold', () => {
    for (const id of ARROWS) {
      expect(parseLogWindow(window(skipRecord(id))), id).toBeUndefined();
      // Stray fields do not rescue it, and nor does a plausible neighbour shape.
      expect(
        parseLogWindow(window({ ...(skipRecord(id) as object), count: 1 })),
        `${id} with a count`,
      ).toBeUndefined();
    }
  });

  it('substitutes no other move for a rejected record', () => {
    const decoded = parseLogWindow(window(skipRecord('a1')));
    expect(decoded).toBeUndefined();
    // A window that holds only well-formed kinds still decodes, so the rejection
    // above is about the kind and not about the decoder refusing everything.
    const ok = parseLogWindow({
      from: 0,
      to: 2,
      gap: false,
      moves: [{ kind: 'step', from: 'a1', exit: 'a2', count: 1 }, { kind: 'endTurn' }],
    });
    expect(ok?.moves).toEqual([step(arrow('a1'), arrow('a2'), 1), endTurn()]);
  });
});

describe('7. a match log written after this packet holds no skip', () => {
  it('records only kinds the vocabulary still has', () => {
    const moves: readonly Move[] = [step(arrow('a1'), arrow('a2'), 1), endTurn()];

    const log = appendMoves(newLog(), moves);
    const summary = foldMatchSummary(emptyMatchSummary(), moves, gameState(), gameState(), 0);

    for (const move of log.moves) expect(['step', 'endTurn']).toContain(move.kind);
    expect(Object.keys(summary)).not.toContain('skips');
  });

  it('has no adapter left that could produce one', () => {
    // `\bonSkip\b` rather than a bare substring: the tutorial's `onSkipLesson`
    // is a different control and must not be dragged in by this assertion.
    for (const file of [
      'App.tsx',
      'Hud.tsx',
      'matchLog.ts',
      'byokBot.ts',
      'online-replay.ts',
      'input/modes.ts',
      'tutorial/restrict.ts',
      'fx/present.ts',
      'opponent.ts',
    ] as const) {
      const code = codeOf(sourceOf(file));
      expect(code.includes('requestSkip'), `${file} still calls requestSkip`).toBe(false);
      expect(code.includes('cannot-skip'), `${file} still refuses with cannot-skip`).toBe(false);
      expect(/\bskip\s*\(/.test(code), `${file} still builds a skip move`).toBe(false);
      expect(/'skip'/.test(code), `${file} still names the skip kind`).toBe(false);
      expect(/\bonSkip\b/.test(code), `${file} still has an onSkip handler`).toBe(false);
    }
  });
});
