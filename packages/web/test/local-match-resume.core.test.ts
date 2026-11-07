/**
 * P90 — resume a local match. Happy path: parse, replay, autosave, store,
 * description, seat plan. One scenario per packet case a pure helper can carry.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import { appendMoves, serializeMatchLog } from '../src/matchLog';
import {
  LOCAL_RESUME_MODE,
  createResumeStore,
  isResumable,
  parseResumeLog,
  persistResume,
  replayResumeLog,
  resumeBacking,
  resumeDescription,
  resumeOffer,
  seatPlanFromLog,
  shouldAutosaveResume,
  type ResumeStorage,
} from '../src/resume';
import {
  FIXTURE_1102_PATH,
  PLAYTEST_1106_PATH,
  assertSameLog,
  directReplay,
  localLog,
  oracleLog,
  readText,
  richLog,
  samePosition,
  sliceLog,
} from './local-match-resume.support';

const memoryStorage = (): ResumeStorage & { readonly cells: Map<string, string> } => {
  const cells = new Map<string, string>();
  return {
    cells,
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => {
      cells.set(key, value);
    },
    removeItem: (key) => {
      cells.delete(key);
    },
  };
};

describe('parse', () => {
  it('a saved log round-trips with every field intact', () => {
    const log = richLog();
    const parsed = parseResumeLog(serializeMatchLog(log));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    assertSameLog(parsed.log, log);
  });
});

describe('replay', () => {
  it('replaying the 11-06 log matches a direct apply and keeps the log', () => {
    const raw = readText(PLAYTEST_1106_PATH);
    const oracle = oracleLog(raw, '11-06');
    const direct = directReplay(oracle, '11-06');
    expect(direct.round).toBe(44);
    expect(oracle.moves).toHaveLength(583);

    const parsed = parseResumeLog(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    assertSameLog(parsed.log, oracle);

    const resumed = replayResumeLog(parsed.log);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.log).toBe(parsed.log);
    expect(resumed.log.startedAt).toBe(oracle.startedAt);
    expect(resumed.log.moves).toHaveLength(oracle.moves.length);
    samePosition(resumed.state, direct.state);
  }, 20_000);

  it('replaying the 11-02 fixture matches a direct apply', () => {
    const raw = readText(FIXTURE_1102_PATH);
    const oracle = oracleLog(raw, '11-02');
    const direct = directReplay(oracle, '11-02');

    const parsed = parseResumeLog(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    assertSameLog(parsed.log, oracle);

    const resumed = replayResumeLog(parsed.log);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.log).toBe(parsed.log);
    samePosition(resumed.state, direct.state);
  }, 20_000);
});

describe('a local match with heuristic seats', () => {
  it('autosaves after each move, and Resume restores the same state and the same log', () => {
    expect(shouldAutosaveResume(LOCAL_RESUME_MODE)).toBe(true);
    const store = createResumeStore(resumeBacking(memoryStorage()));
    const opened = localLog('2026-11-07T08:00:00.000Z');
    persistResume(store, opened, LOCAL_RESUME_MODE);

    const played = appendMoves(opened, [
      step(mintArrowId('tiling:a:5,0,0'), mintArrowId('tiling:a:6,0,2'), 1),
      endTurn(),
    ]);
    persistResume(store, played, LOCAL_RESUME_MODE);

    const loaded = store.load();
    expect(loaded).toBeDefined();
    if (loaded === undefined) return;
    assertSameLog(loaded, played);
    expect(isResumable(loaded)).toBe(true);

    const offer = resumeOffer(store.readRaw());
    expect(offer.kind).toBe('offer');
    if (offer.kind !== 'offer') return;
    expect(offer.log.startedAt).toBe(played.startedAt);
    expect(offer.description).toContain('heuristic');
    expect(offer.description).toContain('human');
    expect(offer.description).toContain('2 moves');
  });

  it('when a heuristic seat is to move, the restored position is that seat', () => {
    const sliced = sliceLog(oracleLog(readText(PLAYTEST_1106_PATH), '11-06'), 4);
    const direct = directReplay(sliced, '11-06 prefix-as-save');
    expect(String(direct.state.activePlayer)).toBe('B');
    const seat = sliced.seats[1];
    expect(seat?.kind).toBe('heuristic');

    const resumed = replayResumeLog(sliced);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(String(resumed.state.activePlayer)).toBe('B');
    expect(resumed.log).toBe(sliced);

    const plan = seatPlanFromLog(sliced);
    expect(plan.playerCount).toBe(3);
    expect(plan.seats[1]?.kind).toBe('heuristic');
    expect(plan.seats.map((s) => s.kind)).toEqual(['heuristic', 'heuristic', 'human']);
  });
});

describe('lobby offer', () => {
  it('a parsed local save offers Resume with the 11-06 description', () => {
    const raw = readText(PLAYTEST_1106_PATH);
    const offer = resumeOffer(raw);
    expect(offer.kind).toBe('offer');
    if (offer.kind !== 'offer') return;
    expect(offer.description).toBe(
      'A heuristic · B heuristic · C human · round 44 · 583 moves',
    );
    expect(offer.raw).toBe(raw);
    expect(isResumable(offer.log)).toBe(true);
    expect(resumeDescription(offer.log)).toBe(offer.description);
  });

  it('the seat plan is rebuilt from the logged seats', () => {
    const log = oracleLog(readText(PLAYTEST_1106_PATH), '11-06');
    const plan = seatPlanFromLog(log);
    expect(plan.playerCount).toBe(3);
    expect(plan.seats.map((s) => s.kind)).toEqual(['heuristic', 'heuristic', 'human']);
    expect(plan.seats.every((s) => s.byok.apiKey === '')).toBe(true);
  });
});

describe('store', () => {
  it('save then load returns the log, and a second save replaces it', () => {
    const storage = memoryStorage();
    const store = createResumeStore(resumeBacking(storage));
    const first = localLog('2026-11-07T08:00:00.000Z');
    const second = localLog('2026-11-07T09:00:00.000Z');
    store.save(first);
    expect(storage.cells.has('conquarrow:resume')).toBe(true);
    const loaded = store.load();
    expect(loaded).toBeDefined();
    if (loaded === undefined) return;
    assertSameLog(loaded, first);

    store.save(second);
    const replaced = store.load();
    expect(replaced).toBeDefined();
    if (replaced === undefined) return;
    assertSameLog(replaced, second);
    expect(storage.cells.size).toBe(1);
  });

  it('starting a new match replaces the save; reading it does not delete it', () => {
    const store = createResumeStore(resumeBacking(memoryStorage()));
    persistResume(store, localLog('2026-11-07T08:00:00.000Z'), LOCAL_RESUME_MODE);
    const next = localLog('2026-11-07T10:00:00.000Z');
    persistResume(store, next, LOCAL_RESUME_MODE);
    expect(store.load()?.startedAt).toBe(next.startedAt);
    expect(store.load()?.startedAt).toBe(next.startedAt);
    expect(store.readRaw()).toContain(next.startedAt);
  });
});

describe('resumable', () => {
  it('is true for human and heuristic seats with no winner', () => {
    expect(isResumable(localLog('2026-11-07T08:00:00.000Z'))).toBe(true);
    expect(isResumable(oracleLog(readText(PLAYTEST_1106_PATH), '11-06'))).toBe(true);
  });
});
