/**
 * Lost-seat diff and elimination toasts (P102). Pure: no clock, no DOM, no I/O.
 *
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

import { parsePagesHash } from './online-hash';

/** Auto-dismiss delay. The component receives this as `dismissMs`; the number is not in JSX. */
export const ELIMINATION_TOAST_MS = 4000;

/** Letters of `players` for which `isLostAt` holds, in `players` order, each once. */
export const lostSeatIds = (
  players: readonly string[],
  isLostAt: (letter: string) => boolean,
): readonly string[] => {
  const out: string[] = [];
  for (const letter of players) {
    if (isLostAt(letter) && !out.includes(letter)) out.push(letter);
  }
  return out;
};

/**
 * Letters in `nextLost` that are not in `prevLost`, in `nextLost` order, each once.
 * `undefined` is the first snapshot and emits nothing. `[]` is a real snapshot.
 */
export const newlyLost = (
  prevLost: readonly string[] | undefined,
  nextLost: readonly string[],
): readonly string[] => {
  if (prevLost === undefined) return [];
  const out: string[] = [];
  for (const letter of nextLost) {
    if (out.includes(letter) || prevLost.includes(letter)) continue;
    out.push(letter);
  }
  return out;
};

/**
 * `groupHash/gameNumber` while online and the hash is a game route.
 * Otherwise `local:` plus `startedAt` — lobby, invite, or a game route while offline.
 */
export const matchIdentity = (online: boolean, hash: string, startedAt: string): string => {
  const route = parsePagesHash(hash);
  if (online && route.kind === 'game') return `${route.groupHash}/${route.gameNumber}`;
  return `local:${startedAt}`;
};

/** Previous lost set of one match. Absent memory is the first observation of a mount. */
export interface LossMemory {
  readonly identity: string;
  readonly prevLost: readonly string[];
}

/**
 * App's observation. A new identity, or absent memory, records `nextLost` and emits nothing.
 * The same identity diffs with `newlyLost` and stores `nextLost`.
 */
export const observeLosses = (
  memory: LossMemory | undefined,
  identity: string,
  nextLost: readonly string[],
): { readonly memory: LossMemory; readonly newly: readonly string[] } => {
  if (memory === undefined || memory.identity !== identity) {
    return { memory: { identity, prevLost: nextLost }, newly: [] };
  }
  return {
    memory: { identity, prevLost: nextLost },
    newly: newlyLost(memory.prevLost, nextLost),
  };
};

/** `you` is `You were eliminated`. Anything else, including `your agent`, takes `was`. */
export const eliminationSentence = (label: string): string =>
  label === 'you' ? 'You were eliminated' : `${label} was eliminated`;

export interface EliminationToast {
  readonly id: string;
  readonly text: string;
}

/** One toast per letter, in `newly` order. `id` is the letter. `text` is the sentence of `labelOf`. */
export const eliminationToasts = (
  newly: readonly string[],
  labelOf: (letter: string) => string,
): readonly EliminationToast[] =>
  newly.map((id) => ({ id, text: eliminationSentence(labelOf(id)) }));
