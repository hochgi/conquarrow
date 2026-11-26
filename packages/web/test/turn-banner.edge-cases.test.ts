/**
 * docs/spec/turn-banner/turn-banner.edge-cases.feature
 *
 * One it() per Gherkin scenario. Each Scenario Outline is an it.each over every
 * Examples row. The truth table iterates the full product, not a sample.
 * Pure helpers — no DOM, no test-kit.
 */

import { describe, expect, it } from 'vitest';
import type { PauseKind } from '../src/botPause';
import { parseSeats } from '../src/online-parse';
import type { SeatKind } from '../src/seatPlan';
import {
  localConfigKind,
  localTurnSeat,
  onlineTurnSeat,
  turnBannerCopy,
  type TurnRelation,
  type TurnSeatKind,
} from '../src/turnBanner';
import {
  copyInput,
  expectNoOwner,
  isYouCase,
  product,
  readTurn,
  rowLabel,
  thinkingOn,
  YOU_SUFFIX,
  YOUR_TURN_PREFIX,
} from './turn-banner.support';

const LOCAL_ROWS = [
  {
    kind: 'human',
    relation: 'caller-human',
    pause: 'manual',
    busy: false,
    byok: false,
    suffix: ' · paused',
    hint: 'Paused — bots will not move until you resume',
  },
  {
    kind: 'human',
    relation: 'caller-human',
    pause: 'idle',
    busy: false,
    byok: false,
    suffix: ' · paused',
    hint: 'Paused — this tab is in the background',
  },
  {
    kind: 'heuristic',
    relation: 'other',
    pause: 'running',
    busy: true,
    byok: false,
    suffix: ' · ai',
    hint: 'AI seat is moving…',
  },
  {
    kind: 'heuristic',
    relation: 'other',
    pause: 'running',
    busy: false,
    byok: false,
    suffix: ' · ai',
    hint: 'AI seat is moving…',
  },
  {
    kind: 'byok',
    relation: 'other',
    pause: 'running',
    busy: true,
    byok: true,
    suffix: ' · llm',
    hint: 'LLM seat is thinking…',
  },
  {
    kind: 'byok',
    relation: 'other',
    pause: 'running',
    busy: false,
    byok: true,
    suffix: ' · llm',
    hint: 'LLM seat is thinking…',
  },
  {
    kind: 'human',
    relation: 'caller-human',
    pause: 'running',
    busy: true,
    byok: false,
    suffix: ' · ai',
    hint: 'AI seat is moving…',
  },
  {
    kind: 'human',
    relation: 'caller-human',
    pause: 'running',
    busy: false,
    byok: false,
    suffix: ' · you',
    hint: 'Your turn — gold-outlined stacks can still move',
  },
  {
    kind: 'agent',
    relation: 'caller-agent',
    pause: 'running',
    busy: false,
    byok: false,
    suffix: ' · ai',
    hint: 'AI seat is moving…',
  },
  {
    kind: 'human',
    relation: 'other',
    pause: 'running',
    busy: false,
    byok: false,
    // The feature cell "(empty)" is the empty string, not the word empty.
    suffix: '',
    hint: 'Gold-outlined stacks can still move',
  },
] as const satisfies readonly {
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly pause: PauseKind;
  readonly busy: boolean;
  readonly byok: boolean;
  readonly suffix: string;
  readonly hint: string;
}[];

/** Outline rows for "Every non-human local kind is other". */
const NON_HUMAN_LOCAL_KINDS = [
  { kind: 'heuristic' },
  { kind: 'byok' },
  { kind: 'agent' },
] as const satisfies readonly { readonly kind: SeatKind }[];

/** P105: the chair's `name`. A blank owner cell means the name is absent, not the empty string. */
const NAME_ROWS = [
  { name: 'Ada', owner: 'Ada' },
  { name: '', owner: undefined },
  { name: ' ', owner: undefined },
  { name: ' Ada ', owner: 'Ada' },
  { name: 'you', owner: undefined },
  { name: 'Player B', owner: undefined },
] as const;

const seatName = (seat: object): string | undefined => {
  if (!Object.hasOwn(seat, 'name')) return undefined;
  const value = (seat as Record<string, unknown>)['name'];
  return typeof value === 'string' ? value : undefined;
};

