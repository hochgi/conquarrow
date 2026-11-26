/**
 * docs/spec/seat-choice/SCENARIOS.md — the server paths (2–6, 8), each alt a test.
 * The API and the MCP door are the components; the verifier and the store are the leaves.
 *
 * @see docs/spec/seat-choice/seat-choice.md
 */

import { describe, expect, it } from 'vitest';
import { offerText } from '@conquarrow/byok-offer';
import { onlinePlanProblem, type CreateInviteBody, type PlannedSeatKind } from '@conquarrow/contracts';
import { inviteKey, lobbyKey } from '../src/s3-keys';
import {
  EXPIRED_BEARER,
  expectStatus,
  getMyGames,
  groupHashOfUserHashes,
  parseBody,
  postAccept,
  postInvites,
  postStart,
  seatsOf,
  tokenOf,
  userHashOf,
} from './support';
import {
  ALICE,
  BOB,
  CAROL,
  type RemoteRig,
  accessToken,
  agent,
  atSeat,
  human,
  inviteAt,
  inviteHandle,
  offerBlock,
  opening,
  openInvite,
  postDoor,
  seedInvite,
  seedStarted,
  toolJson,
  toolsCall,
  withRig,
} from './remote-agent-mcp.support';

const A = () => userHashOf(ALICE.sub);
const B = () => userHashOf(BOB.sub);
const NAMES = {
  [ALICE.bearer]: { given_name: 'Alice' },
  [BOB.bearer]: { given_name: 'Bob' },
  [CAROL.bearer]: { given_name: 'Carol' },
} as const;

const create = (rig: RemoteRig, seats: readonly string[], bearer: string = ALICE.bearer) =>
  postInvites(rig.api, bearer, { seats } as unknown as CreateInviteBody);

const invitesWritten = (rig: RemoteRig): boolean =>
  [...rig.data.keys()].some((key) => key.startsWith('invites/') || key.includes('/invites/'));

const join = (rig: RemoteRig, sub: string, token: string) =>
  postDoor(rig, toolsCall('join', { handle: inviteHandle(token) }), accessToken(rig, sub));

const created = async (rig: RemoteRig, seats: readonly PlannedSeatKind[]): Promise<string> => {
  const res = expectStatus(await create(rig, seats), 201);
  return tokenOf(parseBody(res));
};

describe('SCENARIOS.md 2 — create', () => {
  it('alt bearer rejected: 401 and nothing written', async () => {
    await withRig(async (rig) => {
      expectStatus(await create(rig, ['creator', 'human', 'heuristic'], EXPIRED_BEARER), 401);
      expect(invitesWritten(rig)).toBe(false);
    });
  });

  it.each([
    ['no creator (the old shape)', ['human', 'human', 'heuristic']],
    ['two creators', ['creator', 'creator', 'heuristic']],
    ['creator with only AI', ['creator', 'heuristic', 'heuristic']],
    ['creator with byok', ['creator', 'byok', 'human']],
    ['size 4', ['creator', 'human', 'heuristic', 'heuristic']],
    ['an unknown token', ['creator', 'robot', 'heuristic']],
    ['six seats, two creators', ['creator', 'human', 'creator', 'heuristic', 'heuristic', 'heuristic']],
    ['six seats, creator and AI only', ['heuristic', 'heuristic', 'creator', 'heuristic', 'heuristic', 'heuristic']],
  ])('alt plan invalid (%s): 422 and nothing written', async (_name, seats) => {
    await withRig(async (rig) => {
      expectStatus(await create(rig, seats), 422);
      expect(invitesWritten(rig)).toBe(false);
    });
  });

  it('ok: the creator sits where they picked; the rest are open', async () => {
    await withRig(async (rig) => {
      const res = expectStatus(await create(rig, ['agent', 'human', 'creator']), 201);
      expect(seatsOf(parseBody(res))).toEqual([
        { kind: 'agent' },
        { kind: 'human' },
        { kind: 'human', userHash: A(), name: 'Alice' },
      ]);
      const token = tokenOf(parseBody(res));
      expect(inviteAt(rig, token)?.seats).toEqual([{ kind: 'agent' }, { kind: 'human' }, { kind: 'human', userHash: A() }]);
      expect(rig.data.has(lobbyKey(A(), token))).toBe(true);
    }, { names: NAMES });
  });

  it('ok: Agent (yours) is stored reserved for the creator, and may repeat', async () => {
    await withRig(async (rig) => {
      const res = expectStatus(
        await create(rig, ['creator-agent', 'creator', 'creator-agent', 'heuristic', 'human', 'agent']),
        201,
      );
      expect(seatsOf(parseBody(res))).toEqual([
        { kind: 'agent', reservedFor: A() },
        { kind: 'human', userHash: A(), name: 'Alice' },
        { kind: 'agent', reservedFor: A() },
        { kind: 'heuristic' },
        { kind: 'human' },
        { kind: 'agent' },
      ]);
      const raw = JSON.parse(rig.data.get(inviteKey(tokenOf(parseBody(res)))) ?? '{}') as { seats: unknown[] };
      expect(raw.seats[0]).toEqual({ kind: 'agent', reservedFor: A() });
    }, { names: NAMES });
  });

  it('ok: Player (you) and one Agent (yours) are enough', async () => {
    await withRig(async (rig) => {
      expectStatus(await create(rig, ['creator', 'creator-agent', 'heuristic']), 201);
    });
  });

  it('ok: hostSeatIndex is no longer read', async () => {
    await withRig(async (rig) => {
      const res = await postInvites(rig.api, ALICE.bearer, {
        seats: ['human', 'creator', 'heuristic'],
        hostSeatIndex: 0,
      } as unknown as CreateInviteBody);
      expect(seatsOf(parseBody(expectStatus(res, 201)))[1]).toMatchObject({ userHash: A() });
    });
  });
});

