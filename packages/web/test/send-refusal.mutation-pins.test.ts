/**
 * P100 mutation pins — the shell's settle decision, the pointer cancel, and
 * the tutorial decorator's restore, as pure seams App.tsx only wires.
 *
 * @see docs/spec/send-refusal/send-refusal.md (D3, D4)
 */

import { SUBMIT_OUTCOMES, SUBMIT_REFUSALS, type SubmitOutcome } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import type { InputSnapshot } from '../src/input/modes';
import { cancelPointer } from '../src/input/pointer';
import { draftAfterSubmit, settleSubmit } from '../src/online-submit';
import { decorateInputMode } from '../src/tutorial/restrict';
import {
  arrowAlong,
  draftOf,
  geometry,
  makeMode,
  rules,
  selectOpenField,
} from './ray-run-input.support';

const RESTORED: InputSnapshot = { phase: { kind: 'idle' }, highlights: { targets: new Set() } };
const RESET: InputSnapshot = { phase: { kind: 'idle' }, highlights: { targets: new Set() } };

const countingMode = () => {
  const calls: string[] = [];
  return {
    calls,
    mode: {
      reset: () => {
        calls.push('reset');
        return RESET;
      },
      restoreSent: () => {
        calls.push('restoreSent');
        return RESTORED;
      },
    },
  };
};

describe('settleSubmit (D3)', () => {
  it.each(SUBMIT_REFUSALS.map((r) => [r]))('A refusal restores and does not refresh (%s)', (outcome) => {
    const m = countingMode();
    const after = settleSubmit(outcome, m.mode);
    expect(after).toEqual({ snap: RESTORED, refresh: false });
    expect(after.snap).toBe(RESTORED);
    expect(m.calls).toEqual(['restoreSent']);
  });

  const reached = SUBMIT_OUTCOMES.filter(
    (o): o is SubmitOutcome => !(SUBMIT_REFUSALS as readonly string[]).includes(o),
  );

  it.each(reached.map((r) => [r]))('An outcome that reached the server resets and refreshes (%s)', (outcome) => {
    const m = countingMode();
    const after = settleSubmit(outcome, m.mode);
    expect(after.snap).toBe(RESET);
    expect(after.refresh).toBe(true);
    expect(m.calls).toEqual(['reset']);
  });

  it('A rejected submit resets and refreshes', () => {
    const m = countingMode();
    const after = settleSubmit(undefined, m.mode);
    expect(after.snap).toBe(RESET);
    expect(after.refresh).toBe(true);
    expect(m.calls).toEqual(['reset']);
  });
});

it('draftAfterSubmit clears a rejected submit', () => {
  expect(draftAfterSubmit(undefined)).toBe('clear');
});

describe('cancelPointer (D4)', () => {
  it('Forgets the pointer and ends the pinch when one pointer is left', () => {
    const pointers = new Map<number, unknown>([
      [1, {}],
      [2, {}],
    ]);
    expect(cancelPointer(pointers, 2)).toBe(true);
    expect([...pointers.keys()]).toEqual([1]);
  });

  it('Keeps the pinch while two pointers remain', () => {
    const pointers = new Map<number, unknown>([
      [1, {}],
      [2, {}],
      [3, {}],
    ]);
    expect(cancelPointer(pointers, 3)).toBe(false);
    expect([...pointers.keys()]).toEqual([1, 2]);
  });

  it('An unknown pointer changes nothing but still reports the count', () => {
    const pointers = new Map<number, unknown>([
      [1, {}],
      [2, {}],
    ]);
    expect(cancelPointer(pointers, 9)).toBe(false);
    expect(pointers.size).toBe(2);
  });
});

describe('The tutorial decorator delegates restoreSent (D3)', () => {
  it('A decorated mode restores the sent route', () => {
    const selected = selectOpenField(4);
    const inner = makeMode(selected.board);
    const mode = decorateInputMode(inner, { coach: () => '' });
    mode.onArrowClick(selected.from, selected.state, rules);
    const drafted = mode.onArrowClick(arrowAlong(geometry, selected.from, 0, 1), selected.state, rules);
    const draft = [...draftOf(drafted)];
    mode.send();
    const restored = mode.restoreSent();
    expect(restored.phase.kind).toBe('route');
    expect(draftOf(restored)).toEqual(draft);
  });
});
