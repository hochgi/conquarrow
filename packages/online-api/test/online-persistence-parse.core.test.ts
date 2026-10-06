/**
 * The persisted records round-trip: what a writer puts in S3 is what a reader
 * gets back, field for field, optional fields included.
 *
 * - `state.json` — `persistEnvelope` → `parsePersistedEnvelope`.
 * - `invite.json` — `serializeInvite` → `parseInvite`.
 * - `meta.json` — written by the start handler, read by `parseGameMeta`.
 * - `log.jsonl` — `stampLogLine` → `parseLogLine`, plus the pre-P49 bare line.
 *
 * The P69 scenarios (docs/spec/online-hardening/online-hardening.core.feature,
 * Rule: A valid stored position still loads) live here too: the stricter
 * loader must keep reading every position the engine writes, and the pre-P36
 * retired streak pair.
 */

import { describe, expect, it } from 'vitest';
import type { InviteSeat } from '@conquarrow/contracts';
import { endTurn, mintArrowId, mintPlayerId, step } from '@conquarrow/contracts';
import { parseLogLine, stampLogLine } from '../src/game-log';
import { parsePersistedEnvelope, persistEnvelope } from '../src/game-snapshot';
import type { InviteRecord, InviteStatus } from '../src/invite-record';
import { parseGameMeta, parseInvite, serializeInvite } from '../src/invite-record';
import {
  envelopeOf,
  hardeningBackground,
  realStates,
  seatAt,
  withRetiredStreakPair,
} from './online-persistence-parse.support';

describe('state.json round-trips — Scenario: Every valid stored position loads unchanged', () => {
  for (const [name, state] of realStates()) {
    it(`restores every field of ${name}`, () => {
      const parsed = parsePersistedEnvelope(persistEnvelope(7, state));

      expect(parsed?.version).toBe(7);
      expect(parsed?.game).toStrictEqual(state);
    });
  }

  it('keeps the version an envelope was written at, zero included', () => {
    const [, state] = realStates()[0] ?? [];
    if (state === undefined) throw new Error('setup: no state');

    expect(parsePersistedEnvelope(persistEnvelope(0, state))?.version).toBe(0);
  });
});

describe('Online hardening — Rule: A valid stored position still loads', () => {
  it('Scenario: A pre-P36 position with a retired streak pair still loads', () => {
    const background = hardeningBackground();
    const holder = seatAt(background, 1);

    const parsed = parsePersistedEnvelope(envelopeOf(withRetiredStreakPair(background, holder, 3)));

    expect(parsed?.game.starvationStreaks.get(mintPlayerId(holder))).toBe(3);
  });
});

describe('invite.json round-trips', () => {
  const seatPlans: readonly (readonly [string, readonly InviteSeat[]])[] = [
    ['an all-unbound plan', [{ kind: 'human' }, { kind: 'human' }, { kind: 'heuristic' }]],
    [
      'a host-bound plan',
      [{ kind: 'heuristic' }, { kind: 'human', userHash: 'a1' }, { kind: 'human' }],
    ],
    [
      'a fully bound plan',
      [
        { kind: 'human', userHash: 'a1' },
        { kind: 'human', userHash: 'b2' },
        { kind: 'human', userHash: 'c3' },
      ],
    ],
  ];
  const statuses: readonly InviteStatus[] = ['open', 'revoked', 'started'];

  for (const status of statuses) {
    for (const [name, seats] of seatPlans) {
      it(`restores a ${status} invite with ${name}`, () => {
        const invite: InviteRecord = { status, creatorUserHash: 'creator', seats };

        expect(parseInvite(serializeInvite(invite))).toStrictEqual(invite);
      });
    }
  }

  it('restores the game number a started invite points at', () => {
    const invite: InviteRecord = {
      status: 'started',
      creatorUserHash: 'creator',
      seats: [{ kind: 'human', userHash: 'a1' }, { kind: 'human', userHash: 'b2' }],
      gameNumber: '000042',
    };

    expect(parseInvite(serializeInvite(invite))).toStrictEqual(invite);
  });
});

describe('meta.json parses', () => {
  const seats = [{ kind: 'human', userHash: 'a1' }, { kind: 'heuristic' }, { kind: 'human' }];

  it('reads every field a started game writes', () => {
    const meta = {
      seats,
      winner: 'p1',
      inviteToken: 'tok',
      players: ['p0', 'p1', 'p2'],
      activePlayer: 'p2',
      lostPlayers: ['p0'],
      startedAt: '2026-10-06T10:00:00.000Z',
    };

    expect(parseGameMeta(JSON.stringify(meta))).toStrictEqual(meta);
  });

  it('reads a pre-P46 meta that has seats and nothing else', () => {
    expect(parseGameMeta(JSON.stringify({ seats }))).toStrictEqual({ seats });
  });
});

describe('log.jsonl lines round-trip', () => {
  const moves = [
    ['a step', step(mintArrowId('from'), mintArrowId('exit'), 2)],
    ['an end of turn', endTurn()],
  ] as const;

  for (const [name, move] of moves) {
    it(`restores the version stamp and ${name}`, () => {
      expect(parseLogLine(stampLogLine(12, move))).toStrictEqual({ v: 12, move });
    });

    it(`reads a pre-P49 bare line of ${name} as unstamped`, () => {
      expect(parseLogLine(JSON.stringify(move))).toStrictEqual({ move });
    });
  }
});
