/**
 * P108 — a state setter that also records the value it sets, so an effect
 * that must not re-run on that state (the local AI loop) can still read the
 * latest one. The record is written inside the updater, i.e. exactly when
 * React computes the new state.
 */

import type { Dispatch, SetStateAction } from 'react';

export interface Latest<T> {
  current: T;
}

export const trackedSetter =
  <T>(set: Dispatch<SetStateAction<T>>, latest: Latest<T>) =>
  (next: SetStateAction<T>): void => {
    set((prev) => {
      const value = next instanceof Function ? next(prev) : next;
      latest.current = value;
      return value;
    });
  };
