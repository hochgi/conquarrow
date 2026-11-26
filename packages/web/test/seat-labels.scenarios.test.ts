/**
 * docs/spec/seat-labels/SCENARIOS.md — the client paths (2 and 4) as
 * component tests. The host is the component; `PagesApi.send` is the leaf.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { rosterLabel } from '../src/seatLabel';
import { ALICE, GAME_ONE, GROUP_HASH, INVITE_TOKEN, gameHash, inviteHash, openingBoard } from './online-web.support';
import { bearerOf, createScenarioRig, http, once, onceThrow, sent, type ScenarioRig } from './session-expired.scenarios.support';

let rig: ScenarioRig;
afterEach(async () => {
  await rig.close();
});

const INVITE_PATH = `/invites/${INVITE_TOKEN}`;
const GAME_PATH = `/games/${GROUP_HASH}/${GAME_ONE}`;
const peeks = () => sent(rig).filter((request) => request.url.endsWith(INVITE_PATH));

const namedSeats = [
  { kind: 'human', userHash: ALICE.userHash, name: 'Alice' },
  { kind: 'human', userHash: 'bob-hash', name: 'Bob' },
  { kind: 'heuristic' },
];

describe('SCENARIOS.md 2 — the peek, client side', () => {
  it('signed in: the peek carries the bearer, and names reach the roster', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: inviteHash(INVITE_TOKEN) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    once(rig, 'GET', INVITE_PATH, http(200, { token: INVITE_TOKEN, seats: namedSeats }));

    await rig.host.boot();

    expect(peeks().map(bearerOf)).toEqual([ALICE.bearer]);
    const seats = rig.host.adapter().inviteSeats() ?? [];
    expect(seats.map((seat, index) => rosterLabel(seat, index, rig.host.adapter().userHash()))).toEqual([
      'you',
      'Bob',
      'AI',
    ]);
  });

  it('signed out: no Authorization, and no names means Player letters', async () => {
    rig = createScenarioRig({ hash: inviteHash(INVITE_TOKEN) });
    once(
      rig,
      'GET',
      INVITE_PATH,
      http(200, {
        token: INVITE_TOKEN,
        seats: [{ kind: 'human', userHash: ALICE.userHash }, { kind: 'human' }, { kind: 'heuristic' }],
      }),
    );

    await rig.host.boot();

    expect(peeks().map(bearerOf)).toEqual([undefined]);
    const seats = rig.host.adapter().inviteSeats() ?? [];
    expect(seats.map((seat, index) => rosterLabel(seat, index, undefined))).toEqual(['Player A', 'waiting', 'AI']);
  });

  it('alt a 401 on the peek changes nothing: no seats, not expired', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: inviteHash(INVITE_TOKEN) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    once(rig, 'GET', INVITE_PATH, http(401, { error: 'unauthorized' }));

    await rig.host.boot();

    expect({ seats: rig.host.adapter().inviteSeats(), expired: rig.host.sessionExpired() }).toEqual({
      seats: undefined,
      expired: false,
    });
  });

  it('alt 410: the invite is gone, no seats', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: inviteHash(INVITE_TOKEN) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    once(rig, 'GET', INVITE_PATH, http(410, { reason: 'revoked' }));

    await rig.host.boot();

    expect({ seats: rig.host.adapter().inviteSeats(), gone: rig.host.adapter().inviteGoneReason() }).toEqual({
      seats: undefined,
      gone: 'revoked',
    });
  });

  it('alt network failure: the boot rejects as before, and no seats are set', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: inviteHash(INVITE_TOKEN) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    onceThrow(rig, 'GET', INVITE_PATH);

    await expect(rig.host.boot()).rejects.toThrow('network down');
    expect(rig.host.adapter().inviteSeats()).toBeUndefined();
  });
});

describe('SCENARIOS.md 3 — accept, client side', () => {
  const ACCEPT_PATH = `${INVITE_PATH}/accept`;
  const waiting = [{ kind: 'human', userHash: 'bob-hash' }, { kind: 'human' }, { kind: 'heuristic' }];

  it('200: the joiner sees names on the roster', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: inviteHash(INVITE_TOKEN) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    once(rig, 'GET', INVITE_PATH, http(200, { token: INVITE_TOKEN, seats: waiting }));
    once(
      rig,
      'POST',
      ACCEPT_PATH,
      http(200, {
        token: INVITE_TOKEN,
        seats: [{ kind: 'human', userHash: 'bob-hash', name: 'Bob' }, { kind: 'human', userHash: ALICE.userHash, name: 'Alice' }, { kind: 'heuristic' }],
      }),
    );
    await rig.host.boot();

    await rig.host.acceptInvite();

    const seats = rig.host.adapter().inviteSeats() ?? [];
    expect(seats.map((seat, index) => rosterLabel(seat, index, ALICE.userHash))).toEqual(['Bob', 'you', 'AI']);
  });

  it('alt 409: the lobby is full and the roster keeps the peeked chairs', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: inviteHash(INVITE_TOKEN) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    once(rig, 'GET', INVITE_PATH, http(200, { token: INVITE_TOKEN, seats: waiting }));
    once(rig, 'POST', ACCEPT_PATH, http(409, { error: 'full' }));
    await rig.host.boot();

    await rig.host.acceptInvite();

    expect({ full: rig.host.adapter().lobbyFull(), seats: rig.host.adapter().inviteSeats() }).toStrictEqual({
      full: true,
      seats: waiting,
    });
  });
});

describe('SCENARIOS.md 4 — the game body, client side', () => {
  it('names on the chairs reach board().seats', async () => {
    rig = createScenarioRig({ sessionToken: ALICE.bearer, hash: gameHash(GROUP_HASH, GAME_ONE) });
    once(rig, 'GET', '/me', http(200, { userHash: ALICE.userHash }));
    once(rig, 'GET', GAME_PATH, http(200, { ...openingBoard('named'), seats: namedSeats }));

    await rig.host.boot();

    expect(rig.host.board()?.seats).toStrictEqual(namedSeats);
  });
});
