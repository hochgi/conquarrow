/**
 * An expired sign-in looks signed out — happy path.
 * Scripted fetch at the host, not test-kit. Diagram paths are named on each test.
 *
 * @see docs/spec/session-expired/session-expired.core.feature
 * @see docs/spec/session-expired/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import { onlinePlanProblem } from '@conquarrow/contracts';
import {
  NEEDS_ANOTHER_NOTE,
  LIBRARY_FAILED_COPY,
  NO_GAMES_COPY,
  SESSION_EXPIRED_COPY,
  createPlanNote,
} from '../src/online-shell-ui';
import { apiCalls } from './online-web.support';
import {
  PLAYER_AND_AGENT,
  armCreate,
  chooserOffered,
  createdInvite,
  credentialToken,
  emptyLibrary,
  expiredNote,
  expiredToken,
  frozenHost,
  hourToken,
  isEmptySuccess,
  minuteToken,
  noticeOf,
  scripted,
  settlementOf,
  storedToken,
} from './session-expired.support';

describe('A usable token is the only signed-in bit (D1)', () => {
  it('An expired token reports signed out and offers the chooser', () => {
    // SCENARIOS.md §1 — exp not after now, no request
    const token = expiredToken();
    const h = frozenHost({ sessionToken: token });

    const signedIn = h.host.signedIn();

    expect({
      signedIn,
      token: storedToken(h),
      expired: h.host.sessionExpired(),
      note: expiredNote(h),
      chooser: chooserOffered(h),
      requests: h.fetchLog.length,
    }).toEqual({
      signedIn: false,
      token: null,
      expired: false,
      note: undefined,
      chooser: true,
      requests: 0,
    });
  });

  it('A token one minute from expiry reports signed in', () => {
    const token = minuteToken();
    const h = frozenHost({ sessionToken: token });

    expect({
      signedIn: h.host.signedIn(),
      token: storedToken(h),
      chooser: chooserOffered(h),
    }).toEqual({
      signedIn: true,
      token,
      chooser: false,
    });
  });
});

describe('A 401 on create is retried once after the next credential (D3)', () => {
  it('A create answered 401 is retried once and then shows the link', async () => {
    // SCENARIOS.md §2 alt 401, then retry 201 on the lobby
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [
        scripted('POST', '/invites', 401, { error: 'unauthorized' }),
        createdInvite(),
        emptyLibrary(),
      ],
    });
    armCreate(h);

    const settled = await settlementOf(() => h.host.createInvite());
    const afterCreate = {
      settled,
      pending: h.host.createInvitePending(),
      link: h.host.copiedInviteUrl(),
      note: h.host.createInviteNote(),
      expired: h.host.sessionExpired(),
      signedIn: h.host.signedIn(),
      token: storedToken(h),
      expiredNote: expiredNote(h),
      chooser: chooserOffered(h),
      prompts: h.gis.promptCount,
    };

    await h.host.handleGisCredential(credentialToken());

    expect({
      afterCreate,
      afterCredential: {
        signedIn: h.host.signedIn(),
        expired: h.host.sessionExpired(),
        linkShown: h.host.copiedInviteUrl() !== undefined,
        posts: apiCalls(h, 'POST', '/invites').length,
        libraryReads: apiCalls(h, 'GET', '/my-games').length,
      },
    }).toEqual({
      afterCreate: {
        settled: 'resolved',
        pending: false,
        link: undefined,
        note: undefined,
        expired: true,
        signedIn: false,
        token: null,
        expiredNote: SESSION_EXPIRED_COPY,
        chooser: true,
        prompts: 1,
      },
      afterCredential: {
        signedIn: true,
        expired: false,
        linkShown: true,
        posts: 2,
        libraryReads: 1,
      },
    });
  });
});

describe('Empty is a successful library read (D5)', () => {
  it('A library of zero games is empty, not failed', async () => {
    // SCENARIOS.md §3 alt 200 with zero games
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [emptyLibrary()],
    });

    await h.host.refreshLibrary();

    const notice = noticeOf(h);
    expect({
      failed: h.host.libraryFailed(),
      expired: h.host.sessionExpired(),
      notice,
      emptyCopy: notice === 'empty' ? NO_GAMES_COPY : undefined,
      failedCopy: notice === 'failed' ? LIBRARY_FAILED_COPY : undefined,
      emptySuccess: isEmptySuccess(h.host.adapter().myGames()),
    }).toEqual({
      failed: false,
      expired: false,
      notice: 'empty',
      emptyCopy: NO_GAMES_COPY,
      failedCopy: undefined,
      emptySuccess: true,
    });
  });
});

describe('The seat-plan sentence matches the rule (D7)', () => {
  it('One Player and one Agent does not show the seat-plan note', () => {
    const h = frozenHost({ sessionToken: hourToken() });
    h.host.selectMode('online');
    h.host.setSeatPlan(PLAYER_AND_AGENT);

    expect({
      signedIn: h.host.signedIn(),
      note: createPlanNote(onlinePlanProblem(PLAYER_AND_AGENT)),
      sentence: NEEDS_ANOTHER_NOTE,
    }).toEqual({
      signedIn: true,
      note: undefined,
      sentence: 'Create needs you and at least one more Player or Agent.',
    });
  });
});
