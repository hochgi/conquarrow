/**
 * Fakes for the P97 lobby sign-in suite. No jsdom: a scripted `document` is
 * installed on `globalThis` only for the GIS mount scenarios, then restored.
 *
 * @see docs/spec/online-reliability/online-reliability.md
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OnlinePagesGis } from '@conquarrow/contracts';
import { createBrowserGis, type BrowserGisId } from '../src/online-gis';
import {
  ALICE,
  DEFAULT_ENV,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  acceptInviteScript,
  aliceBobSeats,
  aliceHostSeats,
  gameHash,
  getGameScript,
  inviteHash,
  makeHostHarness,
  myGamesScript,
  openingBoard,
  peekInviteScript,
  type HostHarness,
} from './online-shell.support';

export const CHOOSER_ID = 'conquarrow-gis-chooser';
export const LOBBY_ROW_SELECTOR = '.lobby-online-row';
export const GROUP_G = 'G';

export const yourTurnRow = {
  groupHash: GROUP_G,
  gameNumber: GAME_ONE,
  status: 'your-turn' as const,
};

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, '../src');

export const sourceWithoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export const readWebSource = (file: string): string => readFileSync(join(webSrc, file), 'utf8');

/** A read of the ID-token key off `sessionStorage`, not the host store. */
const readsTokenFromSessionStorage = (source: string): boolean => {
  const code = sourceWithoutComments(source);
  if (!code.includes('sessionStorage')) return false;
  return (
    /sessionStorage\s*(?:\.getItem\s*\(|\[)\s*(?:GOOGLE_ID_TOKEN_SESSION_KEY|['"]conquarrow:google-id-token['"])/.test(
      code,
    ) ||
    code.includes('GOOGLE_ID_TOKEN_SESSION_KEY') ||
    code.includes('conquarrow:google-id-token')
  );
};

/** Files under `packages/web/src` that read the ID token key from sessionStorage. */
export const sessionTokenOffenders = (): readonly string[] =>
  readdirSync(webSrc, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => readsTokenFromSessionStorage(readFileSync(join(webSrc, file), 'utf8')))
    .toSorted();

/** The text just before each `refreshLibrary` call, comments stripped. */
export const refreshLibrarySites = (src: string): readonly string[] => {
  const clean = sourceWithoutComments(src);
  const sites: string[] = [];
  const needle = 'refreshLibrary';
  let from = 0;
  while (from < clean.length) {
    const at = clean.indexOf(needle, from);
    if (at < 0) break;
    sites.push(clean.slice(Math.max(0, at - 500), at + needle.length));
    from = at + needle.length;
  }
  return sites;
};

/** `lobbyLibraryDue(...)` calls, nested parentheses included, comments stripped. */
export const lobbyLibraryDueCalls = (src: string): readonly string[] => {
  const clean = sourceWithoutComments(src);
  const needle = 'lobbyLibraryDue';
  const calls: string[] = [];
  let from = 0;
  while (from < clean.length) {
    const at = clean.indexOf(needle, from);
    if (at < 0) break;
    let open = at + needle.length;
    while (open < clean.length && /\s/.test(clean[open] ?? '')) open += 1;
    if (clean[open] !== '(') {
      from = at + needle.length;
      continue;
    }
    let depth = 0;
    let end = open;
    for (; end < clean.length; end += 1) {
      const ch = clean[end];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          calls.push(clean.slice(at, end + 1));
          break;
        }
      }
    }
    from = end + 1;
  }
  return calls;
};

/**
 * The call plus a short window before it. Enough for `parsePagesHash(...).kind
 * === 'lobby'` written on the line above, not for a distant effect.
 */
export const lobbyLibraryDueSites = (src: string): readonly { call: string; around: string }[] => {
  const clean = sourceWithoutComments(src);
  return lobbyLibraryDueCalls(src).map((call) => {
    const at = clean.indexOf(call);
    return { call, around: clean.slice(Math.max(0, at - 400), at + call.length) };
  });
};

export type ListedGame = {
  readonly groupHash: string;
  readonly gameNumber: string;
  readonly status: string;
};

export const listedGames = (h: HostHarness): readonly ListedGame[] =>
  (h.host.adapter().myGames()?.games ?? []).map((row) => ({
    groupHash: row.groupHash,
    gameNumber: row.gameNumber,
    status: row.status,
  }));

export const lobbyWithLibrary = (sessionToken?: string): HostHarness =>
  makeHostHarness({
    ...(sessionToken === undefined ? {} : { sessionToken }),
    fetchScript: [myGamesScript([yourTurnRow])],
  });

export type FakeEl = {
  nodeType: 1;
  parentElement: FakeEl | null;
  readonly children: FakeEl[];
  readonly childNodes: readonly FakeEl[];
  readonly childElementCount: number;
  readonly firstElementChild: FakeEl | null;
  id: string;
  appendChild: (child: FakeEl) => FakeEl;
  remove: () => void;
};

export type ChooserDocument = {
  readonly queries: readonly string[];
  readonly created: readonly string[];
  readonly removed: readonly string[];
  slot: () => FakeEl | null;
  slotParent: () => FakeEl | null;
  spawnButton: () => FakeEl;
  restore: () => void;
};

export const isFakeEl = (value: unknown): value is FakeEl =>
  typeof value === 'object' &&
  value !== null &&
  'nodeType' in value &&
  value.nodeType === 1 &&
  'appendChild' in value &&
  typeof value.appendChild === 'function';

const makeElement = (
  registry: Map<string, FakeEl>,
  removed: string[],
): FakeEl => {
  let currentId = '';
  const el: FakeEl = {
    nodeType: 1,
    parentElement: null,
    children: [],
    get childNodes() {
      return el.children;
    },
    get childElementCount() {
      return el.children.length;
    },
    get firstElementChild() {
      return el.children[0] ?? null;
    },
    get id() {
      return currentId;
    },
    set id(next: string) {
      if (currentId !== '') registry.delete(currentId);
      currentId = next;
      if (next !== '') registry.set(next, el);
    },
    appendChild(child) {
      if (child.parentElement !== null) {
        const siblings = child.parentElement.children;
        const index = siblings.indexOf(child);
        if (index >= 0) siblings.splice(index, 1);
        child.parentElement = null;
      }
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (el.parentElement !== null) {
        const siblings = el.parentElement.children;
        const index = siblings.indexOf(el);
        if (index >= 0) siblings.splice(index, 1);
        el.parentElement = null;
      }
      if (currentId !== '') {
        registry.delete(currentId);
        removed.push(currentId);
      }
    },
  };
  return el;
};

export type ChooserSlot = 'absent' | 'empty' | 'filled';

/**
 * A document whose chooser slot is absent, empty, or already holding buttons.
 * The slot, when present, is parented under an anchor that is not `body`, so a
 * move onto `body` or a lobby row is observable.
 */
export const installChooserDocument = (
  slot: ChooserSlot,
  childCount = 1,
): ChooserDocument => {
  const registry = new Map<string, FakeEl>();
  const queries: string[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  const body = makeElement(registry, removed);
  body.id = 'body';
  const anchor = makeElement(registry, removed);
  anchor.id = 'anchor';
  if (slot !== 'absent') {
    const chooser = makeElement(registry, removed);
    chooser.id = CHOOSER_ID;
    anchor.appendChild(chooser);
    if (slot === 'filled') {
      for (let n = 0; n < childCount; n += 1) {
        chooser.appendChild(makeElement(registry, removed));
      }
    }
  }
  const fake = {
    body,
    querySelector: (selector: string): FakeEl | null => {
      queries.push(selector);
      if (selector === `#${CHOOSER_ID}`) return registry.get(CHOOSER_ID) ?? null;
      return null;
    },
    getElementById: (id: string): FakeEl | null => registry.get(id) ?? null,
    createElement: (tag: string): FakeEl => {
      created.push(tag);
      return makeElement(registry, removed);
    },
  };
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previous = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: fake,
  });
  return {
    queries,
    created,
    removed,
    slot: () => registry.get(CHOOSER_ID) ?? null,
    slotParent: () => registry.get(CHOOSER_ID)?.parentElement ?? null,
    spawnButton: () => makeElement(registry, removed),
    restore: () => {
      if (hadDocument) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          writable: true,
          value: previous,
        });
        return;
      }
      Reflect.deleteProperty(globalThis, 'document');
    },
  };
};

