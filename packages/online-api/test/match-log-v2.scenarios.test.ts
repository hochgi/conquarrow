/**
 * docs/spec/match-log-v2/SCENARIOS.md 1–4 — every alt and opt a test.
 * The API and the MCP door are the components; the store is the probed leaf.
 *
 * @see docs/spec/match-log-v2/match-log-v2.md
 */

import { describe, expect, it } from 'vitest';
import type { ExportLogEntry, GameExport, GameState, Move } from '@conquarrow/contracts';
import { endTurn, step as stepMove, mintArrowId } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { logEventsOf } from '@conquarrow/rules-core';
import { openingConfig } from '../src/game-handlers';
import { pagesHeuristic } from '../src/pages-heuristic';
import { gameStateKey } from '../src/s3-keys';
import { getExport } from './game-management.support';
import { expectStatus, getGame, groupHashOfUserHashes, parseBody, postMove, userHashOf } from './support';
import {
  ALICE,
  CAROL,
  TOKEN,
  type RemoteRig,
  accessToken,
  agent,
  atSeat,
  failNextPut,
  geometry,
  heuristicSeat,
  human,
  inviteHandle,
  logRaw,
  opening,
  postDoor,
  rules,
  seedStarted,
  toolJson,
  toolsCall,
  withRig,
} from './remote-agent-mcp.support';

const GAME = '000001';
const T0 = Date.UTC(2026, 10, 27, 10, 0, 0);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const A = (): string => userHashOf(ALICE.sub);
const C = (): string => userHashOf(CAROL.sub);
const GROUP = (): string => groupHashOfUserHashes([A()]);

/** A clock that moves 1 ms every time it is read, so each stamp is its own. */
const tickingClock = (): (() => number) => {
  let now = T0;
  return () => {
    now += 1;
    return now;
  };
};

type Line = Record<string, unknown>;

