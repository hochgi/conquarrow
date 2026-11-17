/**
 * EARS invariants 13–19 for lobby sign-in (D13).
 *
 * Table-driven cases in Vitest — this repo has no fast-check. No turn flow,
 * so there is no replay fixture. Diagram 6's three alts are the host scenarios
 * in the core and edge suites, not a test-kit probe.
 *
 * @see docs/spec/online-reliability/online-reliability.md
 */

import { describe, expect, it } from 'vitest';
import type { LibraryGameStatus } from '@conquarrow/contracts';
import { createBrowserGis, type BrowserGisId } from '../src/online-gis';
import { chooserSlotOffered, libraryOffered, lobbyLibraryDue } from '../src/online-shell-ui';
import {
  ALICE,
  DEFAULT_ENV,
  INVITE_TOKEN,
  apiCalls,
  makeHostHarness,
  myGamesScript,
  openingBoard,
} from './online-shell.support';
import { withLibraryIdentity } from './online-web.support';
import {
  CHOOSER_ID,
  GAME_ONE,
  GROUP_G,
  GROUP_HASH,
  LOBBY_ROW_SELECTOR,
  gameCredentialHarness,
  inviteCredentialHarness,
  listedGames,
  lobbyWithLibrary,
  mountGis,
  readWebSource,
  sessionTokenOffenders,
  withChooserDocument,
  type ChooserSlot,
} from './online-reliability.signin.support';

const LIBRARY_BODIES: readonly {
  readonly groupHash: string;
  readonly gameNumber: string;
  readonly status: LibraryGameStatus;
}[] = [
  { groupHash: GROUP_G, gameNumber: GAME_ONE, status: 'your-turn' },
  { groupHash: GROUP_G, gameNumber: GAME_ONE, status: 'waiting' },
  { groupHash: GROUP_G, gameNumber: '000002', status: 'won' },
];

const DUE_SPACE: readonly {
  readonly signedIn: boolean;
  readonly onLobby: boolean;
  readonly libraryLoaded: boolean;
}[] = [true, false].flatMap((signedIn) =>
  [true, false].flatMap((onLobby) =>
    [true, false].map((libraryLoaded) => ({ signedIn, onLobby, libraryLoaded })),
  ),
);

