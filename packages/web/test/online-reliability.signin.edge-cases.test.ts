/**
 * Sign-in reaches the lobby, and the Google button does not linger (D13).
 *
 * Diagram 6, alt invite route and alt game route — scripted fetch, not test-kit.
 * GIS mount uses a fake `document` on `globalThis`. No jsdom.
 *
 * @see docs/spec/online-reliability/online-reliability.signin.edge-cases.feature
 * @see docs/spec/online-reliability/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import { libraryOffered, lobbyLibraryDue, chooserSlotOffered } from '../src/online-shell-ui';
import { ALICE, INVITE_TOKEN, apiCalls, openingBoard } from './online-shell.support';
import {
  CHOOSER_ID,
  GAME_ONE,
  GROUP_G,
  GROUP_HASH,
  LOBBY_ROW_SELECTOR,
  gameCredentialHarness,
  inviteCredentialHarness,
  listedGames,
  lobbyLibraryDueSites,
  lobbyWithLibrary,
  mountGis,
  readWebSource,
  refreshLibrarySites,
  sessionTokenOffenders,
  sourceWithoutComments,
  withChooserDocument,
} from './online-reliability.signin.support';

const chooserIdIn = (src: string): boolean => src.includes(CHOOSER_ID);

/** True branch of `chooserSlotOffered(...)` that renders the chooser id. */
const chooserGated = (src: string): boolean => {
  const gated =
    /chooserSlotOffered\s*\([^)]*\)\s*(?:&&|\?)(?:(?!:)[\s\S]){0,400}?conquarrow-gis-chooser/;
  if (!gated.test(src)) return false;
  return !src.replace(gated, '').includes(CHOOSER_ID);
};

describe('Sign-out and a second sign-in (D13)', () => {
  it("Signing out turns the host's signed-in flag off and clears My games", async () => {
    const h = lobbyWithLibrary(ALICE.bearer);
    await h.host.boot();
    await h.host.refreshLibrary();
    expect(h.host.signedIn()).toBe(true);
    expect(listedGames(h)).toEqual([
      { groupHash: GROUP_G, gameNumber: GAME_ONE, status: 'your-turn' },
    ]);

    h.host.signOut();

    expect(h.host.signedIn()).toBe(false);
    expect(h.host.adapter().myGames()).toBeUndefined();
    expect(libraryOffered('online', false)).toBe(false);
    expect(libraryOffered('online', h.host.signedIn())).toBe(false);
  });

  it('Signing in again after sign-out lists My games once', async () => {
    const h = lobbyWithLibrary(ALICE.bearer);
    await h.host.boot();
    h.host.signOut();
    expect(h.host.signedIn()).toBe(false);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(0);

    await h.host.handleGisCredential(ALICE.bearer);

    expect(h.host.signedIn()).toBe(true);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(1);
    expect(listedGames(h)).toEqual([
      { groupHash: GROUP_G, gameNumber: GAME_ONE, status: 'your-turn' },
    ]);
  });
});

describe('A credential on another route does not become a library read (D13)', () => {
  it('A credential on an invite route accepts and does not list My games', async () => {
    const h = inviteCredentialHarness();
    await h.host.boot();

    await h.host.handleGisCredential(ALICE.bearer);

    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(1);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(0);
  });

  it('A credential on a game route reads the game and does not list My games', async () => {
    const board = openingBoard('signed-in');
    const h = gameCredentialHarness(board);
    await h.host.boot();
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(0);

    await h.host.handleGisCredential(ALICE.bearer);

    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
    expect(h.host.board()).toEqual(board);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(0);
  });
});

