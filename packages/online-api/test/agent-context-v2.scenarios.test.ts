/**
 * docs/spec/agent-context-v2/SCENARIOS.md 1–3 — the door's offer says who is
 * who and what happened since the agent's last turn; the move tool declares
 * its arguments (P108).
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 */

import { describe, expect, it } from 'vitest';
import type { GameState, InviteSeat, Move } from '@conquarrow/contracts';
import { chairUserHash, endTurn } from '@conquarrow/contracts';
import { BATCH_RULE, offerText, type RecentLine } from '@conquarrow/byok-offer';
import { applyLogged } from '../src/game-advance';
import { stampLogLine } from '../src/game-log';
import { gameLogKey } from '../src/s3-keys';
import { carolHash, aliceHash, groupHashOfUserHashes } from './support';
import {
  CAROL,
  TOKEN,
  accessToken,
  agent,
  atSeat,
  heuristicSeat,
  human,
  inviteHandle,
  jsonOf,
  offerBlock,
  opening,
  postDoor,
  requireStepAt,
  rules,
  seedProfile,
  seedStarted,
  toolJson,
  toolsCall,
  withRig,
  type RemoteRig,
} from './remote-agent-mcp.support';

const C = () => carolHash();
const A = () => aliceHash();
const GROUP = () => groupHashOfUserHashes([C()]);
/** The door finds the game under the group of the bound human chairs. */
const groupOfSeats = (seats: readonly InviteSeat[]): string =>
  groupHashOfUserHashes(
    seats.flatMap((seat) => (seat.kind === 'human' ? [chairUserHash(seat)].filter((h): h is string => h !== undefined) : [])),
  );
const GAME = '000001';
const clock = () => Date.parse('2026-11-27T10:00:00.000Z');

const seed = (rig: RemoteRig, seats: readonly InviteSeat[], state: GameState, log?: string): void => {
  seedStarted(rig, {
    token: TOKEN,
    groupHash: groupOfSeats(seats),
    gameNumber: GAME,
    seats,
    state,
    version: 1,
    members: [C(), A()],
    ...(log === undefined ? {} : { log }),
  });
};

const observe = (rig: RemoteRig) =>
  postDoor(rig, toolsCall('observe', { handle: inviteHandle() }), accessToken(rig, CAROL.sub));

const move = (rig: RemoteRig, args: Record<string, unknown>) =>
  postDoor(rig, toolsCall('move', { handle: inviteHandle(), ...args }), accessToken(rig, CAROL.sub));

const letters = (state: GameState): readonly string[] => state.players.map(String);

/** Play `moves` from `from`, returning the stamped v2 lines and the recent lines they hold. */
const played = (from: GameState, moves: readonly Move[]): { readonly at: GameState; readonly raw: string; readonly recent: RecentLine[] } => {
  let at = from;
  const raw: string[] = [];
  const recent: RecentLine[] = [];
  for (const m of moves) {
    const { game, entry } = applyLogged(at, m, clock);
    raw.push(stampLogLine(1, entry));
    recent.push({ seat: entry.seat, move: entry.move, events: entry.events });
    at = game;
  }
  return { at, raw: raw.join('\n') + '\n', recent };
};

