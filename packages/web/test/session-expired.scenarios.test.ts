/**
 * One component test per SCENARIOS.md path, including every alt.
 * The host is the component. The HTTP door is the probed leaf.
 *
 * @see docs/spec/session-expired/SCENARIOS.md
 */

import { afterEach, describe, expect, it } from 'vitest';
import { endTurn, GOOGLE_ID_TOKEN_SESSION_KEY } from '@conquarrow/contracts';
import { submitNote } from '../src/online-submit';
import {
  CREATE_FAILED_COPY,
  CREATE_REFUSED_COPY,
  NO_GAMES_COPY,
  SESSION_EXPIRED_COPY,
  chooserSlotOffered,
  libraryNotice,
  sessionExpiredNote,
} from '../src/online-shell-ui';
import { aliceBobSeats } from './online-web.support';
import {
  ACCEPT_PATH,
  GAME_ONE,
  GAME_PATH,
  GROUP_HASH,
  INVITE_GET,
  START_PATH,
  armLobbyCreate,
  bearerOf,
  byPath,
  createScenarioRig,
  created,
  credentialToken,
  emptyGames,
  expiredToken,
  gameHash,
  gameOk,
  hourToken,
  http,
  inviteHash,
  jsonBody,
  meOk,
  minuteToken,
  once,
  onceThrow,
  sent,
  sentPaths,
  unauthorized,
  waitingSeats,
  type ScenarioRig,
} from './session-expired.scenarios.support';

let rig: ScenarioRig;

afterEach(async () => {
  await rig.close();
});

const gone = (): boolean => rig.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY) === null;

const invitePosts = (): number =>
  sent(rig).filter((request) => request.method === 'POST' && request.url.endsWith('/invites')).length;

describe('SCENARIOS.md 1 — an expired token is signed out, with no request', () => {
  it('removes the token and sends nothing', () => {
    rig = createScenarioRig({ sessionToken: expiredToken() });

    expect({
      signedIn: rig.host.signedIn(),
      expired: rig.host.sessionExpired(),
      note: sessionExpiredNote(rig.host.sessionExpired(), rig.host.signedIn()),
      chooser: chooserSlotOffered(rig.host.signedIn()),
      gone: gone(),
      sent: sentPaths(rig),
    }).toEqual({
      signedIn: false,
      expired: false,
      note: undefined,
      chooser: true,
      gone: true,
      sent: [],
    });
    rig.api.probe.on('send').expect.neverCalled();
  });
});

