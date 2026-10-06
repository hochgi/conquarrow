/**
 * Malformed persisted records are refused, one corrupted field at a time.
 *
 * Each table starts from a valid stored record and breaks exactly one thing, so
 * a row that hydrates names the guard that let it through. A reader that
 * refuses returns `undefined` — it does not throw, and it does not hand back a
 * half-built value the engine or a handler would then trip over.
 */

import { describe, expect, it } from 'vitest';
import type { InviteSeat, PlannedSeatKind } from '@conquarrow/contracts';
import { parseLogLine } from '../src/game-log';
import { parsePersistedEnvelope } from '../src/game-snapshot';
import {
  asRecord,
  firstHumanIndex,
  indexOfBoundUser,
  nextUnboundHumanIndex,
  parseGameMeta,
  parseInvite,
  parseKinds,
  seatsEqual,
} from '../src/invite-record';
import {
  decoratedMatch,
  storedStateOf,
  withFirstItem,
  withFirstItemField,
  without,
} from './online-persistence-parse.support';

const envelopeOf = (state: unknown, version: unknown = 1): string =>
  JSON.stringify({ version, state });

describe('state.json: a malformed envelope is refused', () => {
  const valid = storedStateOf(decoratedMatch());
  const rows: readonly (readonly [string, string])[] = [
    ['text that is not JSON', '{"version":1,'],
    ['a JSON null', 'null'],
    ['a JSON list', '[]'],
    ['no version', JSON.stringify({ state: valid })],
    ['a string version', envelopeOf(valid, '3')],
    ['a fractional version', envelopeOf(valid, 1.5)],
    ['a negative version', envelopeOf(valid, -1)],
    ['a valid version over no state', JSON.stringify({ version: 1 })],
    ['a valid version over a state that does not hydrate', envelopeOf(without(valid, 'players'))],
  ];

  for (const [name, raw] of rows) {
    it(`refuses ${name}`, () => {
      expect(parsePersistedEnvelope(raw)).toBeUndefined();
    });
  }
});

describe('state.json: a malformed position is refused', () => {
  const valid = storedStateOf(decoratedMatch());
  const players = valid['players'] as readonly string[];
  const listSections = ['groups', 'trails', 'territory', 'accumulators', 'spawners'] as const;

  const rows: (readonly [string, unknown])[] = [
    ['a null position', null],
    ['a list for a position', []],
    ['no players', without(valid, 'players')],
    ['players that are not a list', { ...valid, players: {} }],
    ['a player that is not a string', { ...valid, players: [...players, 7] }],
    ['an active player that is not a string', { ...valid, activePlayer: 7 }],
    ['no dominationN', without(valid, 'dominationN')],
    ['a dominationN that is not a number', { ...valid, dominationN: '5' }],
    ['starvationStreaks that are not a list', { ...valid, starvationStreaks: {} }],
    ['a streak entry that is null', withFirstItem(valid, 'starvationStreaks', null)],
    ['a streak seat that is not a string', withFirstItemField(valid, 'starvationStreaks', 'player', 7)],
    ['a streak that is not a number', withFirstItemField(valid, 'starvationStreaks', 'streak', '2')],
    ['a group arrow that is not a string', withFirstItemField(valid, 'groups', 'arrow', 7)],
    ['a group owner that is not a string', withFirstItemField(valid, 'groups', 'owner', 7)],
    ['group heads that are not a number', withFirstItemField(valid, 'groups', 'heads', '1')],
    ['group spent that is not a number', withFirstItemField(valid, 'groups', 'spent', '0')],
    ['a trail seat that is not a string', withFirstItemField(valid, 'trails', 'player', 7)],
    ['trail arrows that are not a list', withFirstItemField(valid, 'trails', 'arrows', 'a1')],
    ['a trail arrow that is not a string', withFirstItemField(valid, 'trails', 'arrows', [7])],
    ['a territory arrow that is not a string', withFirstItemField(valid, 'territory', 'arrow', 7)],
    ['a territory owner that is not a string', withFirstItemField(valid, 'territory', 'owner', 7)],
    ['an accumulator arrow that is not a string', withFirstItemField(valid, 'accumulators', 'arrow', 7)],
    ['an accumulator num that is not a number', withFirstItemField(valid, 'accumulators', 'num', '1')],
    ['an accumulator den that is not a number', withFirstItemField(valid, 'accumulators', 'den', '1')],
    ['a spawner vertex that is not a string', withFirstItemField(valid, 'spawners', 'vertex', 7)],
    ['a spawner num that is not a number', withFirstItemField(valid, 'spawners', 'num', '1')],
    ['a spawner den that is not a number', withFirstItemField(valid, 'spawners', 'den', '3')],
    ['a spawner phase that is not a number', withFirstItemField(valid, 'spawners', 'phase', '0')],
  ];
  for (const section of listSections) {
    rows.push([`no ${section}`, without(valid, section)]);
    rows.push([`${section} that are not a list`, { ...valid, [section]: {} }]);
    rows.push([`a ${section} entry that is null`, withFirstItem(valid, section, null)]);
  }

  for (const [name, state] of rows) {
    it(`refuses ${name}`, () => {
      expect(parsePersistedEnvelope(envelopeOf(state))).toBeUndefined();
    });
  }
});