const linesOf = (raw: string | undefined): readonly Line[] =>
  (raw ?? '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Line);

const moveLines = (raw: string | undefined): readonly Line[] => linesOf(raw).filter((line) => 'move' in line);
const replyLines = (raw: string | undefined): readonly Line[] => linesOf(raw).filter((line) => 'agentReply' in line);

/**
 * E2: replay the move lines from `start`; each line's seat is the mover and its
 * events are `logEventsOf` for that very step (JSON round-tripped, as stored).
 */
const expectLinesMatchReplay = (start: GameState, lines: readonly Line[]): GameState => {
  let state = start;
  for (const line of lines) {
    const move = line['move'] as Move;
    const after = rules.apply(state, move);
    expect(line['seat']).toBe(String(state.activePlayer));
    expect(line['events']).toStrictEqual(
      JSON.parse(JSON.stringify(logEventsOf(geometry, { before: state, after, move }))),
    );
    state = after;
  }
  return state;
};

const seedThree = (rig: RemoteRig, state: GameState, version: number, seats = [human(A()), heuristicSeat(), heuristicSeat()], log?: string): void => {
  seedStarted(rig, {
    token: TOKEN,
    groupHash: GROUP(),
    gameNumber: GAME,
    seats,
    state,
    version,
    members: [A(), C()],
    ...(log === undefined ? {} : { log }),
  });
};

const exportOf = async (rig: RemoteRig): Promise<GameExport> =>
  parseBody(expectStatus(await getExport(rig.api, GROUP(), GAME, ALICE.bearer), 200)) as GameExport;

describe('SCENARIOS.md 1 — a browser move is logged', () => {
  it('alt refused (illegal step): 422 and log.jsonl unchanged', async () => {
    await withRig(async (rig) => {
      const state = opening(3);
      seedThree(rig, state, 2, undefined, '');
      const before = logRaw(rig, GROUP(), GAME);
      const bogus = stepMove(mintArrowId('nowhere'), mintArrowId('nowhere-else'), 1);
      expectStatus(await postMove(rig.api, GROUP(), GAME, ALICE.bearer, bogus, 2), 422);
      expect(logRaw(rig, GROUP(), GAME)).toBe(before);
    });
  });

  it('applied, no server move after it: one line {v, at, seat, move, events}, no by', async () => {
    await withRig(async (rig) => {
      const state = opening(3);
      const move = rules.legalMoves(state).find((m) => m.kind === 'step');
      if (move === undefined) throw new Error('setup: no step');
      seedThree(rig, state, 2, undefined, '');

      expectStatus(await postMove(rig.api, GROUP(), GAME, ALICE.bearer, move, 2), 200);

      const lines = linesOf(logRaw(rig, GROUP(), GAME));
      expect(lines).toHaveLength(1);
      const [line] = lines;
      expect(Object.keys(line ?? {})).toEqual(['v', 'at', 'seat', 'move', 'events']);
      expect(line?.['v']).toBe(3);
      expect(line?.['at']).toMatch(ISO);
      expect(line?.['move']).toEqual(move);
      expectLinesMatchReplay(state, lines);
    }, { clock: tickingClock() });
  });

  it('opt server moves after it: each line by "server" with its own seat and a later at', async () => {
    await withRig(async (rig) => {
      const state = opening(3);
      seedThree(rig, state, 2, undefined, '');

      expectStatus(await postMove(rig.api, GROUP(), GAME, ALICE.bearer, endTurn(), 2), 200);

      const lines = moveLines(logRaw(rig, GROUP(), GAME));
      expect(lines.map((l) => [l['v'], l['seat'], l['by']])).toEqual([
        [3, 'A', undefined],
        [3, 'B', 'server'],
        [3, 'C', 'server'],
      ]);
      expect('by' in (lines[0] ?? {})).toBe(false);
      const ats = lines.map((l) => String(l['at']));
      for (const at of ats) expect(at).toMatch(ISO);
      expect([...ats].sort()).toEqual(ats);
      expect(new Set(ats).size).toBe(ats.length);
      expectLinesMatchReplay(state, lines);
    }, { clock: tickingClock() });
  });
});

describe('SCENARIOS.md 2 — the heal logs server moves', () => {
  it('alt opening: the first read writes v 0 lines by "server"', async () => {
    await withRig(async (rig) => {
      seedThree(rig, opening(3), 0, [heuristicSeat(), human(A()), heuristicSeat()]);
      rig.data.delete(gameStateKey(GROUP(), GAME));

      expectStatus(await getGame(rig.api, GROUP(), GAME, ALICE.bearer), 200);

      const lines = moveLines(logRaw(rig, GROUP(), GAME));
      expect(lines.map((l) => [l['v'], l['seat'], l['by']])).toEqual([[0, 'A', 'server']]);
      expectLinesMatchReplay(makeMatch(openingConfig(3)), lines);
    });
  });

  it('alt state exists, nothing to play: log.jsonl unchanged', async () => {
    await withRig(async (rig) => {
      seedThree(rig, opening(3), 5, undefined, 'x\n');
      expectStatus(await getGame(rig.api, GROUP(), GAME, ALICE.bearer), 200);
      expect(logRaw(rig, GROUP(), GAME)).toBe('x\n');
    });
  });

  it('alt server moves: lines at the next version, by "server"', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      seedThree(rig, state, 5, undefined, '');
      expectStatus(await getGame(rig.api, GROUP(), GAME, ALICE.bearer), 200);
      const lines = moveLines(logRaw(rig, GROUP(), GAME));
      expect(lines.map((l) => [l['v'], l['seat'], l['by']])).toEqual([
        [6, 'B', 'server'],
        [6, 'C', 'server'],
      ]);
      expectLinesMatchReplay(state, lines);
    });
  });
});

const seedAgent = (rig: RemoteRig, version = 4): GameState => {
  const state = atSeat(opening(3), 1);
  seedThree(rig, state, version, [human(A()), agent(C()), heuristicSeat()], '');
  return state;
};

const agentMove = (rig: RemoteRig, args: Record<string, unknown>) =>
  postDoor(rig, toolsCall('move', { handle: inviteHandle(), ...args }), accessToken(rig, CAROL.sub));

