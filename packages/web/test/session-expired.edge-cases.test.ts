/**
 * A dead session cannot look like success — edges.
 * One test per scenario, and one per outline row. Scripted fetch, not test-kit.
 *
 * @see docs/spec/session-expired/session-expired.edge-cases.feature
 * @see docs/spec/session-expired/SCENARIOS.md
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { onlinePlanCreatable } from '../src/online-pages';
import { submitNote } from '../src/online-submit';
import {
  CREATE_FAILED_COPY,
  CREATE_PLAN_NOTE,
  LIBRARY_FAILED_COPY,
  SESSION_EXPIRED_COPY,
  createPlanNote,
} from '../src/online-shell-ui';
import { pass } from './online-move-log-replay.support';
import {
  INVITE_TOKEN,
  apiCalls,
  bearerOf,
  gameHash,
  getGameScript,
  inviteHash,
  openingBoard,
  peekInviteScript,
  postMoveScript,
  tokenExpiringAt,
  GROUP_HASH,
  GAME_ONE,
} from './online-web.support';
import {
  ACCEPT_PATH,
  DOOR_401,
  GAME_PATH,
  LEAD_ACTIONS,
  MOVES_PATH,
  PLAYER_AND_AGENT,
  TWO_PLAYERS,
  armCreate,
  bears,
  chooserOffered,
  createAnswered401,
  createdInvite,
  credentialToken,
  emptyLibrary,
  expiredNote,
  expiredToken,
  frozenHost,
  frozenNow,
  heartbeatFrames,
  hourToken,
  invitePostBody,
  isEmptySuccess,
  minuteToken,
  noticeOf,
  restoreToken,
  scripted,
  settlementOf,
  storedToken,
  submitIds,
  thrown,
  tokenWithClaims,
  waitingSeats,
  type DoorAction,
  type LeadAction,
} from './session-expired.support';

const lobbySource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/Lobby.tsx'), 'utf8');

const REFUSED = 'The server refused this seat plan';
const FAILED = "Couldn't create the invite — try again";
const PLAN_NOTE = 'Create needs two Players, or a Player and an Agent.';
const P95_UNAUTHORIZED = 'Your sign-in expired. Sign in again and your move will be sent.';

describe('An unusable token is removed and is not session expired (D1)', () => {
  it('An opaque token is signed out and removed', () => {
    // SCENARIOS.md §1 — exp missing
    const h = frozenHost({ sessionToken: 'alice-id-token' });

    expect({
      signedIn: h.host.signedIn(),
      token: storedToken(h),
      expired: h.host.sessionExpired(),
    }).toEqual({
      signedIn: false,
      token: null,
      expired: false,
    });
  });

  it('A token whose exp is not a number is signed out and removed', () => {
    // SCENARIOS.md §1 — exp not a finite number
    const h = frozenHost({ sessionToken: tokenWithClaims({ exp: 'soon' }) });

    expect({
      signedIn: h.host.signedIn(),
      token: storedToken(h),
      expired: h.host.sessionExpired(),
    }).toEqual({
      signedIn: false,
      token: null,
      expired: false,
    });
  });

  it('A token whose exp equals now is signed out and removed', () => {
    // SCENARIOS.md §1 — exp not strictly after now
    const h = frozenHost({ sessionToken: tokenExpiringAt(frozenNow()) });

    expect({
      first: h.host.signedIn(),
      token: storedToken(h),
      second: h.host.signedIn(),
    }).toEqual({
      first: false,
      token: null,
      second: false,
    });
  });

  it('A submit with an already expired token sends nothing', async () => {
    const h = frozenHost({
      sessionToken: hourToken(),
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard('expired-submit'))],
    });
    await h.host.boot();
    if (h.host.board() === undefined) {
      throw new Error('arrange: the board was not loaded, so submit would refuse early');
    }
    restoreToken(h, expiredToken());

    const outcome = await h.host.submitMoves([pass()]);

    expect({
      outcome,
      posts: apiCalls(h, 'POST', MOVES_PATH).length,
      expired: h.host.sessionExpired(),
      signedIn: h.host.signedIn(),
    }).toEqual({
      outcome: 'refused',
      posts: 0,
      expired: false,
      signedIn: false,
    });
  });

  it('A create with an already expired token sends nothing', async () => {
    // SCENARIOS.md §1 — no authenticated request
    const h = frozenHost({ sessionToken: expiredToken() });
    armCreate(h);

    const settled = await settlementOf(() => h.host.createInvite());

    expect({
      settled,
      posts: apiCalls(h, 'POST', '/invites').length,
      note: h.host.createInviteNote(),
      expired: h.host.sessionExpired(),
      signedIn: h.host.signedIn(),
    }).toEqual({
      settled: 'resolved',
      posts: 0,
      note: undefined,
      expired: false,
      signedIn: false,
    });
  });
});

describe('A create that is not a 401 still ends visibly (D4)', () => {
  it.each([
    {
      status: 422,
      body: { error: 'unprocessable' },
      note: REFUSED,
    },
    {
      status: 422,
      body: { error: 'unprocessable', reason: 'seats' },
      note: `${REFUSED}: seats`,
    },
    {
      status: 422,
      rawBody: 'not-json',
      note: REFUSED,
    },
    {
      status: 500,
      body: { error: 'internal' },
      note: FAILED,
    },
    {
      status: 403,
      body: { error: 'forbidden' },
      note: FAILED,
    },
  ])(
    'A non-success create shows a note and resolves ($status)',
    async ({ status, body, rawBody, note }) => {
      // SCENARIOS.md §2 alt 422, or other status
      const h = frozenHost({
        sessionToken: hourToken(),
        fetchScript: [scripted('POST', '/invites', status, body, rawBody)],
      });
      armCreate(h);

      const settled = await settlementOf(() => h.host.createInvite());

      expect({
        settled,
        pending: h.host.createInvitePending(),
        link: h.host.copiedInviteUrl(),
        note: h.host.createInviteNote(),
        expired: h.host.sessionExpired(),
        prompts: h.gis.promptCount,
        sent: apiCalls(h, 'POST', '/invites').length,
      }).toEqual({
        settled: 'resolved',
        pending: false,
        link: undefined,
        note,
        expired: false,
        prompts: 0,
        sent: 1,
      });
    },
  );

  it('A thrown create fetch shows the failed sentence and resolves', async () => {
    // SCENARIOS.md §2 alt thrown fetch
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [thrown('POST', '/invites')],
    });
    armCreate(h);

    const settled = await settlementOf(() => h.host.createInvite());

    expect({
      settled,
      pending: h.host.createInvitePending(),
      link: h.host.copiedInviteUrl(),
      note: h.host.createInviteNote(),
      expired: h.host.sessionExpired(),
    }).toEqual({
      settled: 'resolved',
      pending: false,
      link: undefined,
      note: CREATE_FAILED_COPY,
      expired: false,
    });
  });

  it('A later success clears the create note', async () => {
    // SCENARIOS.md §2 alt 200 or 201 — the link is set and the note is cleared
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('POST', '/invites', 500, { error: 'internal' }), createdInvite()],
    });
    armCreate(h);
    await h.host.createInvite();
    const noteBefore = h.host.createInviteNote();

    await h.host.createInvite();

    expect({
      noteBefore,
      linkShown: h.host.copiedInviteUrl() !== undefined,
      noteAfter: h.host.createInviteNote(),
    }).toEqual({
      noteBefore: CREATE_FAILED_COPY,
      linkShown: true,
      noteAfter: undefined,
    });
  });
});

describe('The held create is one shot (D3)', () => {
  it('A second 401 on the retry does not post a third time', async () => {
    // SCENARIOS.md §2 alt retry 401
    const h = await createAnswered401([
      scripted('POST', '/invites', 401, { error: 'unauthorized' }),
    ]);

    await h.host.handleGisCredential(credentialToken());

    expect({
      posts: apiCalls(h, 'POST', '/invites').length,
      library: apiCalls(h, 'GET', '/my-games').length,
      link: h.host.copiedInviteUrl(),
      expired: h.host.sessionExpired(),
      signedIn: h.host.signedIn(),
      prompts: h.gis.promptCount,
    }).toEqual({
      posts: 2,
      library: 0,
      link: undefined,
      expired: true,
      signedIn: false,
      prompts: 2,
    });
  });

  it('Signing out before the credential does not retry the create', async () => {
    // SCENARIOS.md §2 — sign-out drops the held create
    const h = await createAnswered401([emptyLibrary()]);
    const posts = apiCalls(h, 'POST', '/invites').length;

    h.host.signOut();
    await h.host.handleGisCredential(credentialToken());

    expect({
      posts: apiCalls(h, 'POST', '/invites').length,
      expired: h.host.sessionExpired(),
      note: h.host.createInviteNote(),
    }).toEqual({
      posts,
      expired: false,
      note: undefined,
    });
  });

  it('A credential on a game route does not retry the create', async () => {
    // SCENARIOS.md §2 alt credential on a game route
    const h = await createAnswered401([getGameScript(openingBoard('game-route'))]);
    h.location.hash = gameHash(GROUP_HASH, GAME_ONE);
    const posts = apiCalls(h, 'POST', '/invites').length;

    await h.host.handleGisCredential(credentialToken());

    expect({
      gameReads: apiCalls(h, 'GET', GAME_PATH).length,
      posts: apiCalls(h, 'POST', '/invites').length,
      library: apiCalls(h, 'GET', '/my-games').length,
    }).toEqual({
      gameReads: 1,
      posts,
      library: 0,
    });
  });

  it('A credential on an invite route does not retry the create', async () => {
    // SCENARIOS.md §2 alt credential on an invite route
    const h = await createAnswered401([
      peekInviteScript(INVITE_TOKEN, waitingSeats()),
      scripted('POST', ACCEPT_PATH, 200, { token: INVITE_TOKEN, seats: waitingSeats() }),
    ]);
    h.location.hash = inviteHash(INVITE_TOKEN);
    await h.host.handleHashChange();
    const posts = apiCalls(h, 'POST', '/invites').length;

    await h.host.handleGisCredential(credentialToken());

    expect({
      accepts: apiCalls(h, 'POST', ACCEPT_PATH).length,
      posts: apiCalls(h, 'POST', '/invites').length,
      library: apiCalls(h, 'GET', '/my-games').length,
    }).toEqual({
      accepts: 1,
      posts,
      library: 0,
    });
  });

  it('A plan that is no longer creatable is not retried', async () => {
    // SCENARIOS.md §2 — gates fail, lobby library read still happens
    const h = await createAnswered401([emptyLibrary()]);
    h.host.setSeatPlan(['human']);
    const posts = apiCalls(h, 'POST', '/invites').length;

    await h.host.handleGisCredential(credentialToken());

    expect({
      posts: apiCalls(h, 'POST', '/invites').length,
      library: apiCalls(h, 'GET', '/my-games').length,
    }).toEqual({
      posts,
      library: 1,
    });
  });

  it('The retry sends the plan at credential time', async () => {
    // SCENARIOS.md §2 — plan and name now, not the body frozen at the 401
    const h = await createAnswered401([createdInvite(), emptyLibrary()]);
    h.host.setSeatPlan(PLAYER_AND_AGENT);
    h.host.adapter().setInviteName('Rematch');

    await h.host.handleGisCredential(credentialToken());

    expect({
      posts: apiCalls(h, 'POST', '/invites').length,
      retry: invitePostBody(h, 1),
    }).toEqual({
      posts: 2,
      retry: { seats: ['human', 'agent'], name: 'Rematch' },
    });
  });
});

describe('My games does not paint a failure as empty (D5)', () => {
  it('A 401 on My games is session expired, not an empty library', async () => {
    // SCENARIOS.md §3 alt 401
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('GET', '/my-games', 401, { error: 'unauthorized' })],
    });
    expect(h.host.adapter().myGames()).toBeUndefined();

    await h.host.refreshLibrary();

    expect({
      sent: apiCalls(h, 'GET', '/my-games').length,
      expired: h.host.sessionExpired(),
      signedIn: h.host.signedIn(),
      failed: h.host.libraryFailed(),
      emptySuccess: isEmptySuccess(h.host.adapter().myGames()),
      note: expiredNote(h),
      loadFailed: noticeOf(h) === 'failed',
      prompts: h.gis.promptCount,
    }).toEqual({
      sent: 1,
      expired: true,
      signedIn: false,
      failed: false,
      emptySuccess: false,
      note: SESSION_EXPIRED_COPY,
      loadFailed: false,
      prompts: 1,
    });
  });

  it('A 500 on My games is load-failed, not empty', async () => {
    // SCENARIOS.md §3 alt other status
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('GET', '/my-games', 500, { error: 'internal' })],
    });

    await h.host.refreshLibrary();

    const notice = noticeOf(h);
    expect({
      sent: apiCalls(h, 'GET', '/my-games').length,
      failed: h.host.libraryFailed(),
      emptySuccess: isEmptySuccess(h.host.adapter().myGames()),
      expired: h.host.sessionExpired(),
      notice,
      loadFailed: notice === 'failed' ? LIBRARY_FAILED_COPY : undefined,
      empty: notice === 'empty',
    }).toEqual({
      sent: 1,
      failed: true,
      emptySuccess: false,
      expired: false,
      notice: 'failed',
      loadFailed: LIBRARY_FAILED_COPY,
      empty: false,
    });
  });

  it('A thrown library fetch is load-failed', async () => {
    // SCENARIOS.md §3 alt throw
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [thrown('GET', '/my-games')],
    });

    const settled = await settlementOf(() => h.host.refreshLibrary());

    expect({
      settled,
      failed: h.host.libraryFailed(),
      expired: h.host.sessionExpired(),
      loadFailed: noticeOf(h) === 'failed' ? LIBRARY_FAILED_COPY : undefined,
    }).toEqual({
      settled: 'resolved',
      failed: true,
      expired: false,
      loadFailed: LIBRARY_FAILED_COPY,
    });
  });

  it('A 200 body that does not parse is load-failed', async () => {
    // SCENARIOS.md §3 alt unparsed 200
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('GET', '/my-games', 200, undefined, 'not-json')],
    });

    await h.host.refreshLibrary();

    expect({
      sent: apiCalls(h, 'GET', '/my-games').length,
      failed: h.host.libraryFailed(),
      emptySuccess: isEmptySuccess(h.host.adapter().myGames()),
      empty: noticeOf(h) === 'empty',
    }).toEqual({
      sent: 1,
      failed: true,
      emptySuccess: false,
      empty: false,
    });
  });

  it('An unset library is not No games yet', () => {
    const h = frozenHost({ sessionToken: hourToken() });

    expect({
      signedIn: h.host.signedIn(),
      notice: noticeOf(h),
      loadFailed: noticeOf(h) === 'failed',
    }).toEqual({
      signedIn: true,
      notice: 'unset',
      loadFailed: false,
    });
  });

  it('Retry after a library failure reads My games again', async () => {
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('GET', '/my-games', 500, { error: 'internal' }), emptyLibrary()],
    });
    await h.host.refreshLibrary();
    const failedBefore = h.host.libraryFailed();

    await h.host.refreshLibrary();

    expect({
      reads: apiCalls(h, 'GET', '/my-games').length,
      failedBefore,
      failedAfter: h.host.libraryFailed(),
      notice: noticeOf(h),
    }).toEqual({
      reads: 2,
      failedBefore: true,
      failedAfter: false,
      notice: 'empty',
    });
  });
});

describe('Any other authenticated 401 is the same door (D2)', () => {
  it.each([
    ['accepts the invite', 'no seat was bound'],
    ['starts the match', 'the hash is unchanged'],
    ['reads the game', 'the board is unchanged'],
    ['exports the game', 'no export text'],
    ['deletes the game', 'delete returned false'],
    ['hides the game', 'hide returned false'],
    ['renames the game', 'rename returned false'],
    ['polls the version', 'no wake was taken'],
    ['loads more games', 'no row was appended'],
    ['boots and reads /me', 'the user hash is unset'],
  ] as const)(
    'An authenticated 401 expires the session and does not succeed — %s',
    async (action: DoorAction, failure: string) => {
      // SCENARIOS.md §4 alt any other action. Hide, rename, load-more, poll, and /me
      // are this same door.
      const result = await DOOR_401[action](hourToken());

      expect({
        sent: result.sent,
        expired: result.h.host.sessionExpired(),
        signedIn: result.h.host.signedIn(),
        token: storedToken(result.h),
        chooser: chooserOffered(result.h),
        prompts: result.prompts,
        failure: result.failure,
        held: result.h.host.submitPending(),
      }).toEqual({
        sent: 1,
        expired: true,
        signedIn: false,
        token: null,
        chooser: true,
        prompts: 1,
        failure,
        held: false,
      });
    },
  );

  it('A 401 on submit keeps the held submit and expires the session', async () => {
    // SCENARIOS.md §4 alt submitMoves, then the credential resend
    const h = frozenHost({
      sessionToken: hourToken(),
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard('submit-401')),
        postMoveScript(401, { error: 'unauthorized' }),
        postMoveScript(200, { version: 1 }),
        getGameScript(openingBoard('reconcile')),
        getGameScript(openingBoard('reread')),
      ],
    });
    await h.host.boot();

    const outcome = await h.host.submitMoves([pass()]);
    const afterSubmit = {
      outcome,
      pending: h.host.submitPending(),
      expired: h.host.sessionExpired(),
      signedIn: h.host.signedIn(),
      note: submitNote(outcome),
    };

    await h.host.handleGisCredential(credentialToken());
    const ids = submitIds(h);

    expect({
      afterSubmit,
      ids,
      pendingAfter: h.host.submitPending(),
      sameId: ids.length === 2 && ids[0] === ids[1],
    }).toEqual({
      afterSubmit: {
        outcome: 'unauthorized',
        pending: true,
        expired: true,
        signedIn: false,
        note: P95_UNAUTHORIZED,
      },
      ids: [ids[0], ids[0]],
      pendingAfter: false,
      sameId: true,
    });
  });

  it('A library 401 does not drop a held submit', async () => {
    // SCENARIOS.md §4 — a held submit, if any, stays held
    const h = frozenHost({
      sessionToken: hourToken(),
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard('held')),
        postMoveScript(401, { error: 'unauthorized' }),
        scripted('GET', '/my-games', 401, { error: 'unauthorized' }),
      ],
    });
    await h.host.boot();
    await h.host.submitMoves([pass()]);
    // The submit 401 cleared the bearer. Put it back without a credential,
    // which would send or drop the hold, so this library 401 is actually sent.
    restoreToken(h, hourToken());

    await h.host.refreshLibrary();

    expect({
      libraryReads: apiCalls(h, 'GET', '/my-games').length,
      pending: h.host.submitPending(),
      expired: h.host.sessionExpired(),
    }).toEqual({
      libraryReads: 1,
      pending: true,
      expired: true,
    });
  });

  it('A following heartbeat sends nothing after a 401', async () => {
    // SCENARIOS.md §4 — token removed, socket forgotten
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('GET', '/my-games', 401, { error: 'unauthorized' })],
    });
    await h.host.boot();
    if (!h.sockets.some((socket) => !socket.closed)) {
      throw new Error('arrange: no socket was open');
    }

    await h.host.refreshLibrary();
    const frames = heartbeatFrames(h);
    h.host.handleHeartbeat();
    const mark = h.fetchLog.length;
    await h.host.refreshLibrary();

    expect({
      libraryReads: apiCalls(h, 'GET', '/my-games').length,
      framesAfter: heartbeatFrames(h),
      framesBefore: frames,
      followingBearers: h.fetchLog.slice(mark).map((req) => bearerOf(req) ?? null),
    }).toEqual({
      libraryReads: 1,
      framesAfter: frames,
      framesBefore: frames,
      followingBearers: h.fetchLog.slice(mark).map(() => null),
    });
  });
});

describe('The lead window prompts once and does not block the fallback (D6)', () => {
  it.each([
    'creates an invite',
    'accepts the invite',
    'starts the match',
    'refreshes My games',
    'opens a listed game',
    'submits a move',
    'exports the game',
    'deletes the game',
    'hides the game',
    'renames the game',
    'loads more games',
  ] as const)('A user action inside the lead prompts once and still sends — %s', async (action: LeadAction) => {
    // SCENARIOS.md §5
    const token = minuteToken();
    const result = await LEAD_ACTIONS[action](token);

    expect({
      prompts: result.prompts,
      bearer: bears(result.sent, token),
      sent: result.sent.length,
    }).toEqual({
      prompts: 1,
      bearer: true,
      sent: 1,
    });
  });

  it('A token already prompted is not prompted again, until a 401', async () => {
    // SCENARIOS.md §6 — promptedFor does not block the 401 prompt
    const token = minuteToken();
    const h = frozenHost({
      sessionToken: token,
      fetchScript: [
        emptyLibrary(),
        createdInvite(),
        scripted('POST', '/invites', 401, { error: 'unauthorized' }),
      ],
    });
    armCreate(h);
    await h.host.handleVisibility(true);
    if (h.gis.promptCount < 1) throw new Error('arrange: the lead window did not prompt');

    const beforeCreate = h.gis.promptCount;
    await h.host.createInvite();
    const createSent = apiCalls(h, 'POST', '/invites');
    const before401 = h.gis.promptCount;
    await h.host.createInvite();

    expect({
      createPrompts: h.gis.promptCount - beforeCreate - (h.gis.promptCount - before401),
      createBearer: bears(createSent.slice(0, 1), token),
      unauthorizedPrompts: h.gis.promptCount - before401,
      signedIn: h.host.signedIn(),
      chooser: chooserOffered(h),
      note: expiredNote(h),
    }).toEqual({
      createPrompts: 0,
      createBearer: true,
      unauthorizedPrompts: 1,
      signedIn: false,
      chooser: true,
      note: SESSION_EXPIRED_COPY,
    });
  });
});

describe('Sign-out and the seat sentence (D7)', () => {
  it('Signing out clears the expiry flags', async () => {
    // Amended Given: a library read failed, then a create 401 is held, and the
    // create note is absent. A 401 arms the hold and leaves the note absent.
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [
        scripted('GET', '/my-games', 500, { error: 'internal' }),
        scripted('POST', '/invites', 401, { error: 'unauthorized' }),
      ],
    });
    armCreate(h);
    await h.host.refreshLibrary();
    await h.host.createInvite();
    const before = {
      expired: h.host.sessionExpired(),
      failed: h.host.libraryFailed(),
      note: h.host.createInviteNote(),
      signedIn: h.host.signedIn(),
    };
    const posts = apiCalls(h, 'POST', '/invites').length;

    h.host.signOut();
    const afterSignOut = {
      signedIn: h.host.signedIn(),
      expired: h.host.sessionExpired(),
      note: h.host.createInviteNote(),
      failed: h.host.libraryFailed(),
      library: h.host.adapter().myGames(),
    };
    await h.host.handleGisCredential(credentialToken());

    expect({
      before,
      afterSignOut,
      posts: apiCalls(h, 'POST', '/invites').length,
    }).toEqual({
      before: {
        expired: true,
        failed: true,
        note: undefined,
        signedIn: false,
      },
      afterSignOut: {
        signedIn: false,
        expired: false,
        note: undefined,
        failed: false,
        library: undefined,
      },
      posts,
    });
  });

  it('Signing out clears a create note', async () => {
    const h = frozenHost({
      sessionToken: hourToken(),
      fetchScript: [scripted('POST', '/invites', 500, { error: 'internal' })],
    });
    armCreate(h);
    await h.host.createInvite();
    const noteBefore = h.host.createInviteNote();

    h.host.signOut();

    expect({
      sent: apiCalls(h, 'POST', '/invites').length,
      noteBefore,
      note: h.host.createInviteNote(),
      signedIn: h.host.signedIn(),
      expired: h.host.sessionExpired(),
    }).toEqual({
      sent: 1,
      noteBefore: CREATE_FAILED_COPY,
      note: undefined,
      signedIn: false,
      expired: false,
    });
  });

  it.each([
    { plan: 'two Players', seats: TWO_PLAYERS, note: undefined },
    { plan: 'one Player and one Agent', seats: PLAYER_AND_AGENT, note: undefined },
    { plan: 'one Player and one AI', seats: ['human', 'heuristic'] as const, note: PLAN_NOTE },
    { plan: 'one Player', seats: ['human'] as const, note: PLAN_NOTE },
    { plan: 'one Agent', seats: ['agent'] as const, note: PLAN_NOTE },
  ])('The seat-plan note follows the creatable rule — $plan', ({ seats, note }) => {
    const h = frozenHost({ sessionToken: hourToken() });
    h.host.setSeatPlan(seats);

    expect({
      signedIn: h.host.signedIn(),
      note: createPlanNote(onlinePlanCreatable(seats)),
      sentence: CREATE_PLAN_NOTE,
    }).toEqual({
      signedIn: true,
      note,
      sentence: PLAN_NOTE,
    });
  });

  it('An invalid name does not show the seat-plan note', () => {
    const h = frozenHost({ sessionToken: hourToken() });
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_PLAYERS);
    h.host.adapter().setInviteName('x'.repeat(49));

    expect({
      note: createPlanNote(onlinePlanCreatable(TWO_PLAYERS)),
      offered: h.host.createOffered(),
    }).toEqual({
      note: undefined,
      offered: false,
    });
  });

  it('The old two-Player sentence is gone from the lobby', () => {
    expect(lobbySource()).not.toContain('Create needs two Player seats.');
  });
});
