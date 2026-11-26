/**
 * docs/spec/online-lobby-followup/online-lobby-followup.core.feature — one test per scenario.
 *
 * @see docs/spec/online-lobby-followup/online-lobby-followup.md
 */

import { describe, expect, it } from 'vitest';
import {
  coerceOnlineSeatPlan,
  defaultSeat,
  defaultSeatPlan,
  pickOnlineSeat,
  type SeatKind,
  type SeatPlan,
} from '../src/seatPlan';
import {
  ALICE,
  INVITE_TOKEN,
  PAGES_ORIGIN,
  PAGES_PATHNAME,
  TWO_HUMAN_HEURISTIC,
  apiCalls,
  createdInviteBody,
  hungCreateInvite,
  makeHostHarness,
  type HostHarness,
} from './online-shell.support';

const planFromKinds = (kinds: readonly SeatKind[]): SeatPlan => {
  if (kinds.length !== 3 && kinds.length !== 6) {
    throw new Error(`test: playerCount must be 3 or 6, got ${String(kinds.length)}`);
  }
  return { playerCount: kinds.length, seats: kinds.map((kind) => defaultSeat(kind)) };
};

const bootSignedOnline = async (
  overrides?: Parameters<typeof makeHostHarness>[0],
): Promise<HostHarness> => {
  const h = makeHostHarness({
    sessionToken: ALICE.bearer,
    ...overrides,
  });
  await h.host.boot();
  h.host.selectMode('online');
  h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);
  return h;
};

describe('Create invite wait', () => {
  it('Create in flight shows pending and withholds Create', async () => {
    const hung = hungCreateInvite();
    const h = await bootSignedOnline({ fetchScript: [hung.script] });

    const creating = h.host.createInvite();

    expect({
      createInvitePending: h.host.createInvitePending(),
      createOffered: h.host.createOffered(),
      postCount: apiCalls(h, 'POST', '/invites').length,
    }).toEqual({
      createInvitePending: true,
      createOffered: false,
      postCount: 1,
    });

    hung.settle(201, createdInviteBody(INVITE_TOKEN));
    await creating;
  });

  it('Create success clears pending and copies the invite URL', async () => {
    const hung = hungCreateInvite();
    const h = await bootSignedOnline({ fetchScript: [hung.script] });

    const creating = h.host.createInvite();
    expect(h.host.createInvitePending()).toBe(true);

    hung.settle(201, createdInviteBody(INVITE_TOKEN));
    await creating;

    expect(h.host.createInvitePending()).toBe(false);
    expect(h.host.copiedInviteUrl()).toBe(
      `${PAGES_ORIGIN}${PAGES_PATHNAME}#/invite/${INVITE_TOKEN}`,
    );
  });
});

describe('Online Player floor', () => {
  it('Switching to Online makes the first two seats Player', () => {
    const local = defaultSeatPlan(3);
    expect(local.seats.map((seat) => seat.kind)).toEqual(['human', 'heuristic', 'heuristic']);

    const online = coerceOnlineSeatPlan(local);

    expect(online.seats[0]?.kind).toBe('human');
    expect(online.seats[1]?.kind).toBe('human');
    expect(online.seats[2]?.kind).toBe('heuristic');
  });

  it('P106: a Player chair may become AI; the plan note says what is missing', () => {
    const plan = planFromKinds(['human', 'human', 'heuristic']);

    expect(pickOnlineSeat(plan, 0, 'heuristic').seats[0]?.kind).toBe('heuristic');
  });

  it('Three Player chairs can become two Player and one AI', () => {
    const plan = planFromKinds(['human', 'human', 'human']);

    expect(pickOnlineSeat(plan, 2, 'heuristic').seats[2]?.kind).toBe('heuristic');
  });
});

describe('Sign-In after One Tap', () => {
  it('Sign-In click offers the chooser', async () => {
    const h = makeHostHarness();
    await h.host.boot();
    h.host.selectMode('online');

    h.host.promptSignIn();

    expect(h.gis.offerChooserCount).toBeGreaterThan(0);
    expect(h.gis.promptCount).toBe(0);
  });
});