describe('The shell asks the host, and refreshes only when due (D13)', () => {
  it('The shell asks the host whether it is signed in', () => {
    expect(sessionTokenOffenders()).toEqual([]);
  });

  it.each([
    [true, true, false, true],
    [false, true, false, false],
    [true, false, false, false],
    [true, true, true, false],
  ] as const)(
    'My games refresh is due only on a signed-in lobby with no library (signed in %s, on lobby %s, library loaded %s → %s)',
    (signedIn, onLobby, libraryLoaded, due) => {
      expect(lobbyLibraryDue(signedIn, onLobby, libraryLoaded)).toBe(due);
    },
  );

  it('The shell starts a library read only when one is due', () => {
    const app = readWebSource('App.tsx');
    const sites = refreshLibrarySites(app);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site).toContain('lobbyLibraryDue');
    }
    const calls = lobbyLibraryDueSites(app);
    expect(calls.length).toBeGreaterThan(0);
    for (const { call, around } of calls) {
      expect({
        passesUnsetStateAsLobbyFlag: /state\s*!==\s*undefined/.test(call),
        hashRoute:
          /parsePagesHash\s*\(/.test(around) && /kind\s*===\s*['"]lobby['"]/.test(around),
      }).toEqual({
        passesUnsetStateAsLobbyFlag: false,
        hashRoute: true,
      });
    }
  });
});

describe('The Google chooser mounts once, and never while signed in (D13)', () => {
  it.each([
    [false, true],
    [true, false],
  ] as const)(
    'The chooser slot is offered only while signed out (signed in %s → %s)',
    (signedIn, offered) => {
      expect(chooserSlotOffered(signedIn)).toBe(offered);
    },
  );

  it('An absent chooser slot is not created and is not rendered', async () => {
    await withChooserDocument('absent', (doc) => {
      const gis = mountGis(doc);
      gis.gis.offerChooser();
      expect({
        renderButton: gis.renders.length,
        created: [...doc.created],
        queriedLobbyRow: doc.queries.includes(LOBBY_ROW_SELECTOR),
        slot: doc.slot(),
      }).toEqual({
        renderButton: 0,
        created: [],
        queriedLobbyRow: false,
        slot: null,
      });
    });
  });

  it('An empty chooser slot is rendered once', async () => {
    await withChooserDocument('empty', (doc) => {
      const before = doc.slotParent();
      const gis = mountGis(doc);
      gis.gis.offerChooser();
      gis.gis.offerChooser();
      expect({
        renderButton: gis.renders.length,
        parent: doc.slotParent(),
      }).toEqual({
        renderButton: 1,
        parent: before,
      });
    });
  });

  it('A filled chooser slot is not rendered again', async () => {
    await withChooserDocument('filled', (doc) => {
      const before = doc.slotParent();
      const gis = mountGis(doc);
      gis.gis.offerChooser();
      gis.gis.offerChooser();
      expect({
        renderButton: gis.renders.length,
        parent: doc.slotParent(),
        created: [...doc.created],
      }).toEqual({
        renderButton: 0,
        parent: before,
        created: [],
      });
    });
  });

  it('A credential does not remove the chooser slot', async () => {
    await withChooserDocument('empty', (doc) => {
      const gis = mountGis(doc);
      expect(doc.slot()).not.toBeNull();
      gis.gis.offerChooser();
      gis.fire(ALICE.bearer);
      expect(gis.delivered).toEqual([ALICE.bearer]);
      expect({
        slot: doc.slot() !== null,
        removed: [...doc.removed],
      }).toEqual({
        slot: true,
        removed: [],
      });
    });
  });

  it('The chooser does not attach to a lobby row', () => {
    const gis = readWebSource('online-gis.ts');
    const lobby = sourceWithoutComments(readWebSource('Lobby.tsx'));
    expect({
      gisQueriesLobbyRow: gis.includes(LOBBY_ROW_SELECTOR),
      lobbyRendersChooserId: chooserIdIn(lobby),
      lobbyGatesOnOffered: chooserGated(lobby),
    }).toEqual({
      gisQueriesLobbyRow: false,
      lobbyRendersChooserId: true,
      lobbyGatesOnOffered: true,
    });
  });
});
