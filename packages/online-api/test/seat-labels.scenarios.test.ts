/**
 * docs/spec/seat-labels/SCENARIOS.md — the server paths, each alt a test.
 * The API is the component; the verifier and the object store are the leaves.
 */

import { describe, expect, it } from 'vitest';
import type { GoogleVerifier } from '../src/create-online-api';
import { inviteKey, userProfileKey } from '../src/s3-keys';
import { withSeatNames } from '../src/library-listing';
import { mapStore } from './support';
import {
  ALICE,
  BOB,
  CAROL,
  EXPIRED_BEARER,
  GAME_ONE,
  aliceBobGroupHash,
  aliceHash,
  bobHash,
  carolHash,
  createOpenInvite,
  expectStatus,
  fakeGoogle,
  getGame,
  getInvite,
  getMyGames,
  makeHarness,
  parseBody,
  postAccept,
  postInvites,
  postRevoke,
  postStart,
  seatsOf,
  THREE_HUMAN,
} from './support';

const NAMES = {
  [ALICE.bearer]: { given_name: 'Alice' },
  [BOB.bearer]: { given_name: 'Bob' },
  [CAROL.bearer]: { given_name: 'Carol' },
} as const;

const named = () => makeHarness({ googleNames: NAMES });

/** A verifier that counts calls and can be told to throw. */
const countingGoogle = (inner: GoogleVerifier, mode: 'pass' | 'throw' = 'pass') => {
  const calls: (string | undefined)[] = [];
  const google: GoogleVerifier = {
    verify: (authorization) => {
      calls.push(authorization);
      if (mode === 'throw') throw new Error('tokeninfo unreachable');
      return inner.verify(authorization);
    },
  };
  return { google, calls };
};

const names = (body: unknown): readonly unknown[] => seatsOf(body).map((seat) => seat['name']);
const keysOf = (body: unknown): readonly (readonly string[])[] =>
  seatsOf(body).map((seat) => Object.keys(seat).sort());

describe('SCENARIOS.md 1 — create', () => {
  it('ok: the creator’s own chair carries the creator’s name', async () => {
    const h = named();
    const res = await postInvites(h.api, ALICE.bearer, { seats: ['creator', 'human', 'heuristic'] });
    expectStatus(res, 201);
    expect(seatsOf(parseBody(res))).toEqual([
      { kind: 'human', userHash: aliceHash(), name: 'Alice' },
      { kind: 'human' },
      { kind: 'heuristic' },
    ]);
  });

  it('alt bearer rejected: 401 and no invite written', async () => {
    const h = named();
    const res = await postInvites(h.api, EXPIRED_BEARER, { seats: ['creator', 'human', 'heuristic'] });
    expectStatus(res, 401);
    expect([...h.s3.keys()].some((key) => key.includes('/invites/'))).toBe(false);
  });

  it('alt plan invalid: 422 with no seats', async () => {
    const h = named();
    const res = await postInvites(h.api, ALICE.bearer, { seats: ['heuristic', 'heuristic', 'heuristic'] });
    expectStatus(res, 422);
    expect(res.body.includes('seats')).toBe(false);
  });

  it('a creator with no profile name gets no name key', async () => {
    const h = makeHarness();
    const res = await postInvites(h.api, ALICE.bearer, { seats: ['creator', 'human', 'heuristic'] });
    expect(keysOf(parseBody(res))).toEqual([['kind', 'userHash'], ['kind'], ['kind']]);
  });
});