describe('SCENARIOS.md 1 — the door\'s offer says who is who', () => {
  it('alt stop (not your turn): no offer', async () => {
    await withRig(async (rig) => {
      seed(rig, [human(C()), agent(C()), heuristicSeat()], atSeat(opening(3), 0));
      const result = await observe(rig);
      expect(toolJson(result)).toMatchObject({ stop: true, reason: 'not-your-turn' });
      expect(offerBlock(result)).toBeUndefined();
    });
  });

  it('offer: the seat table names the owner, the agent and the AI', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      const [pa, pb, pc] = letters(state);
      seedProfile(rig, C(), 'Gilad');
      seed(rig, [human(C()), agent(C()), heuristicSeat()], state);
      const offer = offerBlock(await observe(rig)) ?? '';
      expect(offer.split('\n').slice(1, 5)).toEqual([
        'Seats in turn order:',
        `${String(pa)} human Gilad (your owner)`,
        `${String(pb)} agent Gilad's agent (you)`,
        `${String(pc)} heuristic AI`,
      ]);
    });
  });

  it('offer: another user\'s human seat has no relation; with no profile name it reads Player <letter>', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      const [pa, pb] = letters(state);
      seed(rig, [human(A()), agent(C()), heuristicSeat()], state);
      const offer = offerBlock(await observe(rig)) ?? '';
      expect(offer).toContain(`\n${String(pa)} human Player ${String(pa)}\n${String(pb)} agent Agent (you)\n`);
    });
  });

  it('offer: an agent on two chairs reads its other chair as also you', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(6), 1);
      const p = letters(state);
      seedProfile(rig, C(), 'Gilad');
      seed(rig, [human(A()), agent(C()), heuristicSeat(), agent(C()), heuristicSeat(), heuristicSeat()], state);
      const offer = offerBlock(await observe(rig)) ?? '';
      expect(offer).toContain(`\n${String(p[1])} agent Gilad's agent (you)\n`);
      expect(offer).toContain(`\n${String(p[3])} agent Gilad's agent (also you)\n`);
      expect(offer).not.toContain('(your owner)');
    });
  });

  it('offer: since your last turn, from the P107 lines; pre-P107 lines are skipped', async () => {
    await withRig(async (rig) => {
      const start = atSeat(opening(3), 1);
      requireStepAt(start, 0);
      const first = rules.legalMoves(start)[0] as Move;
      // B (the agent) steps and ends; C (AI) and A pass; B is to move again.
      const history = played(start, [first, endTurn(), endTurn(), endTurn()]);
      const legacy = JSON.stringify({ v: 1, move: endTurn() });
      // A v2-looking line whose events did not survive the type checks is skipped too.
      const broken = JSON.stringify({ v: 1, at: '2026-11-27T09:00:00.000Z', seat: 'B', move: endTurn(), events: 'lost' });
      const reply = JSON.stringify({ v: 1, at: '2026-11-27T09:00:00.000Z', seat: 'B', agentReply: { moves: [], resolved: [], offerVersion: 0, endTurn: true } });
      seed(rig, [human(C()), agent(C()), heuristicSeat()], history.at, `${legacy}\n${broken}\n${reply}\n${history.raw}`);
      const seat = history.at.activePlayer;
      const offer = offerBlock(await observe(rig)) ?? '';
      const [pa, pb, pc] = letters(history.at).map(String);
      expect(offer).toContain(`\nSince your last turn (oldest first; ${String(pb)} is you):\n${String(pb)}, 1 steps: `);
      expect(offer).toContain(`\n${String(pc)}, 0 steps: nothing\n${String(pa)}, 0 steps: nothing\n`);
      // The door's text is the builder's text for that about (E6, the door's half).
      expect(offer).toBe(
        offerText(history.at, seat, {
          seats: [
            { player: String(pa), kind: 'human', name: `Player ${String(pa)}`, relation: 'your owner' },
            { player: String(pb), kind: 'agent', name: 'Agent', relation: 'you' },
            { player: String(pc), kind: 'heuristic', name: 'AI' },
          ],
          recent: history.recent,
        }),
      );
    });
  });

  it('offer: no log at all says nothing recorded yet', async () => {
    await withRig(async (rig) => {
      seed(rig, [human(C()), agent(C()), heuristicSeat()], atSeat(opening(3), 1));
      expect(rig.data.has(gameLogKey(GROUP(), GAME))).toBe(false);
      const offer = offerBlock(await observe(rig)) ?? '';
      expect(offer.split('\n')).toContain('Since your last turn: nothing recorded yet.');
    });
  });
});

describe('SCENARIOS.md 2 — a move\'s next offer includes the moves it applied', () => {
  it('alt the turn goes on: the history ends with this call\'s step', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      seed(rig, [human(C()), agent(C()), heuristicSeat()], state);
      const result = await move(rig, { moves: [0], endTurn: false });
      expect(toolJson(result)).toMatchObject({ applied: true, stop: false });
      const lines = (offerBlock(result) ?? '').split('\n');
      const b = String(state.activePlayer);
      const at = lines.indexOf(`Since your last turn (oldest first; ${b} is you):`);
      expect(at).toBeGreaterThan(0);
      expect(lines[at + 1]).toMatch(new RegExp(`^${b}, 1 steps: `));
    });
  });

  it('alt the turn ended: stop, and no offer', async () => {
    await withRig(async (rig) => {
      seed(rig, [human(C()), agent(C()), heuristicSeat()], atSeat(opening(3), 1));
      const result = await move(rig, { moves: [], endTurn: true });
      expect(toolJson(result)).toMatchObject({ applied: true, stop: true });
      expect(offerBlock(result)).toBeUndefined();
    });
  });
});

describe('SCENARIOS.md 3 — the move tool says what it takes', () => {
  it('moves items are integers (minimum 0), why and plan are strings, and the description states the batch rule', async () => {
    await withRig(async (rig) => {
      const res = await postDoor(rig, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, accessToken(rig, CAROL.sub));
      const tools = ((jsonOf(res) as { result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, unknown>; required: string[] } }[] } }).result.tools);
      const tool = tools.find((t) => t.name === 'move');
      expect(tool?.inputSchema.properties['moves']).toEqual({ type: 'array', items: { type: 'integer', minimum: 0 } });
      expect(tool?.inputSchema.properties['why']).toEqual({ type: 'string' });
      expect(tool?.inputSchema.properties['plan']).toEqual({ type: 'string' });
      expect(tool?.inputSchema.required).toEqual(['handle', 'moves', 'endTurn']);
      expect(tool?.description).toContain(BATCH_RULE);
    });
  });
});
