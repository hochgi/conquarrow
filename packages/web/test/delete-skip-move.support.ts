/**
 * Fixtures for P51 — the deletion of `SkipMove`, adapter side.
 *
 * No RTL and no jsdom by house style: React-level facts are asserted as
 * source-text. Nothing here imports `skip`, since the constructor is what the
 * packet deletes.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MATCH_CONFIG,
  mintArrowId,
  mintPlayerId,
} from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { createMatchLog } from '../src/matchLog';
import type { MatchLog } from '../src/matchLog';

const here = dirname(fileURLToPath(import.meta.url));

export const webSrcPath = (...parts: readonly string[]): string => join(here, '../src', ...parts);

export const sourceOf = (...parts: readonly string[]): string =>
  readFileSync(webSrcPath(...parts), 'utf8');

/** Source with comments stripped — prose may say "skip"; code must not emit one. */
export const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export const A: PlayerId = mintPlayerId('A');
export const B: PlayerId = mintPlayerId('B');

export const arrow = (id: string): ArrowId => mintArrowId(id);

/** A stale wire/log record naming the deleted kind, built as data. */
export const skipRecord = (from: string): unknown => ({ kind: 'skip', from });

/** A minimal GameState stub. The adapters under test read only these fields. */
export const gameState = (args?: {
  readonly activePlayer?: PlayerId;
  readonly territory?: ReadonlyArray<readonly [ArrowId, PlayerId]>;
}): GameState =>
  ({
    players: [A, B],
    activePlayer: args?.activePlayer ?? A,
    territory: new Map(args?.territory ?? []),
    trails: new Map(),
    groups: new Map(),
  }) as unknown as GameState;

/** A RulesPort stub that offers exactly what it is told to offer. */
export const stubRules = (offer: readonly Move[]): RulesPort =>
  ({
    legalMoves: (): readonly Move[] => offer,
    apply: (state: GameState): GameState => state,
  }) as unknown as RulesPort;

export const newLog = (): MatchLog =>
  createMatchLog({
    config: DEFAULT_MATCH_CONFIG,
    vsBot: false,
    botMode: 'human-hotseat',
    seats: [
      { player: A, kind: 'human' },
      { player: B, kind: 'human' },
    ],
    humanSeat: A,
    botSeat: undefined,
    startedAt: '2026-08-30T00:00:00.000Z',
  });
