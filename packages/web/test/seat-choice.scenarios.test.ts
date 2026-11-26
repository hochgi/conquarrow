/**
 * docs/spec/seat-choice/SCENARIOS.md — the web paths (1, 5, 7) and the
 * parser. Pure lobby helpers, the host with a probed HTTP door, and the
 * shared plan check in contracts.
 *
 * @see docs/spec/seat-choice/seat-choice.md
 */

import { afterEach, describe, expect, it } from 'vitest';
import { onlinePlanProblem, labelInviteChair, type InviteSeat, type PlannedSeatKind } from '@conquarrow/contracts';
import { parseSeats } from '../src/online-parse';
import { onlinePlanCreatable } from '../src/online-pages';
import {
  PICK_YOUR_SEAT_NOTE,
  NEEDS_ANOTHER_NOTE,
  createPlanNote,
  lobbyKindOptions,
  pickerKindOptions,
} from '../src/online-shell-ui';
import {
  coerceLocalSeatPlan,
  coerceOnlineSeatPlan,
  defaultSeat,
  driverSeat,
  pickOnlineSeat,
  type LobbySeatKind,
  type SeatPlan,
} from '../src/seatPlan';
import {
  INVITE_TOKEN,
  byPath,
  createScenarioRig,
  http,
  jsonBody,
  once,
  type ScenarioRig,
} from './session-expired.scenarios.support';
import { hourToken } from './session-expired.scenarios.support';
import { makePagesHarness } from './online-web.support';

const plan = (...kinds: LobbySeatKind[]): SeatPlan => ({
  playerCount: kinds.length === 6 ? 6 : 3,
  seats: kinds.map((kind) => defaultSeat(kind)),
});
const kindsOf = (p: SeatPlan): readonly LobbySeatKind[] => p.seats.map((seat) => seat.kind);

const FIVE = ['creator', 'human', 'creator-agent', 'agent', 'heuristic'];

describe('SCENARIOS.md 1 — every online seat offers five choices', () => {
  it.each([0, 1, 2, 3, 4, 5])('seat %i, seat A included', async (index) => {
    const pages = makePagesHarness({ sessionToken: 'alice-token' });
    await pages.adapter.boot();
    pages.adapter.selectMode('online');
    expect(pages.adapter.seatKindOptionsFor(index)).toEqual(FIVE);
    expect(pickerKindOptions('online')).toEqual(FIVE);
    expect(lobbyKindOptions('online')).toEqual([
      { value: 'creator', label: 'Player (you)' },
      { value: 'human', label: 'Player' },
      { value: 'creator-agent', label: 'Agent (yours)' },
      { value: 'agent', label: 'Agent' },
      { value: 'heuristic', label: 'AI' },
    ]);
  });

  it('local is unchanged', () => {
    expect(lobbyKindOptions('local')).toEqual([
      { value: 'human', label: 'Player' },
      { value: 'heuristic', label: 'AI' },
      { value: 'byok', label: 'BYOK LLM' },
    ]);
  });
});

describe('SCENARIOS.md 1 — picking a seat', () => {
  it('alt creator: moves Player (you); the old seat becomes Player', () => {
    expect(kindsOf(pickOnlineSeat(plan('creator', 'agent', 'heuristic'), 2, 'creator'))).toEqual([
      'human',
      'agent',
      'creator',
    ]);
  });

  it('alt creator with none picked yet: only that seat changes', () => {
    expect(kindsOf(pickOnlineSeat(plan('human', 'human', 'heuristic'), 1, 'creator'))).toEqual([
      'human',
      'creator',
      'heuristic',
    ]);
  });

  it('alt creator on the seat that already holds it: no change', () => {
    expect(kindsOf(pickOnlineSeat(plan('heuristic', 'creator', 'agent'), 1, 'creator'))).toEqual([
      'heuristic',
      'creator',
      'agent',
    ]);
  });

  it.each(['human', 'creator-agent', 'agent', 'heuristic'] as const)(
    'alt %s: only that seat changes, and no pick is refused',
    (kind) => {
      expect(kindsOf(pickOnlineSeat(plan('creator', 'human', 'heuristic'), 0, kind))).toEqual([kind, 'human', 'heuristic']);
    },
  );

  it('keeps each seat’s other fields', () => {
    const before = plan('creator', 'human', 'heuristic');
    const after = pickOnlineSeat(before, 2, 'agent');
    expect(after.playerCount).toBe(3);
    expect(after.seats[0]).toBe(before.seats[0]);
    expect(after.seats[2]?.byok).toEqual(before.seats[2]?.byok);
  });
});

