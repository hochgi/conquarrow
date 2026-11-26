/**
 * docs/spec/online-lobby-followup/online-lobby-followup.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/online-lobby-followup/online-lobby-followup.md
 */

import { describe, expect, it } from 'vitest';
import { createBrowserGis } from '../src/online-gis';
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
  TWO_HUMAN_HEURISTIC,
  aliceHostSeats,
  apiCalls,
  hungCreateInvite,
  inviteHash,
  makeHostHarness,
  peekInviteScript,
  type HostHarness,
} from './online-shell.support';
import {
  DEFAULT_ENV,
  gisNotification,
  injectedGisId,
} from './online-web.support';

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

describe('Create settle and single flight', () => {
  it('Create failure clears pending and has no invite URL', async () => {
    const hung = hungCreateInvite();
    const h = await bootSignedOnline({ fetchScript: [hung.script] });

    const creating = h.host.createInvite();
    expect(h.host.createInvitePending()).toBe(true);

    hung.settle(500, { error: 'failed' });
    await creating;

    expect(h.host.createInvitePending()).toBe(false);
    expect(h.host.copiedInviteUrl()).toBeUndefined();
  });

  it('A second Create while pending does not POST again', async () => {
    const hung = hungCreateInvite();
    const h = await bootSignedOnline({ fetchScript: [hung.script] });

    const first = h.host.createInvite();
    const second = h.host.createInvite();

    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(1);

    hung.settle(201, { token: INVITE_TOKEN, seats: aliceHostSeats() });
    await first;
    await second;
  });
});

describe('Local and extra chairs', () => {
  it('Local still allows one Player', () => {
    const plan = defaultSeatPlan(3);

    expect(plan.seats[0]?.kind).toBe('human');
    expect(plan.seats[1]?.kind).toBe('heuristic');
    expect(plan.seats[2]?.kind).toBe('heuristic');
  });

  it('Online coerce maps leftover BYOK to AI', () => {
    const local = planFromKinds(['byok', 'byok', 'byok']);

    const online = coerceOnlineSeatPlan(local);

    expect(online.seats[0]?.kind).toBe('human');
    expect(online.seats[1]?.kind).toBe('human');
    expect(online.seats[2]?.kind).toBe('heuristic');
  });

  it('Online AI to Player is always allowed', () => {
    const plan = planFromKinds(['human', 'human', 'heuristic']);

    expect(pickOnlineSeat(plan, 2, 'human').seats[2]?.kind).toBe('human');
  });
});

describe('GIS One Tap vs chooser', () => {
  it('One Tap skip still offers a chooser', () => {
    const injected = injectedGisId(gisNotification('skipped'));
    const gis = createBrowserGis(DEFAULT_ENV.VITE_GOOGLE_CLIENT_ID, () => {}, {
      gisId: injected,
    });

    gis.prompt();

    expect(injected.renderButtonCount).toBeGreaterThan(0);
  });

  it('Unsigned invite hash still One Taps', async () => {
    const h = makeHostHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, aliceHostSeats())],
    });

    await h.host.boot();

    expect(h.gis.promptCount).toBeGreaterThanOrEqual(1);
    expect(h.gis.offerChooserCount).toBe(0);
  });
});