describe('SCENARIOS.md 2 — create invite', () => {
  it('alt 201 sets the link and resolves', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', created);

    await rig.host.createInvite();

    expect({
      pending: rig.host.createInvitePending(),
      link: rig.host.copiedInviteUrl() !== undefined,
      note: rig.host.createInviteNote(),
      sent: sentPaths(rig),
    }).toEqual({
      pending: false,
      link: true,
      note: undefined,
      sent: ['POST /invites'],
    });
    expect(bearerOf(sent(rig)[0])).toBe(hourToken());
  });

  it('alt 401 then retry 201 lists My games once', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', unauthorized);
    once(rig, 'GET', '/me', meOk);
    once(rig, 'POST', '/invites', created);
    once(rig, 'GET', '/my-games', emptyGames);

    await rig.host.createInvite();

    expect({
      pending: rig.host.createInvitePending(),
      link: rig.host.copiedInviteUrl(),
      note: rig.host.createInviteNote(),
      expired: rig.host.sessionExpired(),
      signedIn: rig.host.signedIn(),
      chooser: chooserSlotOffered(rig.host.signedIn()),
      sessionNote: sessionExpiredNote(rig.host.sessionExpired(), rig.host.signedIn()),
      prompts: rig.gis.promptCount,
      gone: gone(),
      bearer: bearerOf(byPath(rig, 'POST', '/invites')[0]),
    }).toEqual({
      pending: false,
      link: undefined,
      note: undefined,
      expired: true,
      signedIn: false,
      chooser: true,
      sessionNote: SESSION_EXPIRED_COPY,
      prompts: 1,
      gone: true,
      bearer: hourToken(),
    });

    // The retry posts the plan and name at credential time, not the body frozen at the 401.
    rig.host.setSeatPlan(['creator', 'agent', 'heuristic']);
    rig.host.adapter().setInviteName('Rematch');
    await rig.host.handleGisCredential(credentialToken());

    const posts = byPath(rig, 'POST', '/invites');
    expect({
      signedIn: rig.host.signedIn(),
      expired: rig.host.sessionExpired(),
      link: rig.host.copiedInviteUrl() !== undefined,
      sent: sentPaths(rig),
      posts: posts.length,
      firstBearer: bearerOf(posts[0]),
      retryBearer: bearerOf(posts[1]),
      retryBody: jsonBody(posts[1]),
      library: byPath(rig, 'GET', '/my-games').length,
    }).toEqual({
      signedIn: true,
      expired: false,
      link: true,
      sent: ['POST /invites', 'GET /me', 'POST /invites', 'GET /my-games'],
      posts: 2,
      firstBearer: hourToken(),
      retryBearer: credentialToken(),
      retryBody: { seats: ['creator', 'agent', 'heuristic'], name: 'Rematch' },
      library: 1,
    });
  });

  it('alt retry 401 sends no third POST and no library read', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', unauthorized);
    once(rig, 'GET', '/me', meOk);
    once(rig, 'POST', '/invites', unauthorized);

    await rig.host.createInvite();
    await rig.host.handleGisCredential(credentialToken());

    const posts = byPath(rig, 'POST', '/invites');
    expect({
      sent: sentPaths(rig),
      posts: posts.length,
      firstBearer: bearerOf(posts[0]),
      retryBearer: bearerOf(posts[1]),
      library: byPath(rig, 'GET', '/my-games').length,
      link: rig.host.copiedInviteUrl(),
      expired: rig.host.sessionExpired(),
      signedIn: rig.host.signedIn(),
      prompts: rig.gis.promptCount,
    }).toEqual({
      sent: ['POST /invites', 'GET /me', 'POST /invites'],
      posts: 2,
      firstBearer: hourToken(),
      retryBearer: credentialToken(),
      library: 0,
      link: undefined,
      expired: true,
      signedIn: false,
      prompts: 2,
    });
  });

  it('alt credential on a game route reads the game and does not retry', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', unauthorized);
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', GAME_PATH, gameOk);

    await rig.host.createInvite();
    const posts = invitePosts();
    rig.location.hash = gameHash(GROUP_HASH, GAME_ONE);

    await rig.host.handleGisCredential(credentialToken());

    const gameReads = byPath(rig, 'GET', GAME_PATH);
    expect({
      sent: sentPaths(rig),
      posts: invitePosts(),
      gameBearer: bearerOf(gameReads[0]),
      library: byPath(rig, 'GET', '/my-games').length,
    }).toEqual({
      sent: ['POST /invites', 'GET /me', `GET ${GAME_PATH}`],
      posts,
      gameBearer: credentialToken(),
      library: 0,
    });
  });

  it('alt credential on an invite route accepts and does not retry', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', unauthorized);
    once(rig, 'GET', INVITE_GET, http(200, { token: 'a'.repeat(64), seats: waitingSeats() }));
    once(rig, 'GET', '/me', meOk);
    once(rig, 'POST', ACCEPT_PATH, http(200, { token: 'a'.repeat(64), seats: waitingSeats() }));

    await rig.host.createInvite();
    const posts = invitePosts();
    rig.location.hash = inviteHash('a'.repeat(64));
    await rig.host.handleHashChange();

    await rig.host.handleGisCredential(credentialToken());

    const accepts = byPath(rig, 'POST', ACCEPT_PATH);
    expect({
      sent: sentPaths(rig),
      posts: invitePosts(),
      acceptBearer: bearerOf(accepts[0]),
      library: byPath(rig, 'GET', '/my-games').length,
    }).toEqual({
      sent: ['POST /invites', `GET ${INVITE_GET}`, 'GET /me', `POST ${ACCEPT_PATH}`],
      posts,
      acceptBearer: credentialToken(),
      library: 0,
    });
  });

  it('alt 422 resolves with the refused sentence and no link', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', http(422, { error: 'unprocessable', reason: 'seats' }));

    await rig.host.createInvite();

    expect({
      pending: rig.host.createInvitePending(),
      link: rig.host.copiedInviteUrl(),
      note: rig.host.createInviteNote(),
      expired: rig.host.sessionExpired(),
      prompts: rig.gis.promptCount,
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'POST', '/invites')[0]),
    }).toEqual({
      pending: false,
      link: undefined,
      note: `${CREATE_REFUSED_COPY}: seats`,
      expired: false,
      prompts: 0,
      sent: ['POST /invites'],
      bearer: hourToken(),
    });
  });

  it('alt 500 resolves with the failed sentence', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', http(500, { error: 'internal' }));

    await rig.host.createInvite();

    expect({
      pending: rig.host.createInvitePending(),
      note: rig.host.createInviteNote(),
      expired: rig.host.sessionExpired(),
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'POST', '/invites')[0]),
    }).toEqual({
      pending: false,
      note: CREATE_FAILED_COPY,
      expired: false,
      sent: ['POST /invites'],
      bearer: hourToken(),
    });
  });

  it('alt thrown fetch resolves with the failed sentence', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    armLobbyCreate(rig);
    onceThrow(rig, 'POST', '/invites');

    await rig.host.createInvite();

    expect({
      pending: rig.host.createInvitePending(),
      note: rig.host.createInviteNote(),
      expired: rig.host.sessionExpired(),
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'POST', '/invites')[0]),
    }).toEqual({
      pending: false,
      note: CREATE_FAILED_COPY,
      expired: false,
      sent: ['POST /invites'],
      bearer: hourToken(),
    });
  });
});

