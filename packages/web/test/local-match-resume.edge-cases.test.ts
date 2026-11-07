/**
 * P90 — resume a local match. Rejections, excluded modes, a save that must
 * not resume, and a backing that throws.
 */

import { describe, expect, it } from 'vitest';
import { mintPlayerId } from '@conquarrow/contracts';
import { createMatchLog, serializeMatchLog } from '../src/matchLog';
import type { MatchLog } from '../src/matchLog';
import {
  LEAVE_MATCH_CONFIRM,
  LOCAL_RESUME_MODE,
  createResumeStore,
  isResumable,
  leaveChoice,
  parseResumeLog,
  persistResume,
  replayResumeLog,
  resumeBacking,
  resumeDescription,
  resumeOffer,
  shouldAutosaveResume,
  shouldGuardLeave,
  type ResumeMode,
  type ResumeParsed,
  type ResumeReplayed,
  type ResumeStorage,
} from '../src/resume';
import {
  FIXTURE_1103_PATH,
  PLAYTEST_1106_PATH,
  firstRefusedMove,
  localLog,
  oracleLog,
  playerA,
  playerB,
  playerC,
  readText,
  richLog,
  sliceLog,
  withIllegalMove,
} from './local-match-resume.support';

const memoryStorage = (): ResumeStorage & { value: string | undefined } => {
  const cell: { value: string | undefined } = { value: undefined };
  return {
    get value() {
      return cell.value;
    },
    getItem: (key) => (key === 'conquarrow:resume' ? (cell.value ?? null) : null),
    setItem: (key, value) => {
      if (key === 'conquarrow:resume') cell.value = value;
    },
    removeItem: (key) => {
      if (key === 'conquarrow:resume') cell.value = undefined;
    },
  };
};

const expectRejection = (result: ResumeParsed | ResumeReplayed): void => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(Object.keys(result).toSorted()).toEqual(['error', 'ok']);
  expect(result.error.length).toBeGreaterThan(0);
  expect(result.error).not.toContain('\n');
};

const excluded = (flag: keyof ResumeMode): ResumeMode => ({
  ...LOCAL_RESUME_MODE,
  [flag]: true,
});

describe('parse rejects', () => {
  it('bad JSON is an error, never a partial log', () => {
    expectRejection(parseResumeLog('{'));
    expectRejection(parseResumeLog(''));
    expectRejection(parseResumeLog('not json'));
  });

  it('a non-object is an error, never a partial log', () => {
    for (const raw of ['null', '[]', '1', '"log"', 'true']) {
      expectRejection(parseResumeLog(raw));
    }
  });

  it('an unknown seat kind is an error, never a partial log', () => {
    const raw = JSON.parse(serializeMatchLog(richLog())) as { seats: { kind: string }[] };
    const seat = raw.seats[0];
    if (seat === undefined) throw new Error('setup: rich log has no seat');
    seat.kind = 'llm';
    expectRejection(parseResumeLog(JSON.stringify(raw)));
  });

  it('a bad move is an error, never a partial log', () => {
    const raw = JSON.parse(serializeMatchLog(richLog())) as { moves: unknown[] };
    raw.moves = [{ kind: 'step', from: 'tiling:a:5,0,0' }, { kind: 'leap' }];
    expectRejection(parseResumeLog(JSON.stringify(raw)));
  });

  it('a log missing its moves is an error, never a partial log', () => {
    const raw = JSON.parse(serializeMatchLog(richLog())) as Record<string, unknown>;
    delete raw['moves'];
    expectRejection(parseResumeLog(JSON.stringify(raw)));
  });
});

describe('a move rules.apply refuses', () => {
  it('the 11-03 fixture past move 265 is an error, not a prefix', () => {
    const oracle = oracleLog(readText(FIXTURE_1103_PATH), '11-03');
    expect(firstRefusedMove(oracle, '11-03')).toBe(265);
    const parsed = parseResumeLog(readText(FIXTURE_1103_PATH));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.log.moves).toHaveLength(oracle.moves.length);
    expectRejection(replayResumeLog(parsed.log));
  }, 20_000);

  it('a hand-corrupted move is an error, not a prefix', () => {
    const corrupt = withIllegalMove(
      sliceLog(oracleLog(readText(PLAYTEST_1106_PATH), '11-06'), 4),
    );
    expect(firstRefusedMove(corrupt, 'hand-corrupted')).toBe(0);
    expectRejection(replayResumeLog(corrupt));
  });
});

describe('modes that must not write the resume save', () => {
  it('tutorial, online, a spectated board and a replayed board do not autosave', () => {
    expect(shouldAutosaveResume(LOCAL_RESUME_MODE)).toBe(true);
    for (const flag of ['tutorial', 'online', 'spectated', 'replayed'] as const) {
      expect(shouldAutosaveResume(excluded(flag)), flag).toBe(false);
    }
  });

  it('those modes leave an existing local save untouched, even if their log has a winner', () => {
    const store = createResumeStore(resumeBacking(memoryStorage()));
    const saved = localLog('2026-11-07T08:00:00.000Z');
    persistResume(store, saved, LOCAL_RESUME_MODE);
    const lesson = {
      ...localLog('2026-11-07T09:00:00.000Z'),
      winner: playerC(),
    };
    for (const flag of ['tutorial', 'online', 'spectated', 'replayed'] as const) {
      persistResume(store, lesson, excluded(flag));
      expect(store.load()?.startedAt, flag).toBe(saved.startedAt);
    }
  });
});