describe('SCENARIOS.md 3 — MCP join', () => {
  it('alt reserved for the caller: binds every reserved chair at once, joined with the first', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'agent', 'creator-agent', 'heuristic', 'heuristic']);
      // The lobby pointer is written again if it went missing (as for a held chair, P92).
      rig.data.delete(lobbyKey(A(), token));
      const result = await join(rig, ALICE.sub, token);
      expect(toolJson(result)).toEqual({ seatIndex: 1, kind: 'agent', status: 'joined' });
      expect(inviteAt(rig, token)?.seats).toEqual([
        { kind: 'human', userHash: A() },
        { kind: 'agent', userHash: A() },
        { kind: 'agent' },
        { kind: 'agent', userHash: A() },
        { kind: 'heuristic' },
        { kind: 'heuristic' },
      ]);
      expect(rig.data.has(lobbyKey(A(), token))).toBe(true);
    });
  });

  it('alt reserved, raced: a 412 re-reads and still binds them', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'human']);
      const key = inviteKey(token);
      const realGet = rig.data.get.bind(rig.data);
      let raced = false;
      // Bob accepts right after the door's read, so its If-Match write is refused once.
      rig.data.get = (k: string): string | undefined => {
        const value = realGet(k);
        if (!raced && k === key && value !== undefined) {
          raced = true;
          const current = JSON.parse(value) as { seats: unknown[] };
          current.seats[2] = { kind: 'human', userHash: B() };
          rig.data.set(k, JSON.stringify(current));
        }
        return value;
      };
      expect(toolJson(await join(rig, ALICE.sub, token))).toEqual({ seatIndex: 1, kind: 'agent', status: 'joined' });
      expect(raced).toBe(true);
      expect(inviteAt(rig, token)?.seats).toEqual([
        { kind: 'human', userHash: A() },
        { kind: 'agent', userHash: A() },
        { kind: 'human', userHash: B() },
      ]);
    });
  });

  it('alt reserved, a store failure that is not a 412: thrown, nothing bound', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'human']);
      const key = inviteKey(token);
      const realSet = rig.data.set.bind(rig.data);
      rig.data.set = (k: string, v: string) => {
        if (k === key) throw new Error('store down');
        return realSet(k, v);
      };
      await expect(join(rig, ALICE.sub, token)).rejects.toThrow('store down');
      rig.data.set = realSet;
      expect(inviteAt(rig, token)?.seats[1]).toEqual({ kind: 'agent', reservedFor: A() });
    });
  });

  it('alt already held: joined again with the same seat, nothing rebound', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'agent']);
      await join(rig, ALICE.sub, token);
      expect(toolJson(await join(rig, ALICE.sub, token))).toEqual({ seatIndex: 1, kind: 'agent', status: 'joined' });
      expect(inviteAt(rig, token)?.seats[2]).toEqual({ kind: 'agent' });
    });
  });

  it('alt no agent chair: no-agent-seat', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'human', 'heuristic']);
      expect(toolJson(await join(rig, BOB.sub, token))).toEqual({ error: 'no-agent-seat' });
    });
  });

  it('alt only chairs reserved for someone else: full, and the chair stays reserved', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'human']);
      expect(toolJson(await join(rig, BOB.sub, token))).toEqual({ error: 'full' });
      expect(inviteAt(rig, token)?.seats[1]).toEqual({ kind: 'agent', reservedFor: A() });
    });
  });

  it('alt open chair: another user binds the open chair, never the reserved one', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'agent']);
      expect(toolJson(await join(rig, BOB.sub, token))).toEqual({ seatIndex: 2, kind: 'agent', status: 'joined' });
      expect(inviteAt(rig, token)?.seats[1]).toEqual({ kind: 'agent', reservedFor: A() });
      expect(inviteAt(rig, token)?.seats[2]).toEqual({ kind: 'agent', userHash: B() });
    });
  });

  it('alt open chair ahead of a reserved one: the open chair is taken', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, 'a1'.repeat(32), openInvite([human(A()), { kind: 'agent', reservedFor: A() }, agent()], A()));
      expect(toolJson(await join(rig, CAROL.sub, 'a1'.repeat(32)))).toEqual({ seatIndex: 2, kind: 'agent', status: 'joined' });
    });
  });

  it('alt all bound: full', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, 'a2'.repeat(32), openInvite([human(A()), agent(B()), human()], A()));
      expect(toolJson(await join(rig, CAROL.sub, 'a2'.repeat(32)))).toEqual({ error: 'full' });
    });
  });

  it.each(['revoked', 'started', 'deleted'] as const)('alt %s: refused, reserved chairs untouched', async (status) => {
    await withRig(async (rig) => {
      seedInvite(rig, 'a3'.repeat(32), openInvite([human(A()), { kind: 'agent', reservedFor: A() }, human(B())], A(), status));
      expect(toolJson(await join(rig, ALICE.sub, 'a3'.repeat(32)))).toEqual({ error: status });
      expect(inviteAt(rig, 'a3'.repeat(32))?.seats[1]).toEqual({ kind: 'agent', reservedFor: A() });
    });
  });

  it('alt no invite: bad-handle', async () => {
    await withRig(async (rig) => {
      expect(toolJson(await join(rig, ALICE.sub, 'a5'.repeat(32)))).toEqual({ error: 'bad-handle' });
    });
  });
});