describe('invite.json: a malformed invite is refused', () => {
  const valid = {
    status: 'open',
    creatorUserHash: 'creator',
    seats: [{ kind: 'human', userHash: 'a1' }, { kind: 'human' }, { kind: 'heuristic' }],
  };
  const rows: readonly (readonly [string, string])[] = [
    ['text that is not JSON', '{"status":'],
    ['a JSON null', 'null'],
    ['a JSON list', '[]'],
    ['no status', JSON.stringify(without(valid, 'status'))],
    ['an unknown status', JSON.stringify({ ...valid, status: 'paused' })],
    ['no creator', JSON.stringify(without(valid, 'creatorUserHash'))],
    ['a creator that is not a string', JSON.stringify({ ...valid, creatorUserHash: 7 })],
    ['no seats', JSON.stringify(without(valid, 'seats'))],
    ['seats that are not a list', JSON.stringify({ ...valid, seats: {} })],
    ['a seat that is null', JSON.stringify({ ...valid, seats: [null, ...valid.seats] })],
    ['a seat of unknown kind', JSON.stringify({ ...valid, seats: [{ kind: 'robot' }] })],
    ['a byok seat', JSON.stringify({ ...valid, seats: [{ kind: 'byok' }] })],
  ];

  for (const [name, raw] of rows) {
    it(`refuses ${name}`, () => {
      expect(parseInvite(raw)).toBeUndefined();
    });
  }

  it('never reads a userHash that is not a string as a bound seat', () => {
    const raw = JSON.stringify({ ...valid, seats: [{ kind: 'human', userHash: 7 }] });

    expect(parseInvite(raw)?.seats).toStrictEqual([{ kind: 'human' }]);
  });
});

describe('meta.json: malformed fields', () => {
  const seats = [{ kind: 'human', userHash: 'a1' }, { kind: 'human' }];
  const library = { players: ['p0', 'p1'], activePlayer: 'p1', lostPlayers: [] };

  const refused: readonly (readonly [string, string])[] = [
    ['text that is not JSON', '{"seats":'],
    ['a JSON null', 'null'],
    ['no seats', JSON.stringify({ winner: 'p0' })],
    ['a seat of unknown kind', JSON.stringify({ seats: [{ kind: 'robot' }] })],
  ];
  for (const [name, raw] of refused) {
    it(`refuses ${name}`, () => {
      expect(parseGameMeta(raw)).toBeUndefined();
    });
  }

  const brokenLibrary: readonly (readonly [string, Record<string, unknown>])[] = [
    ['players are not a list', { ...library, players: 'p0' }],
    ['a player is not a string', { ...library, players: ['p0', 7] }],
    ['lostPlayers are missing', without(library, 'lostPlayers')],
    ['a lost player is not a string', { ...library, lostPlayers: [7] }],
    ['the active player is missing', without(library, 'activePlayer')],
    ['the active player is not a string', { ...library, activePlayer: 7 }],
  ];
  for (const [name, fields] of brokenLibrary) {
    it(`drops the whole library summary when ${name}`, () => {
      expect(parseGameMeta(JSON.stringify({ seats, ...fields }))).toStrictEqual({ seats });
    });
  }

  const ignoredScalars: readonly (readonly [string, Record<string, unknown>])[] = [
    ['a winner that is not a string', { winner: 7 }],
    ['an invite token that is not a string', { inviteToken: 7 }],
    ['a start time that is not a string', { startedAt: 7 }],
    ['an empty start time', { startedAt: '' }],
  ];
  for (const [name, fields] of ignoredScalars) {
    it(`reads ${name} as absent`, () => {
      expect(parseGameMeta(JSON.stringify({ seats, ...fields }))).toStrictEqual({ seats });
    });
  }
});

