/**
 * EARS invariants for an expired sign-in. Table-driven — this repo has no
 * fast-check. No turn-flow replay: the packet does not touch apply().
 *
 * @see docs/spec/session-expired/session-expired.md
 */

import { describe, expect, it } from 'vitest';
import { GOOGLE_ID_TOKEN_SESSION_KEY, onlinePlanProblem, type PlannedSeatKind } from '@conquarrow/contracts';
import { onlinePlanCreatable } from '../src/online-pages';
import { tokenExpiryMs } from '../src/online-session';
import { submitNote } from '../src/online-submit';
import {
  CREATE_FAILED_COPY,
  NEEDS_ANOTHER_NOTE,
  PICK_YOUR_SEAT_NOTE,
  CREATE_REFUSED_COPY,
  createPlanNote,
  createRefusedNote,
} from '../src/online-shell-ui';
import { pass } from './online-move-log-replay.support';
import {
  GAME_ONE,
  GROUP_HASH,
  apiCalls,
  gameHash,
  getGameScript,
  openingBoard,
  postMoveScript,
  tokenExpiringAt,
} from './online-web.support';
import {
  DOOR_401,
  GAME_PATH,
  LEAD_ACTIONS,
  PLAYER_AND_AGENT,
  TWO_PLAYERS,
  armCreate,
  bears,
  createAnswered401,
  createdInvite,
  credentialToken,
  emptyLibrary,
  expiredToken,
  frozenHost,
  frozenNow,
  hourToken,
  invitePostBody,
  isEmptySuccess,
  minuteToken,
  noticeOf,
  scripted,
  settlementOf,
  storedToken,
  submitIds,
  thrown,
  tokenWithClaims,
  type DoorAction,
  type LeadAction,
} from './session-expired.support';

const usable = (token: string | undefined, now: number): boolean => {
  if (token === undefined || token === '') return false;
  const expiry = tokenExpiryMs(token);
  return expiry !== undefined && expiry > now;
};