describe('SCENARIOS.md 4 — accept never takes a reserved chair', () => {
  it('alt only reserved agent chairs left: 409', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'heuristic']);
      expectStatus(await postAccept(rig.api, token, BOB.bearer), 409);
      expect(inviteAt(rig, token)?.seats[1]).toEqual({ kind: 'agent', reservedFor: A() });
    });
  });

  it('alt an open human chair: binds it, the reserved chair is kept', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator-agent', 'human', 'creator']);
      expectStatus(await postAccept(rig.api, token, BOB.bearer), 200);
      expect(inviteAt(rig, token)?.seats).toEqual([
        { kind: 'agent', reservedFor: A() },
        { kind: 'human', userHash: B() },
        { kind: 'human', userHash: A() },
      ]);
    });
  });
});

describe('SCENARIOS.md 5 — start waits for the reserved chair', () => {
  it('alt reserved chair unbound: 409, then 200 once the creator’s agent joined', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['creator', 'creator-agent', 'human']);
      expectStatus(await postAccept(rig.api, token, BOB.bearer), 200);
      expectStatus(await postStart(rig.api, token, ALICE.bearer), 409);
      await join(rig, ALICE.sub, token);
      expectStatus(await postStart(rig.api, token, ALICE.bearer), 200);
    });
  });
});

