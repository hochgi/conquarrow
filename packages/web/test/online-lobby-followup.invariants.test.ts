/**
 * EARS invariants for docs/spec/online-lobby-followup/online-lobby-followup.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/online-shell.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  createBrowserGis,
  gisOneTapFailed,
  type BrowserGisId,
} from '../src/online-gis';
import { CREATING_INVITE_COPY } from '../src/online-shell-ui';
import {
  coerceOnlineSeatPlan,
  defaultSeat,
  defaultSeatPlan,
  pickOnlineSeat,
  type PlaytestPlayerCount,
  type SeatKind,
  type SeatPlan,
} from '../src/seatPlan';
import {
  ALICE,
  INVITE_TOKEN,
  TWO_HUMAN_HEURISTIC,
  apiCalls,
  createdInviteBody,
  hungCreateInvite,
  inviteHash,
  makeHostHarness,
  peekInviteScript,
  aliceHostSeats,
} from './online-shell.support';
import {
  DEFAULT_ENV,
  gisNotification,
  injectedGisId,
  type GisMomentKind,
} from './online-web.support';

const planFromKinds = (kinds: readonly SeatKind[]): SeatPlan => {
  if (kinds.length !== 3 && kinds.length !== 6) {
    throw new Error(`test: playerCount must be 3 or 6, got ${String(kinds.length)}`);
  }
  return { playerCount: kinds.length, seats: kinds.map((kind) => defaultSeat(kind)) };
};

const planWithHumans = (playerCount: PlaytestPlayerCount, humans: number): SeatPlan => {
  const seats = Array.from({ length: playerCount }, (_, i) =>
    defaultSeat(i < humans ? 'human' : 'heuristic'),
  );
  return { playerCount, seats };
};

describe('online-lobby-followup invariants', () => {
  it('creating copy is the locked P27 shell sentence', () => {
    expect(CREATING_INVITE_COPY).toBe(
      'Creating your unique invite link - this may take a few moments…',
    );
  });

  it('When POST /invites is in flight, the host shall report createInvitePending and shall not offer Create', async () => {
    const hung = hungCreateInvite();
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [hung.script],
    });
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);

    const creating = h.host.createInvite();
    expect(h.host.createInvitePending()).toBe(true);
    expect(h.host.createOffered()).toBe(false);
    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(1);

    hung.settle(201, createdInviteBody(INVITE_TOKEN));
    await creating;
  });

  it('When that POST settles, the host shall not report createInvitePending', async () => {
    const outcomes: readonly { readonly status: number; readonly body: unknown }[] = [
      { status: 201, body: createdInviteBody(INVITE_TOKEN) },
      { status: 500, body: { error: 'failed' } },
    ];
    for (const outcome of outcomes) {
      const hung = hungCreateInvite();
      const h = makeHostHarness({
        sessionToken: ALICE.bearer,
        fetchScript: [hung.script],
      });
      await h.host.boot();
      h.host.selectMode('online');
      h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);

      const creating = h.host.createInvite();
      expect(h.host.createInvitePending(), String(outcome.status)).toBe(true);
      hung.settle(outcome.status, outcome.body);
      await creating;
      expect(h.host.createInvitePending(), String(outcome.status)).toBe(false);
    }
  });

  it('When Create is pending, the system shall not start a second POST /invites', async () => {
    const hung = hungCreateInvite();
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [hung.script],
    });
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);

    const first = h.host.createInvite();
    const second = h.host.createInvite();
    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(1);

    hung.settle(201, createdInviteBody(INVITE_TOKEN));
    await first;
    await second;
  });

  it('When lobby mode becomes Online, the system shall set seat indices 0 and 1 to human', () => {
    const samples: readonly (readonly SeatKind[])[] = [
      ['human', 'heuristic', 'heuristic'],
      ['heuristic', 'heuristic', 'heuristic'],
      ['byok', 'byok', 'byok'],
      ['human', 'human', 'human'],
      ['byok', 'human', 'heuristic'],
      ['heuristic', 'heuristic', 'heuristic', 'heuristic', 'heuristic', 'heuristic'],
      ['byok', 'byok', 'byok', 'human', 'heuristic', 'byok'],
      ['human', 'byok', 'human', 'byok', 'human', 'byok'],
    ];
    for (const kinds of samples) {
      const coerced = coerceOnlineSeatPlan(planFromKinds(kinds));
      const label = kinds.join(',');
      expect(coerced.seats[0]?.kind, label).toBe('human');
      expect(coerced.seats[1]?.kind, label).toBe('human');
      for (let i = 2; i < kinds.length; i += 1) {
        const original = kinds[i];
        const want = original === 'byok' ? 'heuristic' : original;
        expect(coerced.seats[i]?.kind, `${label} @${String(i)}`).toBe(want);
      }
    }
  });

  it('P106 (replaces the 3-human-chair rule): every online pick is applied', () => {
    const cases: readonly { readonly playerCount: PlaytestPlayerCount; readonly humans: number }[] = [
      { playerCount: 3, humans: 1 },
      { playerCount: 3, humans: 2 },
      { playerCount: 3, humans: 3 },
      { playerCount: 6, humans: 1 },
      { playerCount: 6, humans: 6 },
    ];
    for (const { playerCount, humans } of cases) {
      const plan = planWithHumans(playerCount, humans);
      expect(
        pickOnlineSeat(plan, 0, 'heuristic').seats[0]?.kind,
        `${String(playerCount)}p ${String(humans)} humans`,
      ).toBe('heuristic');
    }
  });

  it('When Local mode is selected, the system shall still allow a plan with one human chair', () => {
    for (const playerCount of [3, 6] as const) {
      const plan = defaultSeatPlan(playerCount);
      expect(plan.seats[0]?.kind, String(playerCount)).toBe('human');
      expect(
        plan.seats.slice(1).every((seat) => seat.kind === 'heuristic'),
        String(playerCount),
      ).toBe(true);
    }
  });

  it('When the unsigned player clicks Sign-In, the host shall call GIS offerChooser', async () => {
    const h = makeHostHarness();
    await h.host.boot();
    h.host.selectMode('online');

    h.host.promptSignIn();

    expect(h.gis.offerChooserCount).toBeGreaterThan(0);
    expect(h.gis.promptCount).toBe(0);
  });

  it('When GIS One Tap is not displayed, skipped, or dismissed, the GIS adapter shall offer a chooser', () => {
    const failed: readonly GisMomentKind[] = ['not-displayed', 'skipped', 'dismissed'];
    for (const kind of failed) {
      expect(gisOneTapFailed(gisNotification(kind)), kind).toBe(true);
      const injected = injectedGisId(gisNotification(kind));
      const gis = createBrowserGis(DEFAULT_ENV.VITE_GOOGLE_CLIENT_ID, () => {}, {
        gisId: injected,
      });
      gis.prompt();
      expect(injected.renderButtonCount, kind).toBeGreaterThan(0);
    }
    const displayed = injectedGisId(gisNotification('displayed'));
    const gisDisplayed = createBrowserGis(DEFAULT_ENV.VITE_GOOGLE_CLIENT_ID, () => {}, {
      gisId: displayed,
    });
    gisDisplayed.prompt();
    expect(gisOneTapFailed(gisNotification('displayed'))).toBe(false);
    expect(displayed.renderButtonCount).toBe(0);
  });

  it('GIS One Tap and offerChooser share the ID-token callback and cancel_on_tap_outside false', () => {
    const tokens: string[] = [];
    let initializeCount = 0;
    let cancelOnTapOutside: boolean | undefined;
    let callback: ((response: { readonly credential?: string }) => void) | undefined;
    let renderButtonCount = 0;
    const gisId: BrowserGisId = {
      initialize: (config) => {
        initializeCount += 1;
        cancelOnTapOutside = config.cancel_on_tap_outside;
        callback = config.callback;
      },
      prompt: () => {},
      renderButton: () => {
        renderButtonCount += 1;
      },
    };
    const gis = createBrowserGis(DEFAULT_ENV.VITE_GOOGLE_CLIENT_ID, (token) => {
      tokens.push(token);
    }, { gisId });

    gis.prompt();
    gis.offerChooser();
    callback?.({ credential: 'id-token' });

    expect({
      initializeCount,
      cancelOnTapOutside,
      renderButtonCount,
      tokens,
    }).toEqual({
      initializeCount: 1,
      cancelOnTapOutside: false,
      renderButtonCount: 1,
      tokens: ['id-token'],
    });
  });

  it('When an unsigned invite hash boots, the adapter shall One Tap prompt and shall not require offerChooser', async () => {
    const h = makeHostHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, aliceHostSeats())],
    });

    await h.host.boot();

    expect(h.gis.promptCount).toBeGreaterThanOrEqual(1);
    expect(h.gis.offerChooserCount).toBe(0);
  });
});