describe('download without Resume', () => {
  it('a byok seat is saved and downloadable, and Resume is not offered', () => {
    const log = createMatchLog({
      config: { ...localLog('x').config },
      vsBot: true,
      botMode: 'byok',
      seats: [
        { player: playerA(), kind: 'human' },
        { player: playerB(), kind: 'byok', model: 'm' },
        { player: playerC(), kind: 'heuristic' },
      ],
      humanSeat: playerA(),
      botSeat: playerB(),
      startedAt: '2026-11-07T11:00:00.000Z',
    });
    expect(isResumable(log)).toBe(false);
    const store = createResumeStore(resumeBacking(memoryStorage()));
    persistResume(store, log, LOCAL_RESUME_MODE);
    const raw = store.readRaw();
    expect(raw).toBeDefined();
    if (raw === undefined) return;
    const offer = resumeOffer(raw);
    expect(offer.kind).toBe('download');
    if (offer.kind !== 'download') return;
    expect(offer.raw).toBe(raw);
    expect(offer).not.toHaveProperty('state');
    expect(isResumable(offer.log)).toBe(false);
  });
});

describe('a finished match', () => {
  it('is not resumable, and the resume save is deleted', () => {
    const store = createResumeStore(resumeBacking(memoryStorage()));
    const open = localLog('2026-11-07T08:00:00.000Z');
    persistResume(store, open, LOCAL_RESUME_MODE);
    expect(store.load()).toBeDefined();
    const finished: MatchLog = { ...open, winner: playerC() };
    expect(isResumable(finished)).toBe(false);
    persistResume(store, finished, LOCAL_RESUME_MODE);
    expect(store.load()).toBeUndefined();
    expect(store.readRaw()).toBeUndefined();
    expect(resumeOffer(undefined).kind).toBe('empty');
  });
});

describe('a corrupt save', () => {
  it('shows an error, starts nothing, and Download still has the raw text', () => {
    const storage = memoryStorage();
    storage.setItem('conquarrow:resume', '{');
    const store = createResumeStore(resumeBacking(storage));
    expect(store.load()).toBeUndefined();
    expect(store.readRaw()).toBe('{');
    const offer = resumeOffer(store.readRaw());
    expect(offer.kind).toBe('error');
    if (offer.kind !== 'error') return;
    expect(offer.error).not.toContain('\n');
    expect(offer.error.length).toBeGreaterThan(0);
    expect(offer.raw).toBe('{');
    expect(offer).not.toHaveProperty('log');
    expect(offer).not.toHaveProperty('state');
  });
});

describe('store failures', () => {
  it('a backing that throws does not break the load, which returns nothing', () => {
    const backing = {
      read: (): string | undefined => {
        throw new Error('private');
      },
      write: (): void => {
        throw new Error('private');
      },
      remove: (): void => {
        throw new Error('private');
      },
    };
    const store = createResumeStore(backing);
    expect(() => {
      store.save(localLog('2026-11-07T08:00:00.000Z'));
    }).not.toThrow();
    expect(() => {
      store.load();
    }).not.toThrow();
    expect(store.load()).toBeUndefined();
    expect(store.readRaw()).toBeUndefined();
    expect(() => {
      store.remove();
    }).not.toThrow();
  });

  it('deleting leaves nothing', () => {
    const store = createResumeStore(resumeBacking(memoryStorage()));
    store.save(localLog('2026-11-07T08:00:00.000Z'));
    store.remove();
    expect(store.load()).toBeUndefined();
    expect(store.readRaw()).toBeUndefined();
    expect(resumeOffer(store.readRaw()).kind).toBe('empty');
  });

  it('no storage is an empty read, not a throw', () => {
    const backing = resumeBacking(undefined);
    expect(backing.read()).toBeUndefined();
    expect(() => {
      backing.write('x');
    }).not.toThrow();
    expect(() => {
      backing.remove();
    }).not.toThrow();
    const store = createResumeStore(backing);
    expect(store.load()).toBeUndefined();
    expect(store.readRaw()).toBeUndefined();
  });
});

describe('description', () => {
  it('keeps seat order and counts the opening as round 1', () => {
    const log = createMatchLog({
      config: { ...localLog('x').config, playerCount: 2 },
      vsBot: true,
      botMode: 'heuristic',
      seats: [
        { player: playerB(), kind: 'heuristic' },
        { player: playerA(), kind: 'human' },
      ],
      humanSeat: playerA(),
      botSeat: playerB(),
      startedAt: '2026-11-07T08:00:00.000Z',
    });
    expect(resumeDescription(log)).toBe('B heuristic · A human · round 1 · 0 moves');
  });
});

describe('Back during a local match', () => {
  it('asks; Cancel stays; OK goes to the lobby; the save stays', () => {
    expect(LEAVE_MATCH_CONFIRM).toBe(
      'Leave this game? It is saved; Resume it from the lobby.',
    );
    expect(shouldGuardLeave({ mode: LOCAL_RESUME_MODE, winner: undefined })).toBe(true);
    for (const flag of ['tutorial', 'online', 'spectated', 'replayed'] as const) {
      expect(shouldGuardLeave({ mode: excluded(flag), winner: undefined }), flag).toBe(false);
    }
    expect(shouldGuardLeave({ mode: LOCAL_RESUME_MODE, winner: mintPlayerId('C') })).toBe(
      false,
    );
    expect(leaveChoice(false)).toBe('stay');
    expect(leaveChoice(true)).toBe('lobby');

    const store = createResumeStore(resumeBacking(memoryStorage()));
    const saved = localLog('2026-11-07T08:00:00.000Z');
    persistResume(store, saved, LOCAL_RESUME_MODE);
    leaveChoice(true);
    expect(store.load()?.startedAt).toBe(saved.startedAt);
  });
});
