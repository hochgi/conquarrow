/**
 * Lobby-adjacent library reads and the deletion / ceiling scenarios.
 *
 * Ordinary Vitest — not message flows. The map store is the fake; nothing here
 * probes a leaf.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.edge-cases.feature
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { endTurn, type InviteSeat } from '@conquarrow/contracts';
import { createOnlineApi } from '../src/create-online-api';
import { persistEnvelope } from '../src/game-snapshot';
import { serializeInvite } from '../src/invite-record';
import {
  gameMetaKey,
  gameStateKey,
  groupMetaKey,
  inviteKey,
  userGroupKey,
  userProfileKey,
} from '../src/s3-keys';
import {
  ALICE,
  CAROL,
  aliceHash,
  carolHash,
  expectStatus,
  fakeGoogle,
  getGame,
  groupHashOfUserHashes,
  mapStore,
  parseBody,
  postMove,
  sequentialBytes,
} from './support';
import { agent, atSeat, heuristicSeat, human, opening } from './remote-agent-mcp.support';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TOKEN = '22'.repeat(32);
const GAME = '000001';

const libraryApi = (name?: string) => {
  const data = new Map<string, string>();
  const names = name === undefined ? {} : { [ALICE.bearer]: { given_name: name } };
  const api = createOnlineApi({
    google: fakeGoogle(names),
    s3: mapStore(data),
    clock: () => 0,
    randomBytes: sequentialBytes(),
    heuristic: () => endTurn(),
  });
  return { api, data };
};

const seedLibrary = (
  data: Map<string, string>,
  seats: readonly InviteSeat[],
  members: readonly string[],
  state = atSeat(opening(seats.length === 6 ? 6 : 3), 1),
): { readonly groupHash: string } => {
  const groupHash = groupHashOfUserHashes([aliceHash()]);
  data.set(
    inviteKey(TOKEN),
    serializeInvite({
      status: 'started',
      creatorUserHash: aliceHash(),
      seats,
      gameNumber: GAME,
    }),
  );
  data.set(
    gameMetaKey(groupHash, GAME),
    JSON.stringify({
      seats,
      inviteToken: TOKEN,
      startedAt: '2026-11-09T00:00:00.000Z',
      players: state.players.map(String),
      activePlayer: String(state.activePlayer),
      lostPlayers: [],
    }),
  );
  data.set(gameStateKey(groupHash, GAME), persistEnvelope(1, state));
  data.set(groupMetaKey(groupHash), JSON.stringify({ nextGameNumber: 2 }));
  for (const hash of members) data.set(userGroupKey(hash, groupHash), '{}');
  return { groupHash };
};

describe('The lobby and the library tell the truth about the chair', () => {
  it('The library labels the agent chair and does not call it your-turn', async () => {
    const named = libraryApi('Ada');
    const seats = [human(aliceHash()), agent(aliceHash()), heuristicSeat()];
    const state = atSeat(opening(3), 1);
    const { groupHash } = seedLibrary(named.data, seats, [aliceHash()], state);
    named.data.set(userProfileKey(aliceHash()), JSON.stringify({ displayName: 'Ada' }));

    const listed = expectStatus(await named.api.handle({
      method: 'GET',
      path: '/my-games',
      headers: { authorization: `Bearer ${ALICE.bearer}` },
    }), 200);
    const row = (parseBody(listed) as { games?: { status?: string; seats?: { kind?: string; label?: string; you?: boolean }[]; groupHash?: string }[] }).games?.find(
      (game) => game.groupHash === groupHash,
    );

    expect(row?.seats?.[1]).toEqual({ kind: 'agent', label: 'Agent (Ada)', you: true });
    expect(row?.status).not.toBe('your-turn');

    const unnamed = libraryApi();
    seedLibrary(unnamed.data, seats, [aliceHash()], state);
    const bare = expectStatus(await unnamed.api.handle({
      method: 'GET',
      path: '/my-games',
      headers: { authorization: `Bearer ${ALICE.bearer}` },
    }), 200);
    const bareRow = (parseBody(bare) as { games?: { seats?: { label?: string }[] }[] }).games?.[0];
    expect(bareRow?.seats?.[1]?.label).toBe('Agent');
  });

  it('An agent-only caller is listed and is never your-turn', async () => {
    const { api, data } = libraryApi();
    const seats = [human(aliceHash()), agent(carolHash()), heuristicSeat()];
    const { groupHash } = seedLibrary(data, seats, [aliceHash(), carolHash()]);

    const listed = expectStatus(await api.handle({
      method: 'GET',
      path: '/my-games',
      headers: { authorization: `Bearer ${CAROL.bearer}` },
    }), 200);
    const row = (parseBody(listed) as {
      games?: { status?: string; seatIndex?: number; groupHash?: string; seats?: { kind?: string; you?: boolean }[] }[];
    }).games?.find((game) => game.groupHash === groupHash);

    expect(row).toBeDefined();
    expect(row?.status).toBe('waiting');
    expect(row?.seats?.[1]).toMatchObject({ kind: 'agent', you: true });
    expect(row?.seatIndex).toBe(1);
  });

  it('An agent-only user may read the game and may not POST a move', async () => {
    const { api, data } = libraryApi();
    const seats = [human(aliceHash()), agent(carolHash()), heuristicSeat()];
    const state = atSeat(opening(3), 1);
    const { groupHash } = seedLibrary(data, seats, [aliceHash(), carolHash()], state);

    const got = await getGame(api, groupHash, GAME, CAROL.bearer);
    expect(got.statusCode).toBe(200);
    const body = parseBody(got) as { seats?: { kind?: string; label?: string }[] };
    const label = body.seats?.[1]?.label;
    expect(label === 'Agent' || (typeof label === 'string' && label.startsWith('Agent ('))).toBe(true);

    const moved = await postMove(api, groupHash, GAME, CAROL.bearer, endTurn(), 1);
    expect(moved.statusCode).toBe(403);
    const raw = data.get(gameStateKey(groupHash, GAME));
    const version = raw === undefined ? undefined : (JSON.parse(raw) as { version?: number }).version;
    expect(version).toBe(1);
  });
});

describe('The stdio package is gone, and the ceiling is the one ADR 0007 already set', () => {
  it('packages/mcp is absent and no stdio bin remains', () => {
    expect(existsSync(resolve(root, 'packages/mcp'))).toBe(false);
    const packages = readdirSync(resolve(root, 'packages'));
    for (const name of packages) {
      const manifest = resolve(root, 'packages', name, 'package.json');
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string;
        bin?: string | Record<string, string>;
      };
      expect(json.name).not.toBe('@conquarrow/mcp');
      const bins = json.bin === undefined ? [] : typeof json.bin === 'string' ? [json.bin] : Object.values(json.bin);
      for (const bin of bins) {
        expect(bin).not.toContain('stdio');
      }
    }
  });

  it('The MCP function stays inside the ADR 0007 ceiling', () => {
    const template = readFileSync(resolve(root, 'infra/template.yaml'), 'utf8');
    expect(template).toContain('ReservedConcurrentExecutions: 5');
    expect(template).toMatch(/ThrottlingRateLimit: 5/);
    expect(template).toMatch(/ThrottlingBurstLimit: 10/);
    expect(template).toContain('mcp.games.hochgi.com');
    expect(template).not.toContain('AWS::Cognito::');
    expect(template).not.toContain('AWS::Budgets::');
    expect(template.match(/Type: AWS::S3::Bucket/g)).toHaveLength(1);
  });
});