describe('SCENARIOS.md 3 — an agent move is logged with what it resolved to', () => {
  it('alt reply unusable: nothing written', async () => {
    await withRig(async (rig) => {
      seedAgent(rig);
      const result = await agentMove(rig, { moves: 'zero', endTurn: true });
      expect(toolJson(result)?.['error']).toBe('reply is not usable');
      expect(logRaw(rig, GROUP(), GAME)).toBe('');
    });
  });

  it('alt index illegal: nothing written', async () => {
    await withRig(async (rig) => {
      seedAgent(rig);
      await agentMove(rig, { moves: [99999], endTurn: true });
      expect(logRaw(rig, GROUP(), GAME)).toBe('');
    });
  });

  it('applied, endTurn false: the step line (agent seat, no by), then the reply with resolved and offerVersion', async () => {
    await withRig(async (rig) => {
      const state = seedAgent(rig);
      const offered = rules.legalMoves(state)[0];
      await agentMove(rig, { moves: [0], endTurn: false, why: 'probe' });

      const lines = linesOf(logRaw(rig, GROUP(), GAME));
      expect(lines).toHaveLength(2);
      const [stepLine, reply] = lines;
      expect(stepLine?.['seat']).toBe('B');
      expect('by' in (stepLine ?? {})).toBe(false);
      expect(stepLine?.['move']).toEqual(offered);
      expect(Object.keys(reply ?? {})).toEqual(['v', 'at', 'seat', 'agentReply']);
      expect(reply).toMatchObject({ v: 5, seat: 'B' });
      expect(reply?.['at']).toMatch(ISO);
      // D4: received before its moves applied.
      expect(String(reply?.['at']) < String(stepLine?.['at'])).toBe(true);
      expect(reply?.['agentReply']).toStrictEqual({
        moves: [0],
        resolved: [offered],
        offerVersion: 4,
        endTurn: false,
        why: 'probe',
      });
      expectLinesMatchReplay(state, moveLines(logRaw(rig, GROUP(), GAME)));
    }, { clock: tickingClock() });
  });

  it('opt finish + opt advance: step, the agent endTurn (no by), the server lines, then the reply', async () => {
    await withRig(async (rig) => {
      const state = seedAgent(rig);
      const offered = rules.legalMoves(state)[0];
      await agentMove(rig, { moves: [0], endTurn: true, plan: 'p' });

      const lines = linesOf(logRaw(rig, GROUP(), GAME));
      expect(lines.map((l) => ('agentReply' in l ? 'reply' : [l['seat'], l['by'] ?? null, (l['move'] as Move).kind]))).toEqual([
        ['B', null, 'step'],
        ['B', null, 'endTurn'],
        ['C', 'server', 'endTurn'],
        'reply',
      ]);
      expect(replyLines(logRaw(rig, GROUP(), GAME))[0]?.['agentReply']).toStrictEqual({
        moves: [0],
        resolved: [offered],
        offerVersion: 4,
        endTurn: true,
        plan: 'p',
      });
      expectLinesMatchReplay(state, moveLines(logRaw(rig, GROUP(), GAME)));
    });
  });

  it('an agent that only ends its turn resolves to nothing', async () => {
    await withRig(async (rig) => {
      seedAgent(rig, 7);
      await agentMove(rig, { moves: [], endTurn: true });
      const lines = linesOf(logRaw(rig, GROUP(), GAME));
      expect(lines[0]).toMatchObject({ seat: 'B', move: { kind: 'endTurn' } });
      expect('by' in (lines[0] ?? {})).toBe(false);
      expect(replyLines(logRaw(rig, GROUP(), GAME))[0]?.['agentReply']).toStrictEqual({
        moves: [],
        resolved: [],
        offerVersion: 7,
        endTurn: true,
      });
    });
  });

  it('alt 412 (raced): "the position changed" and log.jsonl unchanged', async () => {
    await withRig(async (rig) => {
      seedAgent(rig);
      failNextPut(rig, gameStateKey(GROUP(), GAME));
      const result = await agentMove(rig, { moves: [0], endTurn: true });
      expect(toolJson(result)?.['error']).toBe('the position changed; observe and try once');
      expect(logRaw(rig, GROUP(), GAME)).toBe('');
    });
  });
});

