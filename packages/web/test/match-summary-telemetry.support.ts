/**
 * Tiny GameState stubs and source-read helpers for P32 match-summary tests.
 * Not a rules apply — territory / trail maps only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MATCH_CONFIG,
  endTurn,
  mintArrowId,
  mintPlayerId,
  step,
  type ArrowId,
  type GameState,
  type Move,
  type PlayerId,
} from '@conquarrow/contracts';
import {
  appendMoves,
  createMatchLog,
  emptyMatchSummary,
  type MatchLog,
  type MatchSummary,
} from '../src/matchLog';

const here = dirname(fileURLToPath(import.meta.url));

export const A = mintPlayerId('A');
export const B = mintPlayerId('B');

export const FROM = mintArrowId('from');
export const TO = mintArrowId('to');
export const ARROW_0 = mintArrowId('a0');
export const ARROW_1 = mintArrowId('a1');
export const ARROW_2 = mintArrowId('a2');

export const oneStep = (): Move => step(FROM, TO, 1);
export const oneEndTurn = (): Move => endTurn();

export const webSrcPath = (...parts: readonly string[]): string =>
  join(here, '../src', ...parts);

export const appSource = (): string => readFileSync(webSrcPath('App.tsx'), 'utf8');
export const matchLogSource = (): string => readFileSync(webSrcPath('matchLog.ts'), 'utf8');
export const hudSource = (): string => readFileSync(webSrcPath('Hud.tsx'), 'utf8');

export const appMainExists = (): boolean => existsSync(webSrcPath('AppMain.tsx'));

export const packetTestSource = (file: string): string =>
  readFileSync(join(here, file), 'utf8');

export const foldMatchSummarySource = (): string => {
  const src = matchLogSource();
  const start = src.indexOf('export const foldMatchSummary');
  if (start < 0) throw new Error('setup: foldMatchSummary export missing');
  const next = src.indexOf('\nexport const', start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
};

export const gameState = (args?: {
  readonly players?: readonly PlayerId[];
  readonly territory?: ReadonlyArray<readonly [ArrowId, PlayerId]>;
  readonly trails?: ReadonlyArray<readonly [PlayerId, readonly ArrowId[]]>;
}): GameState =>
  ({
    players: args?.players ?? [A, B],
    territory: new Map(args?.territory ?? []),
    trails: new Map((args?.trails ?? []).map(([player, arrows]) => [player, new Set(arrows)])),
  }) as unknown as GameState;

export const summaryOf = (overrides?: {
  readonly steps?: number;
  readonly endTurns?: number;
  readonly closes?: number;
  readonly cuts?: number;
  readonly firstCloseAt?: number;
}): MatchSummary => ({
  steps: overrides?.steps ?? 0,
  endTurns: overrides?.endTurns ?? 0,
  closes: overrides?.closes ?? 0,
  cuts: overrides?.cuts ?? 0,
  firstCloseAt: overrides?.firstCloseAt,
});

export const newLog = (moves: readonly Move[] = []): MatchLog => {
  const log = createMatchLog({
    config: DEFAULT_MATCH_CONFIG,
    vsBot: false,
    botMode: 'human-hotseat',
    seats: [
      { player: A, kind: 'human' },
      { player: B, kind: 'human' },
    ],
    humanSeat: A,
    botSeat: undefined,
    startedAt: '2026-08-16T00:00:00.000Z',
  });
  return moves.length === 0 ? log : appendMoves(log, moves);
};

export const zeros = (): MatchSummary => emptyMatchSummary();

const memoryStorage = (store: Map<string, string>): Storage => ({
  get length() {
    return store.size;
  },
  clear: (): void => {
    store.clear();
  },
  getItem: (key: string): string | null => store.get(key) ?? null,
  key: (index: number): string | null => [...store.keys()][index] ?? null,
  removeItem: (key: string): void => {
    store.delete(key);
  },
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
});

/** In-memory `localStorage` for Node vitest (no jsdom). */
export const installMemoryLocalStorage = (): (() => void) => {
  const store = new Map<string, string>();
  const memory = memoryStorage(store);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: memory,
  });
  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', previous);
    }
  };
};