describe('SCENARIOS.md 3 — My games', () => {
  it('alt 200 with zero games is empty, not failed', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    once(rig, 'GET', '/my-games', emptyGames);

    await rig.host.refreshLibrary();

    const notice = libraryNotice(
      rig.host.signedIn(),
      rig.host.adapter().myGames(),
      rig.host.libraryFailed(),
    );
    expect({
      failed: rig.host.libraryFailed(),
      expired: rig.host.sessionExpired(),
      notice,
      copy: notice === 'empty' ? NO_GAMES_COPY : undefined,
      games: rig.host.adapter().myGames()?.games.length,
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'GET', '/my-games')[0]),
    }).toEqual({
      failed: false,
      expired: false,
      notice: 'empty',
      copy: NO_GAMES_COPY,
      games: 0,
      sent: ['GET /my-games'],
      bearer: hourToken(),
    });
  });

  it('alt 401 is session expired, not an empty library', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    once(rig, 'GET', '/my-games', unauthorized);

    await rig.host.refreshLibrary();

    expect({
      failed: rig.host.libraryFailed(),
      expired: rig.host.sessionExpired(),
      signedIn: rig.host.signedIn(),
      games: rig.host.adapter().myGames(),
      prompts: rig.gis.promptCount,
      gone: gone(),
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'GET', '/my-games')[0]),
    }).toEqual({
      failed: false,
      expired: true,
      signedIn: false,
      games: undefined,
      prompts: 1,
      gone: true,
      sent: ['GET /my-games'],
      bearer: hourToken(),
    });
  });

  it('alt 500 is load-failed, not session expired', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    once(rig, 'GET', '/my-games', http(500, { error: 'internal' }));

    await rig.host.refreshLibrary();

    expect({
      failed: rig.host.libraryFailed(),
      expired: rig.host.sessionExpired(),
      games: rig.host.adapter().myGames(),
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'GET', '/my-games')[0]),
    }).toEqual({
      failed: true,
      expired: false,
      games: undefined,
      sent: ['GET /my-games'],
      bearer: hourToken(),
    });
  });

  it('alt unparsed 200 is load-failed, not an empty success', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    once(rig, 'GET', '/my-games', { status: 200, body: 'not-json' });

    await rig.host.refreshLibrary();

    expect({
      failed: rig.host.libraryFailed(),
      expired: rig.host.sessionExpired(),
      games: rig.host.adapter().myGames(),
      notice: libraryNotice(
        rig.host.signedIn(),
        rig.host.adapter().myGames(),
        rig.host.libraryFailed(),
      ),
      sent: sentPaths(rig),
    }).toEqual({
      failed: true,
      expired: false,
      games: undefined,
      notice: 'failed',
      sent: ['GET /my-games'],
    });
  });

  it('alt thrown fetch is load-failed and resolves', async () => {
    rig = createScenarioRig({ sessionToken: hourToken() });
    rig.host.selectMode('online');
    onceThrow(rig, 'GET', '/my-games');

    await rig.host.refreshLibrary();

    expect({
      failed: rig.host.libraryFailed(),
      expired: rig.host.sessionExpired(),
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'GET', '/my-games')[0]),
    }).toEqual({
      failed: true,
      expired: false,
      sent: ['GET /my-games'],
      bearer: hourToken(),
    });
  });
});