describe('SCENARIOS.md 6 — one user, several agent chairs', () => {
  const seed = (rig: RemoteRig, seatIndex: number) => {
    const state = atSeat(opening(3), seatIndex);
    seedStarted(rig, {
      token: 'a4'.repeat(32),
      groupHash: groupHashOfUserHashes([B()]),
      gameNumber: '000001',
      seats: [human(B()), agent(A()), agent(A())],
      state,
      version: 1,
      members: [B(), A()],
    });
    return state;
  };
  const observe = (rig: RemoteRig) =>
    postDoor(rig, toolsCall('observe', { handle: inviteHandle('a4'.repeat(32)) }), accessToken(rig, ALICE.sub));

  it.each([1, 2])('alt active seat %i is held: the shared offer for that seat', async (index) => {
    await withRig(async (rig) => {
      const state = seed(rig, index);
      const seat = state.players[index];
      if (seat === undefined) throw new Error('setup');
      const result = await observe(rig);
      expect(toolJson(result)).toEqual({ stop: false, blocks: ['offer'] });
      expect(offerBlock(result)).toBe(offerText(state, seat));
    });
  });

  it('alt active seat not held: not-your-turn', async () => {
    await withRig(async (rig) => {
      seed(rig, 0);
      expect(toolJson(await observe(rig))).toEqual({ stop: true, reason: 'not-your-turn' });
    });
  });

  it('alt the second held seat is active: move plays it (no not-your-turn)', async () => {
    await withRig(async (rig) => {
      seed(rig, 2);
      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle('a4'.repeat(32)), moves: [], endTurn: true }),
        accessToken(rig, ALICE.sub),
      );
      expect(toolJson(result)?.['reason']).not.toBe('not-your-turn');
      expect(toolJson(result)?.['error']).toBeUndefined();
    });
  });
});

describe('SCENARIOS.md 8 — creator in seat C, an agent in seat A', () => {
  it('create → join → accept → start: the agent moves first; labels and status follow hashes', async () => {
    await withRig(async (rig) => {
      const token = await created(rig, ['agent', 'human', 'creator']);
      expect(toolJson(await join(rig, BOB.sub, token))).toEqual({ seatIndex: 0, kind: 'agent', status: 'joined' });
      expectStatus(await postAccept(rig.api, token, BOB.bearer), 200);
      const started = parseBody(expectStatus(await postStart(rig.api, token, ALICE.bearer), 200)) as {
        groupHash: string;
      };
      expect(started.groupHash).toBe(groupHashOfUserHashes([A(), B()]));
      const observed = await postDoor(rig, toolsCall('observe', { handle: inviteHandle(token) }), accessToken(rig, BOB.sub));
      expect(toolJson(observed)).toEqual({ stop: false, blocks: ['offer'] });
      const rows = parseBody(expectStatus(await getMyGames(rig.api, ALICE.bearer), 200)) as {
        games: { status: string; seats: { label: string; you: boolean }[] }[];
      };
      expect(rows.games[0]?.status).toBe('waiting');
      expect(rows.games[0]?.seats.map((seat) => [seat.label, seat.you])).toEqual([
        ["Bob's agent", false],
        ['Bob', false],
        ['you', true],
      ]);
    }, { names: NAMES });
  });
});

describe('EARS 2 — the server agrees with onlinePlanProblem on every 3-seat plan', () => {
  it('201 iff the shared check finds no problem', async () => {
    const tokens: readonly PlannedSeatKind[] = ['creator', 'human', 'creator-agent', 'agent', 'heuristic', 'byok'];
    await withRig(async (rig) => {
      for (const a of tokens) {
        for (const b of tokens) {
          for (const c of tokens) {
            const seats = [a, b, c];
            const status = (await create(rig, seats)).statusCode;
            expect([seats, status]).toEqual([seats, onlinePlanProblem(seats) === undefined ? 201 : 422]);
          }
        }
      }
    });
  });
});
