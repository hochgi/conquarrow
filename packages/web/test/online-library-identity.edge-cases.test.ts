/**
 * docs/spec/online-library-identity/online-library-identity.edge-cases.feature — adapter/shell.
 *
 * @see docs/spec/online-library-identity/online-library-identity.md
 */

import { describe, expect, it } from 'vitest';
import { parseMyGames } from '../src/online-parse';
import { formatLibraryStartedAt } from '../src/online-shell-ui';
import { GAME_ONE, GROUP_HASH } from './online-web.support';

const validSeats = [
  { kind: 'human', label: 'Player A', you: true },
  { kind: 'human', label: 'Player B', you: false },
  { kind: 'heuristic', label: 'AI', you: false },
] as const;

describe('Missing time and parse', () => {
  it('Pre-P46 meta omits startedAt', () => {
    expect(formatLibraryStartedAt(undefined)).toBeUndefined();
  });

  it('Missing seats fails the library parse', () => {
    expect(
      parseMyGames({
        lobbies: [],
        games: [
          {
            groupHash: GROUP_HASH,
            gameNumber: GAME_ONE,
            status: 'waiting',
            seatIndex: 0,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('Missing seatIndex fails the library parse', () => {
    expect(
      parseMyGames({
        lobbies: [],
        games: [
          {
            groupHash: GROUP_HASH,
            gameNumber: GAME_ONE,
            status: 'waiting',
            seats: validSeats,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('Out-of-range seatIndex fails the library parse', () => {
    expect(
      parseMyGames({
        lobbies: [],
        games: [
          {
            groupHash: GROUP_HASH,
            gameNumber: GAME_ONE,
            status: 'waiting',
            seats: validSeats,
            seatIndex: 3,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('More than six seats fails the library parse', () => {
    const seven = [
      ...validSeats,
      { kind: 'human', label: 'Player D', you: false },
      { kind: 'human', label: 'Player E', you: false },
      { kind: 'human', label: 'Player F', you: false },
      { kind: 'heuristic', label: 'AI', you: false },
    ];
    expect(
      parseMyGames({
        lobbies: [],
        games: [
          {
            groupHash: GROUP_HASH,
            gameNumber: GAME_ONE,
            status: 'waiting',
            seats: seven,
            seatIndex: 0,
          },
        ],
      }),
    ).toBeUndefined();
  });
});