describe('SCENARIOS.md 4 — any other authenticated 401', () => {
  it('accept 401 expires the session and does not bind a seat', async () => {
    rig = createScenarioRig({
      sessionToken: hourToken(),
      hash: inviteHash('a'.repeat(64)),
    });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', INVITE_GET, http(200, { token: 'a'.repeat(64), seats: waitingSeats() }));
    once(rig, 'POST', ACCEPT_PATH, unauthorized);
    await rig.host.boot();

    await rig.host.acceptInvite();

    const accepts = byPath(rig, 'POST', ACCEPT_PATH);
    expect({
      expired: rig.host.sessionExpired(),
      signedIn: rig.host.signedIn(),
      prompts: rig.gis.promptCount,
      bound: rig.host.adapter().inviteSeats()?.some(
        (seat) => seat.kind === 'human' && seat.userHash !== undefined,
      ) ?? false,
      sent: sentPaths(rig),
      bearer: bearerOf(accepts[0]),
    }).toEqual({
      expired: true,
      signedIn: false,
      prompts: 1,
      bound: false,
      sent: ['GET /me', `GET ${INVITE_GET}`, `POST ${ACCEPT_PATH}`],
      bearer: hourToken(),
    });
  });

  it('start 401 expires the session and does not change the hash', async () => {
    rig = createScenarioRig({
      sessionToken: hourToken(),
      hash: inviteHash('a'.repeat(64)),
    });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', INVITE_GET, http(200, { token: 'a'.repeat(64), seats: aliceBobSeats() }));
    once(rig, 'POST', START_PATH, unauthorized);
    await rig.host.boot();
    const hash = rig.location.hash;
    if (!rig.host.startOffered()) throw new Error('arrange: start was not offered');

    await rig.host.start();

    const starts = byPath(rig, 'POST', START_PATH);
    expect({
      expired: rig.host.sessionExpired(),
      signedIn: rig.host.signedIn(),
      hash: rig.location.hash,
      prompts: rig.gis.promptCount,
      sent: sentPaths(rig),
      bearer: bearerOf(starts[0]),
    }).toEqual({
      expired: true,
      signedIn: false,
      hash,
      prompts: 1,
      sent: ['GET /me', `GET ${INVITE_GET}`, `POST ${START_PATH}`],
      bearer: hourToken(),
    });
  });

  it('game read 401 expires the session and leaves the board', async () => {
    rig = createScenarioRig({ sessionToken: hourToken(), hash: gameHash(GROUP_HASH, GAME_ONE) });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', GAME_PATH, gameOk);
    await rig.host.boot();
    const board = rig.host.board();
    once(rig, 'GET', GAME_PATH, unauthorized);

    await rig.host.handleVisibility(true);

    const reads = byPath(rig, 'GET', GAME_PATH);
    expect({
      expired: rig.host.sessionExpired(),
      board: rig.host.board(),
      prompts: rig.gis.promptCount,
      sent: sentPaths(rig),
      bearer: bearerOf(reads[1]),
    }).toEqual({
      expired: true,
      board,
      prompts: 1,
      sent: ['GET /me', `GET ${GAME_PATH}`, `GET ${GAME_PATH}`],
      bearer: hourToken(),
    });
  });

  it('export 401 expires the session and returns no text', async () => {
    rig = createScenarioRig({ sessionToken: hourToken(), hash: gameHash(GROUP_HASH, GAME_ONE) });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', GAME_PATH, gameOk);
    once(rig, 'GET', `${GAME_PATH}/export`, unauthorized);
    await rig.host.boot();

    const text = await rig.host.adapter().exportGame();

    expect({
      text,
      expired: rig.host.sessionExpired(),
      prompts: rig.gis.promptCount,
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'GET', `${GAME_PATH}/export`)[0]),
    }).toEqual({
      text: undefined,
      expired: true,
      prompts: 1,
      sent: ['GET /me', `GET ${GAME_PATH}`, `GET ${GAME_PATH}/export`],
      bearer: hourToken(),
    });
  });

  it('delete 401 expires the session and returns false', async () => {
    rig = createScenarioRig({ sessionToken: hourToken(), hash: gameHash(GROUP_HASH, GAME_ONE) });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', GAME_PATH, gameOk);
    once(rig, 'POST', `${GAME_PATH}/delete`, unauthorized);
    await rig.host.boot();

    const deleted = await rig.host.adapter().deleteGame(GROUP_HASH, GAME_ONE);

    expect({
      deleted,
      expired: rig.host.sessionExpired(),
      prompts: rig.gis.promptCount,
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'POST', `${GAME_PATH}/delete`)[0]),
    }).toEqual({
      deleted: false,
      expired: true,
      prompts: 1,
      sent: ['GET /me', `GET ${GAME_PATH}`, `POST ${GAME_PATH}/delete`],
      bearer: hourToken(),
    });
  });

  it('alt submitMoves keeps the hold, then the credential posts the same id', async () => {
    rig = createScenarioRig({ sessionToken: hourToken(), hash: gameHash(GROUP_HASH, GAME_ONE) });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', GAME_PATH, gameOk);
    once(rig, 'POST', `${GAME_PATH}/moves`, unauthorized);
    once(rig, 'GET', '/me', meOk);
    once(rig, 'POST', `${GAME_PATH}/moves`, http(200, { version: 1 }));
    // The resend reconciles, then the game-route credential reads the game again.
    once(rig, 'GET', GAME_PATH, gameOk);
    once(rig, 'GET', GAME_PATH, gameOk);
    await rig.host.boot();

    const outcome = await rig.host.submitMoves([endTurn()]);

    const held = byPath(rig, 'POST', `${GAME_PATH}/moves`);
    expect({
      outcome,
      note: submitNote(outcome),
      pending: rig.host.submitPending(),
      expired: rig.host.sessionExpired(),
      prompts: rig.gis.promptCount,
      bearer: bearerOf(held[0]),
    }).toEqual({
      outcome: 'unauthorized',
      note: submitNote('unauthorized'),
      pending: true,
      expired: true,
      prompts: 1,
      bearer: hourToken(),
    });

    await rig.host.handleGisCredential(credentialToken());

    const moves = byPath(rig, 'POST', `${GAME_PATH}/moves`);
    const submitId = (jsonBody(moves[0]) as { readonly submitId?: unknown } | undefined)?.submitId;
    expect({
      sent: sentPaths(rig),
      posts: moves.length,
      sameBody: moves[1]?.body === moves[0]?.body,
      heldId: typeof submitId === 'string' && submitId !== '',
      resendBearer: bearerOf(moves[1]),
      pending: rig.host.submitPending(),
    }).toEqual({
      sent: [
        'GET /me',
        `GET ${GAME_PATH}`,
        `POST ${GAME_PATH}/moves`,
        'GET /me',
        `POST ${GAME_PATH}/moves`,
        `GET ${GAME_PATH}`,
        `GET ${GAME_PATH}`,
      ],
      posts: 2,
      sameBody: true,
      heldId: true,
      resendBearer: credentialToken(),
      pending: false,
    });
  });

  it('a library 401 does not drop a held submit', async () => {
    rig = createScenarioRig({ sessionToken: hourToken(), hash: gameHash(GROUP_HASH, GAME_ONE) });
    once(rig, 'GET', '/me', meOk);
    once(rig, 'GET', GAME_PATH, gameOk);
    once(rig, 'POST', `${GAME_PATH}/moves`, unauthorized);
    await rig.host.boot();
    await rig.host.submitMoves([endTurn()]);
    rig.session.setItem(GOOGLE_ID_TOKEN_SESSION_KEY, hourToken());
    once(rig, 'GET', '/my-games', unauthorized);

    await rig.host.refreshLibrary();

    expect({
      pending: rig.host.submitPending(),
      expired: rig.host.sessionExpired(),
      sent: sentPaths(rig),
      bearer: bearerOf(byPath(rig, 'GET', '/my-games')[0]),
    }).toEqual({
      pending: true,
      expired: true,
      sent: ['GET /me', `GET ${GAME_PATH}`, `POST ${GAME_PATH}/moves`, 'GET /my-games'],
      bearer: hourToken(),
    });
  });

  it('an unauthenticated invite peek 401 is not the door', async () => {
    rig = createScenarioRig({ hash: inviteHash('a'.repeat(64)) });
    once(rig, 'GET', INVITE_GET, unauthorized);

    await rig.host.boot();

    expect({
      expired: rig.host.sessionExpired(),
      prompts: rig.gis.promptCount,
      sent: sentPaths(rig),
      bearer: bearerOf(sent(rig)[0]),
    }).toEqual({
      expired: false,
      prompts: 0,
      sent: [`GET ${INVITE_GET}`],
      bearer: undefined,
    });
  });
});