describe('SCENARIOS.md 1 — the plan note', () => {
  const cases: readonly [readonly PlannedSeatKind[], ReturnType<typeof onlinePlanProblem>][] = [
    [['human', 'human', 'heuristic'], 'pick-your-seat'],
    [['agent', 'creator-agent', 'heuristic'], 'pick-your-seat'],
    [['creator', 'creator', 'heuristic'], 'one-seat'],
    [['creator', 'heuristic', 'heuristic'], 'needs-another'],
    [['creator', 'human', 'heuristic'], undefined],
    [['creator', 'agent', 'heuristic'], undefined],
    [['creator', 'creator-agent', 'heuristic'], undefined],
    [['agent', 'heuristic', 'creator'], undefined],
    [['creator', 'byok', 'human'], 'byok'],
    [['creator', 'human'], 'size'],
    [['creator', 'human', 'heuristic', 'heuristic'], 'size'],
    [['heuristic', 'heuristic', 'heuristic', 'heuristic', 'heuristic', 'creator'], 'needs-another'],
    [['heuristic', 'heuristic', 'heuristic', 'heuristic', 'creator-agent', 'creator'], undefined],
  ];
  it.each(cases)('%j → %s', (kinds, problem) => {
    expect(onlinePlanProblem(kinds)).toBe(problem);
    expect(onlinePlanCreatable(kinds)).toBe(problem === undefined);
  });

  it('the note names what is missing', () => {
    expect(createPlanNote('pick-your-seat')).toBe(PICK_YOUR_SEAT_NOTE);
    expect(PICK_YOUR_SEAT_NOTE).toBe('Pick your seat: choose Player (you) on one seat.');
    expect(createPlanNote('needs-another')).toBe(NEEDS_ANOTHER_NOTE);
    expect(NEEDS_ANOTHER_NOTE).toBe('Create needs you and at least one more Player or Agent.');
    expect(createPlanNote('one-seat')).toBe(PICK_YOUR_SEAT_NOTE);
    expect(createPlanNote(undefined)).toBeUndefined();
  });
});

describe('SCENARIOS.md 1 — mode switches', () => {
  it('Local → Online never picks Player (you)', () => {
    expect(kindsOf(coerceOnlineSeatPlan(plan('human', 'heuristic', 'byok')))).toEqual(['human', 'human', 'heuristic']);
  });

  it('Online → Local: creator → Player, both agent choices → AI', () => {
    expect(kindsOf(coerceLocalSeatPlan(plan('creator', 'creator-agent', 'agent')))).toEqual([
      'human',
      'heuristic',
      'heuristic',
    ]);
    expect(kindsOf(coerceLocalSeatPlan(plan('human', 'heuristic', 'byok')))).toEqual(['human', 'heuristic', 'byok']);
  });
});

describe('A lobby pick drives a match as a driver kind', () => {
  it.each([
    ['creator', 'human'],
    ['creator-agent', 'agent'],
    ['human', 'human'],
    ['agent', 'agent'],
    ['heuristic', 'heuristic'],
    ['byok', 'byok'],
  ] as const)('%s drives as %s, other fields kept', (picked, driven) => {
    const seat = defaultSeat(picked);
    expect(driverSeat(seat)).toEqual({ ...seat, kind: driven });
  });
});

describe('SCENARIOS.md 2 / 5 — the host: create sends the choices; Start waits for reserved chairs', () => {
  let rig: ScenarioRig;
  afterEach(async () => {
    await rig.close();
  });

  it('no Player (you): Create is not offered and nothing is sent', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    rig.host.setSeatPlan(['human', 'human', 'heuristic']);
    expect(rig.host.createOffered()).toBe(false);
    await rig.host.createInvite();
    expect(byPath(rig, 'POST', '/invites')).toHaveLength(0);
  });

  it('Player (you) on seat C, Agent (yours) on A: the body carries the tokens; Start waits', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    rig.host.setSeatPlan(['creator-agent', 'human', 'creator']);
    expect(rig.host.createOffered()).toBe(true);
    const me = 'alice-user-hash';
    once(
      rig,
      'POST',
      '/invites',
      http(201, {
        token: INVITE_TOKEN,
        seats: [
          { kind: 'agent', reservedFor: me },
          { kind: 'human', userHash: 'bob' },
          { kind: 'human', userHash: me },
        ],
      }),
    );
    await rig.host.createInvite();
    expect(jsonBody(byPath(rig, 'POST', '/invites')[0])).toEqual({ seats: ['creator-agent', 'human', 'creator'] });
    expect(rig.host.startOffered()).toBe(false);
  });
});

describe('SCENARIOS.md 7 — a reserved chair', () => {
  const reserved: InviteSeat = { kind: 'agent', reservedFor: 'alice' };
  it('reads "your agent (waiting)" for its owner', () => {
    expect(labelInviteChair({ letter: 'B', chair: reserved, userHash: 'alice' })).toBe('your agent (waiting)');
  });
  it('reads "waiting" for anyone else and signed out', () => {
    expect(labelInviteChair({ letter: 'B', chair: reserved, userHash: 'bob' })).toBe('waiting');
    expect(labelInviteChair({ letter: 'B', chair: reserved, userHash: undefined })).toBe('waiting');
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'agent' }, userHash: undefined })).toBe('waiting');
  });
  it('once bound it is "your agent"', () => {
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'agent', userHash: 'alice' }, userHash: 'alice' })).toBe(
      'your agent',
    );
  });
});

describe('The web parser keeps reservedFor on an agent chair only', () => {
  it('agent keeps it; human and non-string drop it', () => {
    expect(
      parseSeats([
        { kind: 'agent', reservedFor: 'alice' },
        { kind: 'human', reservedFor: 'alice' },
        { kind: 'agent', reservedFor: 7 },
        { kind: 'agent', reservedFor: '' },
      ]),
    ).toEqual([{ kind: 'agent', reservedFor: 'alice' }, { kind: 'human' }, { kind: 'agent' }, { kind: 'agent' }]);
  });
});
