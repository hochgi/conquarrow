/**
 * P108 — the match log a BYOK seat reads is the one the last setLog set,
 * whether it was given a value or an updater (docs/spec/agent-context-v2 D3).
 */

import { describe, expect, it } from 'vitest';
import type { SetStateAction } from 'react';
import { trackedSetter, type Latest } from '../src/trackedState';

/** A stand-in for React's setter: holds the state and applies what it is given. */
const holder = <T>(initial: T) => {
  let state = initial;
  return {
    read: (): T => state,
    set: (action: SetStateAction<T>): void => {
      state = action instanceof Function ? action(state) : action;
    },
  };
};

describe('trackedSetter', () => {
  it('a value: the state and the record both take it', () => {
    const h = holder<readonly number[] | undefined>(undefined);
    const latest: Latest<readonly number[] | undefined> = { current: undefined };
    trackedSetter(h.set, latest)([1]);
    expect(h.read()).toEqual([1]);
    expect(latest.current).toEqual([1]);
  });

  it('an updater: applied to the previous state, and the record is its result', () => {
    const h = holder<readonly number[] | undefined>([1]);
    const latest: Latest<readonly number[] | undefined> = { current: [1] };
    const setLog = trackedSetter(h.set, latest);
    setLog((prev) => [...(prev ?? []), 2]);
    setLog((prev) => [...(prev ?? []), 3]);
    expect(h.read()).toEqual([1, 2, 3]);
    expect(latest.current).toEqual([1, 2, 3]);
  });

  it('back to undefined: the record follows', () => {
    const h = holder<readonly number[] | undefined>([1]);
    const latest: Latest<readonly number[] | undefined> = { current: [1] };
    trackedSetter(h.set, latest)(undefined);
    expect(latest.current).toBeUndefined();
    expect(h.read()).toBeUndefined();
  });
});