describe('Turn-banner boundaries', () => {
  describe('The truth table never says you unless it is the caller\'s human seat', () => {
    it('Every kind, relation, replay flag, and venue obeys the you-rule and the indicator rule', () => {
      // The you-suffix is space, U+00B7, space, you. A substring of the banner is not the check.
      expect(YOU_SUFFIX.charCodeAt(0)).toBe(0x20);
      expect(YOU_SUFFIX.charCodeAt(1)).toBe(0xb7);
      expect(YOU_SUFFIX.charCodeAt(2)).toBe(0x20);
      expect(YOU_SUFFIX.slice(3)).toBe('you');

      const rows = product();
      // 4 kinds × 3 relations × 2 replay flags × 3 readings.
      expect(rows).toHaveLength(4 * 3 * 2 * 3);
      expect(rows.filter(isYouCase)).toHaveLength(4);
      expect(rows.filter(thinkingOn)).toHaveLength(11);

      let sawYourAgent = false;
      for (const row of rows) {
        const copy = turnBannerCopy(copyInput(row));
        const suffixClaimsYou = copy.suffix === YOU_SUFFIX;
        const hintClaimsYou = copy.hint.startsWith(YOUR_TURN_PREFIX);
        const label = rowLabel(row);

        expect(suffixClaimsYou, label).toBe(isYouCase(row));
        expect(hintClaimsYou, label).toBe(isYouCase(row));
        expect(copy.thinking, label).toBe(thinkingOn(row));

        // `your agent` contains the letters y-o-u and is not the word you.
        if (copy.suffix.includes('your agent') || copy.banner.includes('your agent')) {
          sawYourAgent = true;
          expect(suffixClaimsYou, label).toBe(false);
          expect(hintClaimsYou, label).toBe(false);
        }
      }
      expect(sawYourAgent).toBe(true);
    });
  });

  describe('Local versus-bot suffixes', () => {
    it.each(LOCAL_ROWS)(
      'The first matching local row wins ($kind, $relation, $pause, busy $busy, byok $byok)',
      ({ kind, relation, pause, busy, byok, suffix, hint }) => {
        const copy = readTurn({
          venue: 'local',
          letter: 'A',
          kind,
          relation,
          vsBot: true,
          pause,
          botBusy: busy,
          byokActive: byok,
          phase: 'idle',
          movableCount: 1,
        });

        expect(copy.suffix).toBe(suffix);
        expect(copy.hint).toBe(hint);
        expect(copy.thinking).toBe(false);
      },
    );

    it('A local bot that is not busy yet does not say you', () => {
      const copy = readTurn({
        venue: 'local',
        letter: 'C',
        kind: 'heuristic',
        relation: 'other',
        vsBot: true,
        pause: 'running',
        botBusy: false,
      });

      expect(copy.suffix).toBe(' · ai');
      expect(copy.hint.startsWith('Your turn')).toBe(false);
      expect(copy.suffix).not.toBe(' · you');
    });
  });

  describe('Online hints do not leak the caller\'s phase', () => {
    it('Another seat\'s route hint is replaced by waiting', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'C',
        kind: 'heuristic',
        relation: 'other',
        phase: 'route',
        routeHint: 'Drag to extend the route',
      });

      expect(copy.hint).toBe('Waiting for C…');
      expect(copy.hint).not.toContain('route');
    });

    it('The caller\'s empty turn keeps the passing sentence and still says you', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'A',
        kind: 'human',
        relation: 'caller-human',
        phase: 'idle',
        movableCount: 0,
      });

      expect(copy.banner).toBe('Turn: A · you');
      expect(copy.hint).toBe('No steps left — passing…');
      expect(copy.thinking).toBe(false);
    });

    it('The caller\'s route keeps the route hint', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'A',
        kind: 'human',
        relation: 'caller-human',
        phase: 'route',
        routeHint: 'Drag to extend the route',
      });

      expect(copy.hint).toBe('Drag to extend the route');
      expect(copy.suffix).toBe(' · you');
    });

    it('A blocked caller keeps the blocked sentence', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'A',
        kind: 'human',
        relation: 'caller-human',
        phase: 'blocked',
      });

      expect(copy.hint).toBe(
        'This stack has nowhere to go. Another gold stack is auto-selected when one finishes',
      );
    });

    it('caller-human on a non-human kind does not say you', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'C',
        kind: 'agent',
        relation: 'caller-human',
      });

      expect(copy.suffix).not.toBe(' · you');
      expect(copy.hint.startsWith('Your turn')).toBe(false);
      expect(copy.banner).toBe("Turn: C · C's agent is playing…");
    });

    it('caller-agent on a human kind does not say your agent', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'B',
        kind: 'human',
        relation: 'caller-agent',
      });

      expect(copy.banner).toBe('Turn: B · B is playing…');
      expect(copy.hint).toBe('Waiting for B…');
    });

    it('An online byok kind says the AI is playing', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'C',
        kind: 'byok',
        relation: 'other',
      });

      expect(copy.banner).toBe('Turn: C · AI is playing…');
      expect(copy.hint).toBe('Waiting for C…');
      expect(copy.suffix).not.toBe(' · you');
    });

    it('A blank owner name falls back to the letter', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'B',
        kind: 'agent',
        relation: 'other',
        ownerName: '  ',
      });

      expect(copy.banner).toBe("Turn: B · B's agent is playing…");
    });

    it('A name ending in s still takes \'s', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'B',
        kind: 'agent',
        relation: 'other',
        ownerName: 'Chris',
      });

      expect(copy.banner).toBe("Turn: B · Chris's agent is playing…");
    });
  });

  describe('Missing online facts never say you', () => {
    it('Missing seats derive other', () => {
      const seat = onlineTurnSeat({
        userHash: 'me',
        players: ['A', 'B', 'C'],
        active: 'B',
      });

      expect(seat.letter).toBe('B');
      expect(seat.kind).toBe('human');
      expect(seat.relation).toBe('other');
      expectNoOwner(seat);
    });

    it('A missing caller hash still reads the kind', () => {
      const seat = onlineTurnSeat({
        seats: [
          { kind: 'human', userHash: 'me' },
          { kind: 'agent', userHash: 'them', name: 'Bea' },
          { kind: 'heuristic' },
        ],
        players: ['A', 'B', 'C'],
        active: 'B',
      });

      expect(seat.letter).toBe('B');
      expect(seat.kind).toBe('agent');
      expect(seat.relation).toBe('other');
      expect(seat.ownerName).toBe('Bea');
    });

    it('An active id that is not in the players is other', () => {
      const seat = onlineTurnSeat({
        seats: [
          { kind: 'human', userHash: 'me' },
          { kind: 'agent', userHash: 'me', name: 'Ada' },
          { kind: 'heuristic' },
        ],
        userHash: 'me',
        players: ['A', 'B', 'C'],
        active: 'D',
      });

      expect(seat.letter).toBe('D');
      expect(seat.kind).toBe('human');
      expect(seat.relation).toBe('other');
      expectNoOwner(seat);
    });

    it('A short seats array does not invent a chair', () => {
      const seat = onlineTurnSeat({
        seats: [
          { kind: 'human', userHash: 'me' },
          { kind: 'agent', userHash: 'me', name: 'Ada' },
        ],
        userHash: 'me',
        players: ['A', 'B', 'C'],
        active: 'C',
      });

      expect(seat.letter).toBe('C');
      expect(seat.kind).toBe('human');
      expect(seat.relation).toBe('other');
      expectNoOwner(seat);
    });

    it.each(NAME_ROWS)(
      'An agent name yields an owner name only when it is usable ($name)',
      ({ name, owner }) => {
        // The one agent seat is the active chair: seat 0 is players[0].
        const seat = onlineTurnSeat({
          seats: [{ kind: 'agent', name }],
          userHash: 'me',
          players: ['A'],
          active: 'A',
        });

        if (owner === undefined) {
          expectNoOwner(seat);
          return;
        }
        expect(seat.ownerName).toBe(owner);
      },
    );

    it('An unbound agent is not yours', () => {
      const seat = onlineTurnSeat({
        seats: [{ kind: 'agent', name: 'Ada' }],
        userHash: 'me',
        players: ['A'],
        active: 'A',
      });

      expect(seat.relation).toBe('other');
      expect(seat.ownerName).toBe('Ada');
    });

    it('An agent hash match is yours even with no human chair', () => {
      const seat = onlineTurnSeat({
        seats: [
          { kind: 'agent', userHash: 'me', name: 'Ada' },
          { kind: 'heuristic' },
        ],
        userHash: 'me',
        players: ['A', 'B'],
        active: 'A',
      });

      expect(seat.relation).toBe('caller-agent');
      expect(seat.ownerName).toBe('Ada');
    });

    it('A human hash that is not the caller\'s is other', () => {
      const seat = onlineTurnSeat({
        seats: [{ kind: 'human', userHash: 'them' }],
        userHash: 'me',
        players: ['A'],
        active: 'A',
      });

      expect(seat.relation).toBe('other');
      expect(seat.kind).toBe('human');
    });
  });

  describe('A local chair is derived, and an unknown one is not the caller', () => {
    it('A local human config is the caller, and it wins over the log', () => {
      const seat = localTurnSeat({
        configKind: 'human',
        logSeats: [{ player: 'A', kind: 'heuristic' }],
        active: 'A',
      });

      expect(seat.kind).toBe('human');
      expect(seat.relation).toBe('caller-human');
      expect(Object.hasOwn(seat, 'ownerName')).toBe(false);
    });

    it('A local bot with no config is other', () => {
      const seat = localTurnSeat({
        configKind: undefined,
        logSeats: [{ player: 'C', kind: 'heuristic' }],
        active: 'C',
      });

      expect(seat.kind).toBe('heuristic');
      expect(seat.relation).toBe('other');
      expect(Object.hasOwn(seat, 'ownerName')).toBe(false);
    });

    it.each(NON_HUMAN_LOCAL_KINDS)('Every non-human local kind is other ($kind)', ({ kind }) => {
      const seat = localTurnSeat({
        configKind: kind,
        logSeats: [],
        active: 'B',
      });

      expect(seat.kind).toBe(kind);
      expect(seat.relation).toBe('other');
      expect(Object.hasOwn(seat, 'ownerName')).toBe(false);
    });

    it('An unknown local chair is not the caller', () => {
      // A and B are in the log. C is not, so this is not a match and not the caller.
      const seat = localTurnSeat({
        configKind: undefined,
        logSeats: [
          { player: 'A', kind: 'heuristic' },
          { player: 'B', kind: 'agent' },
        ],
        active: 'C',
      });

      expect(seat.kind).toBe('human');
      expect(seat.relation).toBe('other');
      expect(seat.relation).not.toBe('caller-human');
      expect(Object.hasOwn(seat, 'ownerName')).toBe(false);
    });

    it('No seat config yields no kind', () => {
      expect(localConfigKind(undefined)).toBeUndefined();
    });

    it('A heuristic seat config yields heuristic', () => {
      expect(localConfigKind({ kind: 'heuristic' })).toBe('heuristic');
    });
  });

  describe('The parser keeps the name the server sends (P105)', () => {
    it('A name survives parsing on an agent and a human, and a label never does', () => {
      const raw: unknown = [
        { kind: 'agent', userHash: 'me', name: 'Ada' },
        { kind: 'human', userHash: 'ada', name: 'Ada', label: 'Ada' },
        { kind: 'heuristic', label: 'AI', name: 'AI' },
      ];
      const seats = parseSeats(raw);
      expect(seats).toHaveLength(3);
      const agent = seats?.[0];
      const human = seats?.[1];
      const heuristic = seats?.[2];
      if (agent === undefined || human === undefined || heuristic === undefined) {
        throw new Error('setup: parsed seats are missing');
      }

      expect(agent.kind).toBe('agent');
      expect(seatName(agent)).toBe('Ada');
      expect(Object.hasOwn(agent, 'label')).toBe(false);
      expect(human.kind).toBe('human');
      expect(seatName(human)).toBe('Ada');
      expect(Object.hasOwn(human, 'label')).toBe(false);
      expect(heuristic).toStrictEqual({ kind: 'heuristic' });
    });
  });
});