describe('SCENARIOS.md 2 — peek', () => {
  const joined = async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, THREE_HUMAN);
    expectStatus(await postAccept(h.api, token, BOB.bearer), 200);
    return { h, token };
  };

  it('alt verified member (creator): names', async () => {
    const { h, token } = await joined();
    const res = await getInvite(h.api, token, ALICE.bearer);
    expectStatus(res, 200);
    expect(names(parseBody(res))).toEqual(['Alice', 'Bob', undefined]);
  });

  it('alt verified member (a joiner): names', async () => {
    const { h, token } = await joined();
    expect(names(parseBody(await getInvite(h.api, token, BOB.bearer)))).toEqual(['Alice', 'Bob', undefined]);
  });

  it('alt verified member through an agent chair only: names', async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, ['creator', 'agent', 'heuristic']);
    // Carol's agent took seat B; Carol holds no human chair.
    await postInvites(h.api, CAROL.bearer, { seats: ['creator', 'human', 'heuristic'] });
    const raw = JSON.parse(h.s3.get(inviteKey(token)) ?? '{}') as { seats: unknown[] };
    raw.seats[1] = { kind: 'agent', userHash: carolHash() };
    h.s3.set(inviteKey(token), JSON.stringify(raw));
    expect(names(parseBody(await getInvite(h.api, token, CAROL.bearer)))).toEqual(['Alice', 'Carol', undefined]);
  });

  it('alt no bearer: no names, and the verifier is not asked', async () => {
    const { h, token } = await joined();
    const counted = countingGoogle(fakeGoogle(NAMES));
    const peek = makeHarness({ s3: h.s3, google: counted.google });
    const res = await getInvite(peek.api, token);
    expectStatus(res, 200);
    expect(keysOf(parseBody(res))).toEqual([['kind', 'userHash'], ['kind', 'userHash'], ['kind']]);
    expect(counted.calls).toEqual([]);
  });

  it('alt bearer rejected: 200, no names, never 401', async () => {
    const { h, token } = await joined();
    const res = await getInvite(h.api, token, EXPIRED_BEARER);
    expectStatus(res, 200);
    expect(names(parseBody(res))).toEqual([undefined, undefined, undefined]);
  });

  it('alt verifier throws: 200, no names', async () => {
    const { h, token } = await joined();
    const peek = makeHarness({ s3: h.s3, google: countingGoogle(fakeGoogle(NAMES), 'throw').google });
    const res = await getInvite(peek.api, token, ALICE.bearer);
    expectStatus(res, 200);
    expect(names(parseBody(res))).toEqual([undefined, undefined, undefined]);
  });

  it('alt verified, not a member: no names', async () => {
    const { h, token } = await joined();
    await postInvites(h.api, CAROL.bearer, { seats: ['creator', 'human', 'heuristic'] });
    const res = await getInvite(h.api, token, CAROL.bearer);
    expectStatus(res, 200);
    expect(names(parseBody(res))).toEqual([undefined, undefined, undefined]);
  });

  it('a peek never writes a profile', async () => {
    const { h, token } = await joined();
    h.s3.delete(userProfileKey(aliceHash()));
    await getInvite(h.api, token, ALICE.bearer);
    expect(h.s3.has(userProfileKey(aliceHash()))).toBe(false);
  });

  it('alt no invite: 404', async () => {
    const h = named();
    expectStatus(await getInvite(h.api, 'ab'.repeat(32), ALICE.bearer), 404);
  });

  it('alt closed: 410 and no seats', async () => {
    const { h, token } = await joined();
    expectStatus(await postRevoke(h.api, token, ALICE.bearer), 200);
    const res = await getInvite(h.api, token, ALICE.bearer);
    expectStatus(res, 410);
    expect(res.body.includes('seats')).toBe(false);
  });
});

describe('SCENARIOS.md 3 — accept', () => {
  it('ok: the joiner sees names', async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, THREE_HUMAN);
    const res = await postAccept(h.api, token, BOB.bearer);
    expectStatus(res, 200);
    expect(names(parseBody(res))).toEqual(['Alice', 'Bob', undefined]);
  });

  it('alt already bound: names', async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, THREE_HUMAN);
    await postAccept(h.api, token, BOB.bearer);
    expect(names(parseBody(await postAccept(h.api, token, BOB.bearer)))).toEqual(['Alice', 'Bob', undefined]);
  });

  it('alt rejected: 401', async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, THREE_HUMAN);
    expectStatus(await postAccept(h.api, token, EXPIRED_BEARER), 401);
  });

  it('alt no free human chair: 409 with no seats', async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE);
    await postAccept(h.api, token, BOB.bearer);
    const res = await postAccept(h.api, token, CAROL.bearer);
    expectStatus(res, 409);
    expect(res.body.includes('seats')).toBe(false);
  });

  it('alt no invite: 404; closed: 410', async () => {
    const h = named();
    expectStatus(await postAccept(h.api, 'cd'.repeat(32), BOB.bearer), 404);
    const token = await createOpenInvite(h.api, ALICE);
    await postRevoke(h.api, token, ALICE.bearer);
    expectStatus(await postAccept(h.api, token, BOB.bearer), 410);
  });
});

describe('SCENARIOS.md 4 — game', () => {
  const started = async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE);
    await postAccept(h.api, token, BOB.bearer);
    expectStatus(await postStart(h.api, token, ALICE.bearer), 200);
    return h;
  };

  it('ok: every bound chair carries its owner’s name; the agent label is gone', async () => {
    const h = await started();
    const res = await getGame(h.api, aliceBobGroupHash(), GAME_ONE, BOB.bearer);
    expectStatus(res, 200);
    expect(seatsOf(parseBody(res))).toEqual([
      { kind: 'human', userHash: aliceHash(), name: 'Alice' },
      { kind: 'human', userHash: bobHash(), name: 'Bob' },
      { kind: 'heuristic' },
    ]);
  });

  it('alt profile missing or unreadable: that chair has no name key', async () => {
    const h = await started();
    h.s3.delete(userProfileKey(aliceHash()));
    h.s3.set(userProfileKey(bobHash()), '{not json');
    // GET game verifies the bearer but never writes a profile.
    const res = await getGame(h.api, aliceBobGroupHash(), GAME_ONE, ALICE.bearer);
    expect(keysOf(parseBody(res))).toEqual([['kind', 'userHash'], ['kind', 'userHash'], ['kind']]);
  });

  it('alt not a member: 403, no seats', async () => {
    const h = await started();
    const res = await getGame(h.api, aliceBobGroupHash(), GAME_ONE, CAROL.bearer);
    expect(res.statusCode).toBe(403);
    expect(res.body.includes('seats')).toBe(false);
  });

  it('alt bearer rejected: 401, no seats', async () => {
    const h = await started();
    const res = await getGame(h.api, aliceBobGroupHash(), GAME_ONE, EXPIRED_BEARER);
    expectStatus(res, 401);
    expect(res.body.includes('seats')).toBe(false);
  });

  it('alt unknown game: 404, no seats', async () => {
    const h = await started();
    const res = await getGame(h.api, aliceBobGroupHash(), '000099', ALICE.bearer);
    expectStatus(res, 404);
    expect(res.body.includes('seats')).toBe(false);
  });
});