describe('SCENARIOS.md 4 — the export serves v2', () => {
  it('formatVersion 2; a heuristic seat is "heuristic" in seats and standings', async () => {
    await withRig(async (rig) => {
      seedThree(rig, { ...opening(3), winner: opening(3).players[0] }, 3, undefined, '');
      const exported = await exportOf(rig);
      expect(exported.formatVersion).toBe(2);
      expect(exported.seats.map((s) => s.kind)).toEqual(['human', 'heuristic', 'heuristic']);
      expect(exported.summary?.standings.map((s) => s.kind)).toEqual(['human', 'heuristic', 'heuristic']);
    });
  });

  it('alt move line: the v2 fields exactly as written (golden over a real heuristic burst)', async () => {
    await withRig(async (rig) => {
      const state = opening(3);
      seedThree(rig, state, 0, undefined, '');
      let version = 0;
      for (let turn = 0; turn < 4; turn += 1) {
        const res = expectStatus(await postMove(rig.api, GROUP(), GAME, ALICE.bearer, endTurn(), version), 200);
        version = (parseBody(res) as Record<string, unknown>)['version'] as number;
      }
      const raw = logRaw(rig, GROUP(), GAME);
      const exported = await exportOf(rig);
      expect(exported.log).toStrictEqual(linesOf(raw));
      expect(exported.moves).toEqual(moveLines(raw).map((l) => l['move']));
      expect(moveLines(raw).some((l) => (l['move'] as Move).kind === 'step')).toBe(true);
      expectLinesMatchReplay(state, moveLines(raw));
    }, { clock: tickingClock(), heuristic: pagesHeuristic });
  });

  const OWN = 'B';
  const RIVAL = 'C';
  const legacyMove = JSON.stringify({ v: 1, move: endTurn() });
  const bare = JSON.stringify(endTurn());
  const reply = (seat: string | undefined, nested: boolean): string =>
    JSON.stringify(
      nested
        ? { v: 2, agentReply: { ...(seat === undefined ? {} : { seat }), moves: [0], endTurn: true, why: 'w' } }
        : { v: 2, at: '2026-11-27T10:00:00.000Z', ...(seat === undefined ? {} : { seat }), agentReply: { moves: [0], resolved: [endTurn()], offerVersion: 1, endTurn: true, plan: 'p' } },
    );
  const MIXED = [
    legacyMove,
    bare,
    'not json',
    reply(OWN, false),
    reply(RIVAL, false),
    reply(undefined, false),
    reply(OWN, true),
    reply(RIVAL, true),
    reply(undefined, true),
  ].join('\n') + '\n';
  const aliceAgentSeats = () => [human(A()), agent(A()), heuristicSeat()];

  it('alt pre-P107 lines export as they are; a nested seat is lifted; unreadable lines are skipped', async () => {
    await withRig(async (rig) => {
      seedThree(rig, opening(3), 3, aliceAgentSeats(), MIXED);
      const exported = await exportOf(rig);
      const expected: readonly ExportLogEntry[] = [
        { v: 1, move: endTurn() },
        { move: endTurn() },
        { v: 2, at: '2026-11-27T10:00:00.000Z', seat: OWN, agentReply: { moves: [0], resolved: [endTurn()], offerVersion: 1, endTurn: true, plan: 'p' } },
        { v: 2, seat: OWN, agentReply: { moves: [0], endTurn: true, why: 'w' } },
      ];
      expect(exported.log).toStrictEqual(expected);
      expect(exported.withheldReplies).toBe(4);
    });
  });

  it('alt game won: every reply line is exported, whichever version wrote it', async () => {
    await withRig(async (rig) => {
      seedThree(rig, { ...opening(3), winner: opening(3).players[0] }, 3, aliceAgentSeats(), MIXED);
      const exported = await exportOf(rig);
      expect(exported.withheldReplies).toBe(0);
      expect(exported.log.filter((e) => 'agentReply' in e).map((e) => ('agentReply' in e ? e.seat ?? null : 'x'))).toEqual([
        OWN,
        RIVAL,
        null,
        OWN,
        RIVAL,
        null,
      ]);
    });
  });

  it('malformed v2 fields are left out, not passed through', async () => {
    await withRig(async (rig) => {
      const odd = [
        JSON.stringify({ v: 1, at: 5, seat: 7, by: 'client', move: endTurn(), events: 'none' }),
        JSON.stringify({ v: 2, at: 5, seat: OWN, agentReply: { moves: [0], resolved: 'x', offerVersion: '1', endTurn: true } }),
      ].join('\n');
      seedThree(rig, opening(3), 3, aliceAgentSeats(), `${odd}\n`);
      const exported = await exportOf(rig);
      expect(exported.log).toStrictEqual([
        { v: 1, move: endTurn() },
        { v: 2, seat: OWN, agentReply: { moves: [0], endTurn: true } },
      ]);
    });
  });

  it('a by other than "server" is left out; by "server" is kept', async () => {
    await withRig(async (rig) => {
      const lines = [
        JSON.stringify({ v: 1, at: '2026-11-27T10:00:00.000Z', seat: 'A', by: 'server', move: endTurn(), events: [] }),
      ].join('\n');
      seedThree(rig, opening(3), 3, undefined, `${lines}\n`);
      const exported = await exportOf(rig);
      expect(exported.log).toStrictEqual([
        { v: 1, at: '2026-11-27T10:00:00.000Z', seat: 'A', by: 'server', move: endTurn(), events: [] },
      ]);
    });
  });
});