describe('log.jsonl: a malformed line', () => {
  const refused: readonly (readonly [string, string])[] = [
    ['text that is not JSON', '{"v":1,'],
    ['a JSON null', 'null'],
    ['a bare number', '7'],
    ['a stamped line whose move is not an object', '{"v":1,"move":7}'],
    ['a stamped line whose move is null', '{"v":1,"move":null}'],
  ];
  for (const [name, raw] of refused) {
    it(`refuses ${name}`, () => {
      expect(parseLogLine(raw)).toBeUndefined();
    });
  }

  const unstamped: readonly (readonly [string, unknown])[] = [
    ['a string stamp', '3'],
    ['a fractional stamp', 1.5],
  ];
  for (const [name, v] of unstamped) {
    it(`reads ${name} as unstamped, so it is never served`, () => {
      const move = { kind: 'endTurn' };

      expect(parseLogLine(JSON.stringify({ v, move }))).toStrictEqual({ move });
    });
  }
});

describe('asRecord accepts only a plain object', () => {
  const refused: readonly (readonly [string, unknown])[] = [
    ['null', null],
    ['undefined', undefined],
    ['a list', []],
    ['a string', 'seats'],
    ['a number', 7],
  ];
  for (const [name, value] of refused) {
    it(`refuses ${name}`, () => {
      expect(asRecord(value)).toBeUndefined();
    });
  }

  it('returns an object as itself', () => {
    const value = { seats: [] };

    expect(asRecord(value)).toBe(value);
  });
});

describe('seat plans and seat lookups', () => {
  it('reads every planned seat kind, byok included', () => {
    const kinds = ['human', 'heuristic', 'byok'];

    expect(parseKinds(kinds)).toStrictEqual(kinds);
  });

  it('refuses a plan with an unknown seat kind', () => {
    expect(parseKinds(['human', 'robot'])).toBeUndefined();
  });

  it('finds the first human seat past leading heuristics', () => {
    const kinds: readonly PlannedSeatKind[] = ['heuristic', 'heuristic', 'human', 'human'];

    expect(firstHumanIndex(kinds)).toBe(2);
  });

  it('reports no human seat as -1', () => {
    expect(firstHumanIndex(['heuristic', 'heuristic'])).toBe(-1);
  });

  const seats: readonly InviteSeat[] = [
    { kind: 'human', userHash: 'a1' },
    { kind: 'heuristic' },
    { kind: 'human', userHash: 'b2' },
    { kind: 'human' },
  ];

  it('finds a bound user at their own seat', () => {
    expect(indexOfBoundUser(seats, 'b2')).toBe(2);
  });

  it('reports an unbound user as -1', () => {
    expect(indexOfBoundUser(seats, 'zz')).toBe(-1);
  });

  it('finds the first unbound human seat past bound ones', () => {
    expect(nextUnboundHumanIndex(seats)).toBe(3);
  });

  it('reports a fully bound plan as having no unbound seat', () => {
    expect(nextUnboundHumanIndex(seats.slice(0, 3))).toBe(-1);
  });
});

describe('seatsEqual', () => {
  const plan: readonly InviteSeat[] = [
    { kind: 'human', userHash: 'a1' },
    { kind: 'heuristic' },
    { kind: 'human' },
  ];
  const rows: readonly (readonly [string, readonly InviteSeat[] | undefined, boolean])[] = [
    ['the same plan', [...plan], true],
    ['no plan at all', undefined, false],
    ['a shorter plan', plan.slice(0, 2), false],
    ['a longer plan', [...plan, { kind: 'heuristic' }], false],
    ['a human where a heuristic sat', [plan[0] ?? { kind: 'human' }, { kind: 'human' }, plan[2] ?? { kind: 'human' }], false],
    ['a different user on a bound seat', [{ kind: 'human', userHash: 'b2' }, ...plan.slice(1)], false],
    ['an unbound seat where a user was bound', [{ kind: 'human' }, ...plan.slice(1)], false],
    ['a bound seat where none was', [...plan.slice(0, 2), { kind: 'human', userHash: 'c3' }], false],
  ];
  for (const [name, left, expected] of rows) {
    it(`${expected ? 'matches' : 'does not match'} ${name}`, () => {
      expect(seatsEqual(left, plan)).toBe(expected);
    });
  }
});