describe('SCENARIOS.md 5 — a user action inside the lead window', () => {
  it('prompts once and still sends the current bearer', async () => {
    rig = createScenarioRig({ sessionToken: minuteToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', created);

    await rig.host.createInvite();

    expect({
      prompts: rig.gis.promptCount,
      bearer: bearerOf(sent(rig)[0]),
      sent: sentPaths(rig),
    }).toEqual({
      prompts: 1,
      bearer: minuteToken(),
      sent: ['POST /invites'],
    });
  });
});

describe('SCENARIOS.md 6 — promptedFor does not block a 401', () => {
  it('sends without a second proactive prompt, then the 401 still prompts', async () => {
    rig = createScenarioRig({ sessionToken: minuteToken() });
    armLobbyCreate(rig);
    once(rig, 'POST', '/invites', created);
    await rig.host.createInvite();
    const afterLead = rig.gis.promptCount;
    once(rig, 'POST', '/invites', unauthorized);

    await rig.host.createInvite();

    const posts = byPath(rig, 'POST', '/invites');
    expect({
      leadPrompts: afterLead,
      prompts: rig.gis.promptCount,
      signedIn: rig.host.signedIn(),
      chooser: chooserSlotOffered(rig.host.signedIn()),
      note: sessionExpiredNote(rig.host.sessionExpired(), rig.host.signedIn()),
      sent: sentPaths(rig),
      firstBearer: bearerOf(posts[0]),
      secondBearer: bearerOf(posts[1]),
    }).toEqual({
      leadPrompts: 1,
      prompts: 2,
      signedIn: false,
      chooser: true,
      note: SESSION_EXPIRED_COPY,
      sent: ['POST /invites', 'POST /invites'],
      firstBearer: minuteToken(),
      secondBearer: minuteToken(),
    });
  });
});