export const withChooserDocument = async <T>(
  slot: ChooserSlot,
  run: (doc: ChooserDocument) => T | Promise<T>,
  childCount = 1,
): Promise<T> => {
  const doc = installChooserDocument(slot, childCount);
  try {
    return await run(doc);
  } finally {
    doc.restore();
  }
};

type CredentialCallback = (response: { readonly credential?: string }) => void;

export type MountedGis = {
  readonly gis: OnlinePagesGis;
  readonly renders: readonly unknown[];
  readonly delivered: readonly string[];
  fire: (token: string) => void;
};

/** GIS whose `renderButton` fills the parent, as the real button would. */
export const mountGis = (doc: ChooserDocument): MountedGis => {
  const renders: unknown[] = [];
  const delivered: string[] = [];
  let callback: CredentialCallback | undefined;
  const gisId: BrowserGisId = {
    initialize: (config) => {
      callback = config.callback;
    },
    prompt: () => {},
    renderButton: (parent) => {
      renders.push(parent);
      if (isFakeEl(parent)) parent.appendChild(doc.spawnButton());
    },
  };
  const gis = createBrowserGis(DEFAULT_ENV.VITE_GOOGLE_CLIENT_ID, (token) => {
    delivered.push(token);
  }, { gisId });
  return {
    gis,
    renders,
    delivered,
    fire: (token) => {
      callback?.({ credential: token });
    },
  };
};

export const inviteCredentialHarness = (): HostHarness =>
  makeHostHarness({
    hash: inviteHash(INVITE_TOKEN),
    fetchScript: [
      peekInviteScript(INVITE_TOKEN, aliceHostSeats()),
      acceptInviteScript(INVITE_TOKEN, aliceBobSeats()),
    ],
  });

export const gameCredentialHarness = (
  board: ReturnType<typeof openingBoard> = openingBoard('signed-in'),
): HostHarness =>
  makeHostHarness({
    hash: gameHash(GROUP_HASH, GAME_ONE),
    fetchScript: [getGameScript(board)],
  });

export { ALICE, GAME_ONE, GROUP_HASH, INVITE_TOKEN };