describe('online-reliability sign-in invariants (D13)', () => {
  it('When a credential is delivered on the lobby route, the client shall report signed in and the library shall be that body, from exactly one GET /my-games', async () => {
    for (const row of LIBRARY_BODIES) {
      const listed = withLibraryIdentity(row);
      const h = makeHostHarness({ fetchScript: [myGamesScript([listed])] });
      await h.host.boot();
      await h.host.handleGisCredential(ALICE.bearer);
      expect(h.host.signedIn(), row.status).toBe(true);
      expect(apiCalls(h, 'GET', '/my-games'), row.status).toHaveLength(1);
      expect(listedGames(h), row.status).toEqual([
        { groupHash: listed.groupHash, gameNumber: listed.gameNumber, status: listed.status },
      ]);
    }
  });

  it('When the player signs out, the host shall report signed out, the library shall be cleared, and My games shall not be offered', async () => {
    const loaded = lobbyWithLibrary(ALICE.bearer);
    await loaded.host.boot();
    await loaded.host.refreshLibrary();
    expect(loaded.host.adapter().myGames()).toBeDefined();
    loaded.host.signOut();
    expect({
      signedIn: loaded.host.signedIn(),
      library: loaded.host.adapter().myGames(),
      offered: libraryOffered('online', loaded.host.signedIn()),
    }).toEqual({ signedIn: false, library: undefined, offered: false });

    const unloaded = lobbyWithLibrary(ALICE.bearer);
    await unloaded.host.boot();
    expect(unloaded.host.adapter().myGames()).toBeUndefined();
    unloaded.host.signOut();
    expect(unloaded.host.signedIn()).toBe(false);
    expect(unloaded.host.adapter().myGames()).toBeUndefined();
    expect(libraryOffered('online', false)).toBe(false);
  });

  it('The shell shall read signed-in only from the host, and no web source shall read the ID token key from sessionStorage', () => {
    expect(sessionTokenOffenders()).toEqual([]);
  });

  it('While the player is signed out, the hash route is not the lobby, or the library is already loaded, a lobby library read is not due', () => {
    expect(DUE_SPACE).toHaveLength(8);
    for (const cell of DUE_SPACE) {
      const due = cell.signedIn && cell.onLobby && !cell.libraryLoaded;
      expect(
        lobbyLibraryDue(cell.signedIn, cell.onLobby, cell.libraryLoaded),
        JSON.stringify(cell),
      ).toBe(due);
    }
  });

  it('The chooser slot is offered if and only if the player is signed out', () => {
    for (const signedIn of [false, true]) {
      expect(chooserSlotOffered(signedIn), String(signedIn)).toBe(!signedIn);
    }
  });

  it('If the chooser slot is absent or already holds a button, the client shall not call renderButton and shall not create the slot', async () => {
    const absent = await withChooserDocument('absent', (doc) => {
      const gis = mountGis(doc);
      gis.gis.offerChooser();
      return { renderButton: gis.renders.length, created: [...doc.created], slot: doc.slot() };
    });
    const filled = await Promise.all(
      [1, 2].map((children) =>
        withChooserDocument(
          'filled',
          (doc) => {
            const gis = mountGis(doc);
            gis.gis.offerChooser();
            gis.gis.offerChooser();
            return { children, renderButton: gis.renders.length, created: [...doc.created] };
          },
          children,
        ),
      ),
    );
    expect({ absent, filled }).toEqual({
      absent: { renderButton: 0, created: [], slot: null },
      filled: [
        { children: 1, renderButton: 0, created: [] },
        { children: 2, renderButton: 0, created: [] },
      ],
    });
  });

  it('The Google chooser shall not query or append under a lobby-online-row', async () => {
    const slots: readonly ChooserSlot[] = ['absent', 'empty', 'filled'];
    const queries: { slot: ChooserSlot; queried: boolean }[] = [];
    for (const slot of slots) {
      const queried = await withChooserDocument(slot, (doc) => {
        mountGis(doc).gis.offerChooser();
        return doc.queries.includes(LOBBY_ROW_SELECTOR);
      });
      queries.push({ slot, queried });
    }
    expect({
      queries,
      sourceMentionsRow: readWebSource('online-gis.ts').includes(LOBBY_ROW_SELECTOR),
    }).toEqual({
      queries: slots.map((slot) => ({ slot, queried: false })),
      sourceMentionsRow: false,
    });
  });

  it('If a credential is delivered on an invite route or a game route, the client shall not replace that route read with a library read', async () => {
    const invite = inviteCredentialHarness();
    await invite.host.boot();
    await invite.host.handleGisCredential(ALICE.bearer);

    const board = openingBoard('signed-in');
    const game = gameCredentialHarness(board);
    await game.host.boot();
    await game.host.handleGisCredential(ALICE.bearer);

    expect({
      inviteAccepts: apiCalls(invite, 'POST', `/invites/${INVITE_TOKEN}/accept`).length,
      inviteLists: apiCalls(invite, 'GET', '/my-games').length,
      gameReads: apiCalls(game, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`).length,
      gameLists: apiCalls(game, 'GET', '/my-games').length,
      board: game.host.board(),
    }).toEqual({
      inviteAccepts: 1,
      inviteLists: 0,
      gameReads: 1,
      gameLists: 0,
      board,
    });
  });

  it('When document is absent, renderButton is still called with the chooser slot id', () => {
    const had = Object.hasOwn(globalThis, 'document');
    const previous = globalThis.document;
    Reflect.deleteProperty(globalThis, 'document');
    try {
      const renders: unknown[] = [];
      const gisId: BrowserGisId = {
        initialize: () => {},
        prompt: () => {},
        renderButton: (parent) => {
          renders.push(parent);
        },
      };
      const gis = createBrowserGis(DEFAULT_ENV.VITE_GOOGLE_CLIENT_ID, () => {}, { gisId });
      gis.offerChooser();
      expect(renders).toEqual([{ id: CHOOSER_ID }]);
    } finally {
      if (had) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          writable: true,
          value: previous,
        });
      }
    }
  });
});
