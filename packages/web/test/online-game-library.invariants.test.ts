/**
 * EARS invariants for docs/spec/online-game-library/online-game-library.md — shell.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check.
 */

import { describe, expect, it } from 'vitest';
import type { LibraryGameStatus } from '@conquarrow/contracts';
import { parseMyGames } from '../src/online-parse';
import {
  formatLibraryRow,
  libraryOffered,
  libraryStatusLabel,
  MY_GAMES_COPY,
  NO_GAMES_COPY,
} from '../src/online-shell-ui';
import { GAME_ONE, GROUP_HASH } from './online-web.support';

const LABELS: readonly { readonly status: LibraryGameStatus; readonly label: string }[] = [
  { status: 'your-turn', label: 'Open (your turn)' },
  { status: 'waiting', label: 'Open (waiting)' },
  { status: 'won', label: 'Won' },
  { status: 'lost', label: 'Lost' },
];

describe('online-game-library shell invariants', () => {
  it('When Online mode is selected and the player is signed in, the shell shall offer the My games control; when Local is selected, or the player is unsigned, the shell shall not offer it', () => {
    expect({
      onlineSignedIn: libraryOffered('online', true),
      localSignedIn: libraryOffered('local', true),
      onlineUnsigned: libraryOffered('online', false),
      localUnsigned: libraryOffered('local', false),
    }).toEqual({
      onlineSignedIn: true,
      localSignedIn: false,
      onlineUnsigned: false,
      localUnsigned: false,
    });
  });

  it('When status on a /my-games body is missing or not one of the four strings, the adapter shall treat the library parse as failed', () => {
    const valid = { groupHash: GROUP_HASH, gameNumber: GAME_ONE };
    const invalid: readonly unknown[] = [
      { ...valid },
      { ...valid, status: 'open' },
      { ...valid, status: '' },
      { ...valid, status: 'YOUR-TURN' },
      { ...valid, status: 1 },
    ];
    for (const gamesRow of invalid) {
      expect(parseMyGames({ lobbies: [], games: [gamesRow] }), JSON.stringify(gamesRow)).toBeUndefined();
    }
  });

  it('libraryStatusLabel and formatLibraryRow spell the four P45 labels', () => {
    expect(MY_GAMES_COPY).toBe('My games');
    expect(NO_GAMES_COPY).toBe('No games yet');
    for (const { status, label } of LABELS) {
      expect(libraryStatusLabel(status), status).toBe(label);
      expect(formatLibraryRow(status, GAME_ONE), status).toBe(`${label} · ${GAME_ONE}`);
    }
  });
});