describe('SCENARIOS.md 5 — my games', () => {
  it('labels come from the one table', async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, THREE_HUMAN);
    await postAccept(h.api, token, BOB.bearer);
    await postAccept(h.api, token, CAROL.bearer);
    expectStatus(await postStart(h.api, token, ALICE.bearer), 200);
    h.s3.delete(userProfileKey(carolHash()));
    const body = parseBody(await getMyGames(h.api, ALICE.bearer)) as {
      games: { seats: { label: string; you: boolean }[] }[];
    };
    expect(body.games[0]?.seats.map((seat) => [seat.label, seat.you])).toEqual([
      ['you', true],
      ['Bob', false],
      ['Player C', false],
    ]);
  });

  const agentGame = async () => {
    const h = named();
    const token = await createOpenInvite(h.api, ALICE, ['creator', 'agent', 'human']);
    await postAccept(h.api, token, BOB.bearer);
    // Start needs the agent bound (409 otherwise); bind it to Alice, as the MCP door would.
    {
      const raw = JSON.parse(h.s3.get(inviteKey(token)) ?? '{}') as { seats: unknown[] };
      raw.seats[1] = { kind: 'agent', userHash: aliceHash() };
      h.s3.set(inviteKey(token), JSON.stringify(raw));
    }
    expectStatus(await postStart(h.api, token, ALICE.bearer), 200);
    const row = async (bearer: string) =>
      (parseBody(await getMyGames(h.api, bearer)) as { games: { seats: { label: string; you: boolean }[] }[] })
        .games[0]?.seats.map((seat) => [seat.label, seat.you]);
    return { h, row };
  };

  it('an agent chair: your agent for its owner, <name>’s agent for the others', async () => {
    const { row } = await agentGame();
    expect(await row(ALICE.bearer)).toEqual([['you', true], ['your agent', true], ['Bob', false]]);
    expect(await row(BOB.bearer)).toEqual([['Alice', false], ["Alice's agent", false], ['you', true]]);
  });

  it('alt rejected: 401', async () => {
    const h = named();
    expectStatus(await getMyGames(h.api, EXPIRED_BEARER), 401);
  });
});

describe('withSeatNames (EARS 5)', () => {
  it('adds only `name`, only to bound human and agent chairs with a profile name', async () => {
    const s3 = new Map<string, string>([
      [userProfileKey('h1'), JSON.stringify({ displayName: 'Hana' })],
      [userProfileKey('h2'), JSON.stringify({})],
    ]);
    const got = await withSeatNames(mapStore(s3), [
      { kind: 'human', userHash: 'h1' },
      { kind: 'agent', userHash: 'h1' },
      { kind: 'human', userHash: 'h2' },
      { kind: 'agent', userHash: 'h3' },
      { kind: 'human' },
      { kind: 'agent' },
      { kind: 'heuristic' },
    ]);
    expect(got).toStrictEqual([
      { kind: 'human', userHash: 'h1', name: 'Hana' },
      { kind: 'agent', userHash: 'h1', name: 'Hana' },
      { kind: 'human', userHash: 'h2' },
      { kind: 'agent', userHash: 'h3' },
      { kind: 'human' },
      { kind: 'agent' },
      { kind: 'heuristic' },
    ]);
  });

  it('reads each user’s profile once', async () => {
    const reads: string[] = [];
    const s3 = new Map<string, string>([[userProfileKey('h1'), JSON.stringify({ displayName: 'Hana' })]]);
    const inner = mapStore(s3);
    const store = { ...inner, get: (key: string) => { reads.push(key); return inner.get(key); } };
    await withSeatNames(store, [
      { kind: 'human', userHash: 'h1' },
      { kind: 'agent', userHash: 'h1' },
      { kind: 'human' },
      { kind: 'agent' },
      { kind: 'heuristic' },
    ]);
    // An unbound or heuristic chair has no user, so no profile is read for it.
    expect(reads).toEqual([userProfileKey('h1')]);
  });
});