describe('session-expired invariants', () => {
  it('reports signed in only while the store holds a token whose exp is finite and strictly after now', () => {
    const now = frozenNow();
    const cases = [
      { name: 'missing', token: undefined, usable: false },
      { name: 'empty', token: '', usable: false },
      { name: 'opaque', token: 'alice-id-token', usable: false },
      { name: 'exp string', token: tokenWithClaims({ exp: 'soon' }), usable: false },
      { name: 'exp now', token: tokenExpiringAt(now), usable: false },
      { name: 'expired', token: expiredToken(), usable: false },
      { name: 'minute', token: minuteToken(), usable: true },
      { name: 'hour', token: hourToken(), usable: true },
    ];

    expect(
      cases.map((row) => {
        const h = frozenHost(
          row.token === undefined || row.token === '' ? {} : { sessionToken: row.token },
        );
        if (row.token === '') h.session.setItem(GOOGLE_ID_TOKEN_SESSION_KEY, '');
        return {
          name: row.name,
          usable: usable(row.token === '' ? '' : row.token, now),
          signedIn: h.host.signedIn(),
        };
      }),
    ).toEqual(cases.map((row) => ({ name: row.name, usable: row.usable, signedIn: row.usable })));
  });

  it('removes an unusable token, reports signed out, and does not set session expired', () => {
    const now = frozenNow();
    const tokens = [
      'alice-id-token',
      tokenWithClaims({ exp: 'soon' }),
      tokenWithClaims({ exp: Number.NaN }),
      tokenExpiringAt(now),
      expiredToken(),
    ];

    expect(
      tokens.map((token) => {
        const h = frozenHost({ sessionToken: token });
        const signedIn = h.host.signedIn();
        return {
          signedIn,
          token: storedToken(h),
          again: h.host.signedIn(),
          expired: h.host.sessionExpired(),
        };
      }),
    ).toEqual(
      tokens.map(() => ({
        signedIn: false,
        token: null,
        again: false,
        expired: false,
      })),
    );
  });

  it('an authenticated 401 removes the token, forgets the socket, expires the session, and prompts once even if already prompted', async () => {
    const actions = Object.keys(DOOR_401) as DoorAction[];
    const doors = await Promise.all(actions.map(async (action) => {
      const result = await DOOR_401[action](hourToken());
      const framesBefore = result.h.sockets.reduce((n, socket) => n + socket.sent.length, 0);
      result.h.host.handleHeartbeat();
      const framesAfter = result.h.sockets.reduce((n, socket) => n + socket.sent.length, 0);
      return {
        action,
        sent: result.sent > 0,
        expired: result.h.host.sessionExpired(),
        signedIn: result.h.host.signedIn(),
        token: storedToken(result.h),
        prompts: result.prompts,
        heartbeat: framesAfter - framesBefore,
      };
    }));

    const token = minuteToken();
    const prompted = frozenHost({
      sessionToken: token,
      fetchScript: [
        emptyLibrary(),
        scripted('GET', '/my-games', 401, { error: 'unauthorized' }),
      ],
    });
    await prompted.host.handleVisibility(true);
    const promptsBefore = prompted.gis.promptCount;
    await prompted.host.refreshLibrary();

    expect({
      doors,
      alreadyPrompted: {
        promptedBefore: promptsBefore > 0,
        extra: prompted.gis.promptCount - promptsBefore,
        expired: prompted.host.sessionExpired(),
        signedIn: prompted.host.signedIn(),
        token: storedToken(prompted),
      },
    }).toEqual({
      doors: actions.map((action) => ({
        action,
        sent: true,
        expired: true,
        signedIn: false,
        token: null,
        prompts: 1,
        heartbeat: 0,
      })),
      alreadyPrompted: {
        promptedBefore: true,
        extra: 1,
        expired: true,
        signedIn: false,
        token: null,
      },
    });
  });

  it('a create that is not a success resolves, is not pending, and exposes a note', async () => {
    const rows = [
      { name: '422', script: scripted('POST', '/invites', 422, { error: 'unprocessable' }), note: CREATE_REFUSED_COPY },
      { name: '422 reason', script: scripted('POST', '/invites', 422, { error: 'unprocessable', reason: 'seats' }), note: createRefusedNote('seats') },
      { name: '500', script: scripted('POST', '/invites', 500, { error: 'internal' }), note: CREATE_FAILED_COPY },
      { name: '403', script: scripted('POST', '/invites', 403, { error: 'forbidden' }), note: CREATE_FAILED_COPY },
      { name: 'throw', script: thrown('POST', '/invites'), note: CREATE_FAILED_COPY },
    ];

    const seen = await Promise.all(rows.map(async (row) => {
      const h = frozenHost({ sessionToken: hourToken(), fetchScript: [row.script] });
      armCreate(h);
      const settled = await settlementOf(() => h.host.createInvite());
      return {
        name: row.name,
        settled,
        pending: h.host.createInvitePending(),
        note: h.host.createInviteNote(),
      };
    }));

    expect(seen).toEqual(
      rows.map((row) => ({
        name: row.name,
        settled: 'resolved',
        pending: false,
        note: row.note,
      })),
    );
  });

  it('retries a held create once with the plan and name at credential time', async () => {
    const plans = [
      { seats: TWO_PLAYERS, name: 'Friday' },
      { seats: PLAYER_AND_AGENT, name: 'Rematch' },
    ];
    const seen = await Promise.all(plans.map(async (plan) => {
      const h = await createAnswered401([createdInvite(), emptyLibrary()]);
      h.host.setSeatPlan(plan.seats);
      h.host.adapter().setInviteName(plan.name);
      await h.host.handleGisCredential(credentialToken());
      return {
        posts: apiCalls(h, 'POST', '/invites').length,
        retry: invitePostBody(h, 1),
      };
    }));

    expect(seen).toEqual(
      plans.map((plan) => ({
        posts: 2,
        retry: { seats: [...plan.seats], name: plan.name },
      })),
    );
  });

  it('does not post the held create again when the retry is refused, the player signs out, the route is not the lobby, or the gates fail', async () => {
    const refused = await createAnswered401([
      scripted('POST', '/invites', 401, { error: 'unauthorized' }),
    ]);
    await refused.host.handleGisCredential(credentialToken());

    const signedOut = await createAnswered401();
    const signedOutPosts = apiCalls(signedOut, 'POST', '/invites').length;
    signedOut.host.signOut();
    await signedOut.host.handleGisCredential(credentialToken());

    const game = await createAnswered401([getGameScript(openingBoard('inv-game'))]);
    const gamePosts = apiCalls(game, 'POST', '/invites').length;
    game.location.hash = gameHash(GROUP_HASH, GAME_ONE);
    await game.host.handleGisCredential(credentialToken());

    const gated = await createAnswered401([emptyLibrary()]);
    const gatedPosts = apiCalls(gated, 'POST', '/invites').length;
    gated.host.setSeatPlan(['human']);
    await gated.host.handleGisCredential(credentialToken());

    expect({
      refused: apiCalls(refused, 'POST', '/invites').length,
      signedOut: apiCalls(signedOut, 'POST', '/invites').length - signedOutPosts,
      game: apiCalls(game, 'POST', '/invites').length - gamePosts,
      gameRead: apiCalls(game, 'GET', GAME_PATH).length,
      gated: apiCalls(gated, 'POST', '/invites').length - gatedPosts,
      gatedLibrary: apiCalls(gated, 'GET', '/my-games').length,
    }).toEqual({
      refused: 2,
      signedOut: 0,
      game: 0,
      gameRead: 1,
      gated: 0,
      gatedLibrary: 1,
    });
  });

  it('a 200 with zero games is ready and not failed, and the empty copy applies', async () => {
    const h = frozenHost({ sessionToken: hourToken(), fetchScript: [emptyLibrary()] });
    await h.host.refreshLibrary();

    expect({
      failed: h.host.libraryFailed(),
      notice: noticeOf(h),
      emptySuccess: isEmptySuccess(h.host.adapter().myGames()),
    }).toEqual({
      failed: false,
      notice: 'empty',
      emptySuccess: true,
    });
  });

  it('a library read that is not 200 and not 401, an unparsed 200, or a throw is failed and not an empty success', async () => {
    const rows = [
      { name: '500', script: scripted('GET', '/my-games', 500, { error: 'internal' }) },
      { name: '403', script: scripted('GET', '/my-games', 403, { error: 'forbidden' }) },
      { name: 'not-json', script: scripted('GET', '/my-games', 200, undefined, 'not-json') },
      { name: 'throw', script: thrown('GET', '/my-games') },
    ];
    const seen = await Promise.all(rows.map(async (row) => {
      const h = frozenHost({ sessionToken: hourToken(), fetchScript: [row.script] });
      const settled = await settlementOf(() => h.host.refreshLibrary());
      return {
        name: row.name,
        settled,
        failed: h.host.libraryFailed(),
        emptySuccess: isEmptySuccess(h.host.adapter().myGames()),
        notice: noticeOf(h),
      };
    }));

    expect(seen).toEqual(
      rows.map((row) => ({
        name: row.name,
        settled: 'resolved',
        failed: true,
        emptySuccess: false,
        notice: 'failed' as const,
      })),
    );
  });

  it('a 401 on submit keeps the held submit until it is sent or dropped, and also reports session expired', async () => {
    const h = frozenHost({
      sessionToken: hourToken(),
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard('inv-submit')),
        postMoveScript(401, { error: 'unauthorized' }),
        postMoveScript(200, { version: 1 }),
        getGameScript(openingBoard('inv-reconcile')),
        getGameScript(openingBoard('inv-reread')),
      ],
    });
    await h.host.boot();
    const outcome = await h.host.submitMoves([pass()]);
    const held = {
      outcome,
      pending: h.host.submitPending(),
      expired: h.host.sessionExpired(),
      note: submitNote(outcome),
    };
    await h.host.handleGisCredential(credentialToken());
    const ids = submitIds(h);

    const dropped = frozenHost({
      sessionToken: hourToken(),
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard('drop')),
        postMoveScript(401, { error: 'unauthorized' }),
      ],
    });
    await dropped.host.boot();
    await dropped.host.submitMoves([pass()]);
    dropped.host.signOut();

    const rerouted = frozenHost({
      sessionToken: hourToken(),
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard('route')),
        postMoveScript(401, { error: 'unauthorized' }),
      ],
    });
    await rerouted.host.boot();
    await rerouted.host.submitMoves([pass()]);
    rerouted.location.hash = '';
    await rerouted.host.handleGisCredential(credentialToken());

    expect({
      held,
      resent: ids.length === 2 && ids[0] === ids[1] && !h.host.submitPending(),
      signOutClears: dropped.host.submitPending(),
      routeClears: rerouted.host.submitPending(),
    }).toEqual({
      held: {
        outcome: 'unauthorized',
        pending: true,
        expired: true,
        note: 'Your sign-in expired. Sign in again and your move will be sent.',
      },
      resent: true,
      signOutClears: false,
      routeClears: false,
    });
  });

  it('a user action inside the lead prompts once and still sends the current bearer', async () => {
    const actions = Object.keys(LEAD_ACTIONS) as LeadAction[];
    const token = minuteToken();
    const seen = await Promise.all(actions.map(async (action) => {
      const result = await LEAD_ACTIONS[action](token);
      return {
        action,
        prompts: result.prompts,
        bearer: bears(result.sent, token),
        sent: result.sent.length > 0,
      };
    }));

    expect(seen).toEqual(
      actions.map((action) => ({ action, prompts: 1, bearer: true, sent: true })),
    );
  });

  it('P106: the seat-plan note names what is missing, and only when the plan is not creatable', () => {
    const S = PICK_YOUR_SEAT_NOTE;
    const N = NEEDS_ANOTHER_NOTE;
    const cases: readonly (readonly [readonly PlannedSeatKind[], boolean, string | undefined])[] = [
      [['creator', 'human', 'heuristic'], true, undefined],
      [['creator', 'agent', 'heuristic'], true, undefined],
      [['creator', 'creator-agent', 'heuristic'], true, undefined],
      [['heuristic', 'agent', 'creator'], true, undefined],
      [['creator', 'heuristic', 'heuristic'], false, N],
      [['human', 'human', 'heuristic'], false, S],
      [['human', 'agent', 'heuristic'], false, S],
      [['creator', 'creator', 'human'], false, S],
      [['creator', 'human'], false, S],
    ];

    expect(
      cases.map(([plan]) => ({ creatable: onlinePlanCreatable(plan), note: createPlanNote(onlinePlanProblem(plan)) })),
    ).toEqual(cases.map(([, creatable, note]) => ({ creatable, note })));
  });

  it('sign-out clears session expired, the create note, the library failure, and a held create', async () => {
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [
        scripted('GET', '/my-games', 500, { error: 'internal' }),
        scripted('POST', '/invites', 401, { error: 'unauthorized' }),
        emptyLibrary(),
      ],
    });
    armCreate(h);
    await h.host.refreshLibrary();
    await h.host.createInvite();
    const armed = {
      expired: h.host.sessionExpired(),
      failed: h.host.libraryFailed(),
      signedIn: h.host.signedIn(),
    };
    const posts = apiCalls(h, 'POST', '/invites').length;
    h.host.signOut();
    await h.host.handleGisCredential(credentialToken());

    const noted = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('POST', '/invites', 500, { error: 'internal' })],
    });
    armCreate(noted);
    await noted.host.createInvite();
    const noteBefore = noted.host.createInviteNote();
    noted.host.signOut();

    expect({
      armed,
      after: {
        expired: h.host.sessionExpired(),
        failed: h.host.libraryFailed(),
        note: h.host.createInviteNote(),
        posts: apiCalls(h, 'POST', '/invites').length - posts,
      },
      noteBefore,
      noteAfter: noted.host.createInviteNote(),
    }).toEqual({
      armed: { expired: true, failed: true, signedIn: false },
      after: { expired: false, failed: false, note: undefined, posts: 0 },
      noteBefore: CREATE_FAILED_COPY,
      noteAfter: undefined,
    });
  });

  it('a lobby credential with no held create lists My games once, and a 401 retry does not', async () => {
    const plain = frozenHost({ fetchScript: [emptyLibrary()] });
    await plain.host.handleGisCredential(hourToken());

    const retried = await createAnswered401([
      scripted('POST', '/invites', 401, { error: 'unauthorized' }),
    ]);
    await retried.host.handleGisCredential(credentialToken());

    expect({
      plain: apiCalls(plain, 'GET', '/my-games').length,
      retryPosts: apiCalls(retried, 'POST', '/invites').length,
      retryLibrary: apiCalls(retried, 'GET', '/my-games').length,
    }).toEqual({
      plain: 1,
      retryPosts: 2,
      retryLibrary: 0,
    });
  });
});
