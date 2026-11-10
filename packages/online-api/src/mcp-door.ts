/**
 * MCP door dispatch (P92). The handler owns join, the offer check, the burst,
 * and the ping decision. Leaves stay leaves.
 *
 * @see docs/spec/remote-agent-mcp/SCENARIOS.md
 */

import { createHash } from 'node:crypto';
import type { GameState, InviteSeat, Move } from '@conquarrow/contracts';
import { endTurn as endTurnMove, movesEqual } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { offerText } from '@conquarrow/byok-offer';
import { isPreconditionFailed, type OnlineApiDeps } from './api-types';
import {
  applyMove,
  ensurePosition,
  persistPosition,
  runBurst,
} from './game-handlers';
import { bytesToHex, groupHashFromUserHashes, userHashFromSub } from './hashing';
import {
  boundHumanHashes,
  indexOfBoundAgent,
  nextUnboundAgentIndex,
  parseInvite,
  serializeInvite,
  type InviteRecord,
} from './invite-record';
import { notifyHumans } from './notify';
import { inviteKey, lobbyKey } from './s3-keys';
import { getObject, listObjects, putObject } from './store-io';
import { upsertProfileDisplayName } from './user-profile';
import {
  MCP_AUDIENCE,
  MCP_ISSUER,
  MCP_RESOURCE_METADATA,
  redactSecrets,
  type McpAccessClaims,
  type McpHttpDeps,
  type McpHttpRequest,
  type McpHttpResult,
} from './mcp-http';

const geometry = makeTiling();
const rules = makeRules(geometry);
const PLAN_CAP = 512;
const ACCESS_MS = 15 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_HEX = /^[0-9a-f]{64}$/;
const INVITE_IN_TEXT = /\/invite\/([0-9a-f]{64})/;
const KNOWN_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];

const json = (statusCode: number, body: unknown, extra?: Record<string, string>): McpHttpResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
});

const unauthorized = (): McpHttpResult =>
  json(401, { error: 'invalid_token' }, {
    'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${MCP_RESOURCE_METADATA}"`,
  });

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const bearerOf = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
};

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const onlineDeps = (deps: McpHttpDeps): OnlineApiDeps => ({
  google: deps.google,
  s3: deps.store,
  clock: deps.clock,
  randomBytes: deps.randomBytes,
  ...(deps.heuristic === undefined ? {} : { heuristic: deps.heuristic }),
  postToConnection: deps.postToConnection,
});

const claimsOf = (deps: McpHttpDeps, request: McpHttpRequest): McpAccessClaims | undefined => {
  const token = bearerOf(request.headers?.['authorization'] ?? request.headers?.['Authorization']);
  if (token === undefined) return undefined;
  const claims = deps.signer.verify(token);
  if (claims === undefined) return undefined;
  if (claims.iss !== MCP_ISSUER || claims.aud !== MCP_AUDIENCE) return undefined;
  if (claims.exp <= deps.clock()) return undefined;
  return claims;
};

const handleOf = (raw: string): string | undefined => {
  if (TOKEN_HEX.test(raw)) return raw;
  return INVITE_IN_TEXT.exec(raw)?.[1];
};

const toolResult = (
  id: unknown,
  payload: unknown,
  isError: boolean,
): McpHttpResult =>
  json(200, {
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError,
    },
  });

const protocolVersion = (requested: unknown): string =>
  typeof requested === 'string' && KNOWN_VERSIONS.includes(requested) ? requested : '2026-07-28';

const metadataDocument = (): McpHttpResult =>
  json(200, {
    resource: MCP_AUDIENCE,
    authorization_servers: [MCP_ISSUER],
    bearer_methods_supported: ['header'],
    resource_name: 'conquarrow',
  });

const authorizationServer = (): McpHttpResult =>
  json(200, {
    issuer: MCP_ISSUER,
    authorization_endpoint: `${MCP_ISSUER}/authorize`,
    token_endpoint: `${MCP_ISSUER}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ['none'],
  });

const unwrapHost = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

/**
 * Node's `URL.hostname` serialises an IPv4-mapped address as `[::ffff:hhhh:hhhh]`
 * (`[::ffff:a00:1]` for 10.0.0.1), not the dotted form the request spelled.
 */
const mappedIpv4 = (host: string): string | undefined => {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted?.[1] !== undefined) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  const hiText = hex?.[1];
  const loText = hex?.[2];
  if (hiText === undefined || loText === undefined) return undefined;
  const hi = Number.parseInt(hiText, 16);
  const lo = Number.parseInt(loText, 16);
  const octet = (word: number, shift: number): string => String((word >> shift) & 0xff);
  return [octet(hi, 8), octet(hi, 0), octet(lo, 8), octet(lo, 0)].join('.');
};

const bareHost = (hostname: string): string => {
  const host = unwrapHost(hostname).toLowerCase();
  return mappedIpv4(host) ?? host;
};

const ipv4Parts = (host: string): readonly number[] | undefined => {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    nums.push(n);
  }
  return nums;
};

/** Loopback, private, link-local, and 0.0.0.0. Refused before any metadata fetch. */
const isRefusedMetadataHost = (hostname: string): boolean => {
  const host = bareHost(hostname);
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.local')
  ) {
    return true;
  }
  const v4 = ipv4Parts(host);
  if (v4 !== undefined) {
    const a = v4[0] ?? -1;
    const b = v4[1] ?? -1;
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (!host.includes(':')) return false;
  const headText = host.split(':')[0];
  const head = Number.parseInt(headText === undefined || headText === '' ? '0' : headText, 16);
  if (Number.isNaN(head)) return false;
  if ((head & 0xffc0) === 0xfe80) return true;
  if ((head & 0xfe00) === 0xfc00) return true;
  return false;
};

const httpsClientId = (raw: string | undefined): URL | undefined => {
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.pathname === '/' || url.pathname === '') return undefined;
  if (isRefusedMetadataHost(url.hostname)) return undefined;
  return url;
};

const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url');

const readInvite = async (
  deps: McpHttpDeps,
  token: string,
): Promise<{ readonly invite: InviteRecord; readonly raw: string } | undefined> => {
  const raw = await getObject(deps.store, inviteKey(token));
  if (raw === undefined) return undefined;
  const invite = parseInvite(raw);
  if (invite === undefined) return undefined;
  return { invite, raw };
};

const bindAgent = async (
  deps: McpHttpDeps,
  token: string,
  userHash: string,
): Promise<McpHttpResult> => {
  for (;;) {
    const loaded = await readInvite(deps, token);
    if (loaded === undefined) return toolResult(1, { error: 'bad-handle' }, true);
    const { invite, raw } = loaded;
    if (invite.status === 'revoked') return toolResult(1, { error: 'revoked' }, true);
    if (invite.status === 'started') return toolResult(1, { error: 'started' }, true);
    const held = indexOfBoundAgent(invite.seats, userHash);
    if (held >= 0) {
      await putObject(deps.store, lobbyKey(userHash, token), '{}');
      return toolResult(1, { seatIndex: held, kind: 'agent', status: 'joined' }, false);
    }
    if (!invite.seats.some((seat) => seat.kind === 'agent')) {
      return toolResult(1, { error: 'no-agent-seat' }, true);
    }
    const next = nextUnboundAgentIndex(invite.seats);
    if (next < 0) return toolResult(1, { error: 'full' }, true);
    const seats = invite.seats.map((seat, index) =>
      index === next ? { kind: 'agent' as const, userHash } : seat,
    );
    try {
      await putObject(deps.store, inviteKey(token), serializeInvite({ ...invite, seats }), { ifMatch: raw });
    } catch (error: unknown) {
      if (isPreconditionFailed(error)) continue;
      throw error;
    }
    await putObject(deps.store, lobbyKey(userHash, token), '{}');
    return toolResult(1, { seatIndex: next, kind: 'agent', status: 'joined' }, false);
  }
};

const seatIndexOf = (game: GameState): number => {
  const active = String(game.activePlayer);
  for (let i = 0; i < game.players.length; i += 1) {
    if (String(game.players[i]) === active) return i;
  }
  return -1;
};

const groupOf = (invite: InviteRecord): { readonly groupHash: string; readonly gameNumber: string } | undefined => {
  if (invite.gameNumber === undefined) return undefined;
  return { groupHash: groupHashFromUserHashes(boundHumanHashes(invite.seats)), gameNumber: invite.gameNumber };
};

const stop = (id: unknown, reason: string): McpHttpResult =>
  toolResult(id, { stop: true, reason }, false);

const offerFor = (state: GameState, seatIndex: number): string | undefined => {
  const seat = state.players[seatIndex];
  if (seat === undefined) return undefined;
  return offerText(state, seat);
};

const legalNow = (state: GameState, move: Move): boolean =>
  rules.legalMoves(state).some((offered) => movesEqual(offered, move));

const stepsRemain = (state: GameState): boolean =>
  rules.legalMoves(state).some((move) => move.kind === 'step');

const clip = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.slice(0, PLAN_CAP);
};

const replyLine = (
  version: number,
  moves: readonly number[],
  endTurn: boolean,
  why: string | undefined,
  plan: string | undefined,
): string => {
  const agentReply: { moves: readonly number[]; endTurn: boolean; why?: string; plan?: string } = {
    moves,
    endTurn,
  };
  if (why !== undefined) agentReply.why = why;
  if (plan !== undefined) agentReply.plan = plan;
  return JSON.stringify({ v: version, agentReply });
};

const ping = async (
  deps: McpHttpDeps,
  seats: readonly InviteSeat[],
  acting: string,
  version: number,
  groupHash: string,
  gameNumber: string,
): Promise<void> => {
  await notifyHumans(
    deps.store,
    deps.postToConnection,
    seats,
    { type: 'stateChanged', version, groupHash, gameNumber },
    undefined,
    acting,
  );
};

const commit = async (
  deps: McpHttpDeps,
  groupHash: string,
  gameNumber: string,
  version: number,
  game: GameState,
  moves: readonly Move[],
  raw: string,
  extra: string,
  seats: readonly InviteSeat[],
  acting: string,
): Promise<'ok' | 'lost'> => {
  try {
    await persistPosition(deps.store, groupHash, gameNumber, version, game, moves, raw, extra);
  } catch (error: unknown) {
    if (isPreconditionFailed(error)) return 'lost';
    throw error;
  }
  await ping(deps, seats, acting, version, groupHash, gameNumber);
  return 'ok';
};

export const handleMcpHttp = async (
  deps: McpHttpDeps,
  request: McpHttpRequest,
): Promise<McpHttpResult> => {
  if (request.path === '/.well-known/oauth-protected-resource/conquarrow' && request.method === 'GET') {
    return metadataDocument();
  }
  if (request.path === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
    return authorizationServer();
  }
  if (request.path === '/register') return json(404, { error: 'not found' });
  if (request.path === '/authorize' && request.method === 'GET') return authorize(deps, request);
  if (request.path === '/authorize/continue' && request.method === 'GET') return continueAuthorize(deps, request);
  if (request.path === '/oauth/callback' && request.method === 'GET') return oauthCallback(deps, request);
  if (request.path === '/token' && request.method === 'POST') return token(deps, request);
  if (request.path === '/conquarrow' && (request.method === 'GET' || request.method === 'DELETE')) {
    return { statusCode: 405, headers: { 'content-type': 'application/json' }, body: '' };
  }
  if (request.path !== '/conquarrow' || request.method !== 'POST') {
    return json(404, { error: 'not found' });
  }
  const claims = claimsOf(deps, request);
  if (claims === undefined) return unauthorized();
  return rpc(deps, request, claims);
};

const parseHttpUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
};

/**
 * Exact match, or the same loopback scheme, host, and path with another port.
 * IDEs bind an ephemeral port. RFC 8252 §7.3 requires the server to allow it.
 */
const redirectListed = (listed: readonly unknown[], requested: string): boolean => {
  if (listed.includes(requested)) return true;
  const asked = parseHttpUrl(requested);
  if (asked === undefined || !isLoopbackHost(asked.hostname)) return false;
  for (const entry of listed) {
    if (typeof entry !== 'string') continue;
    const allowed = parseHttpUrl(entry);
    if (allowed === undefined || !isLoopbackHost(allowed.hostname)) continue;
    if (
      allowed.protocol === asked.protocol &&
      allowed.hostname === asked.hostname &&
      allowed.pathname === asked.pathname &&
      allowed.search === asked.search
    ) {
      return true;
    }
  }
  return false;
};

const authorize = async (deps: McpHttpDeps, request: McpHttpRequest): Promise<McpHttpResult> => {
  const clientId = httpsClientId(request.query?.['client_id']);
  if (clientId === undefined) return json(400, { error: 'invalid_client' });
  const redirect = request.query?.['redirect_uri'];
  const challenge = request.query?.['code_challenge'];
  const method = request.query?.['code_challenge_method'];
  const resource = request.query?.['resource'];
  if (redirect === undefined || challenge === undefined || method !== 'S256' || resource !== MCP_AUDIENCE) {
    return json(400, { error: 'invalid_request' });
  }
  const fetched = await deps.metadata.fetch(clientId.toString());
  let doc: unknown;
  try {
    doc = JSON.parse(fetched) as unknown;
  } catch {
    return json(400, { error: 'invalid_client' });
  }
  const rec = asRecord(doc);
  const listed = rec?.['redirect_uris'];
  const declared = rec?.['client_id'];
  if (declared !== clientId.toString() || !Array.isArray(listed) || !redirectListed(listed, redirect)) {
    return json(400, { error: 'invalid_redirect' });
  }
  const ticket = bytesToHex(deps.randomBytes(16));
  await putObject(
    deps.store,
    `conquarrow/oauth/tickets/${ticket}`,
    JSON.stringify({
      clientId: clientId.toString(),
      redirect,
      challenge,
      resource,
      ...(request.query?.['state'] === undefined ? {} : { clientState: request.query['state'] }),
    }),
  );
  const host = new URL(redirect).hostname;
  const href = `/authorize/continue?ticket=${ticket}`;
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: `<p>Continue to ${host}</p><a href="${href}">Continue</a>`,
  };
};

const continueAuthorize = async (
  deps: McpHttpDeps,
  request: McpHttpRequest,
): Promise<McpHttpResult> => {
  const ticket = request.query?.['ticket'];
  if (ticket === undefined) return json(400, { error: 'invalid_request' });
  const key = `conquarrow/oauth/tickets/${ticket}`;
  const raw = await getObject(deps.store, key);
  const stored = asRecord(raw === undefined ? undefined : JSON.parse(raw));
  if (stored === undefined) return json(400, { error: 'invalid_request' });
  const verifier =
    typeof stored['googleVerifier'] === 'string' ? stored['googleVerifier'] : bytesToHex(deps.randomBytes(32));
  if (stored['googleVerifier'] !== verifier) {
    await putObject(deps.store, key, JSON.stringify({ ...stored, googleVerifier: verifier }));
  }
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', deps.googleAuthClientId ?? '');
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('redirect_uri', `${MCP_ISSUER}/oauth/callback`);
  google.searchParams.set('scope', 'openid profile');
  google.searchParams.set('state', ticket);
  google.searchParams.set('code_challenge', s256(verifier));
  google.searchParams.set('code_challenge_method', 'S256');
  return { statusCode: 302, headers: { location: google.toString() }, body: '' };
};

const oauthCallback = async (deps: McpHttpDeps, request: McpHttpRequest): Promise<McpHttpResult> => {
  const ticket = request.query?.['state'];
  const code = request.query?.['code'];
  if (ticket === undefined || code === undefined) return json(400, { error: 'invalid_request' });
  const raw = await getObject(deps.store, `conquarrow/oauth/tickets/${ticket}`);
  const stored = asRecord(raw === undefined ? undefined : JSON.parse(raw));
  const redirect = stored?.['redirect'];
  const challenge = stored?.['challenge'];
  if (stored === undefined || typeof redirect !== 'string' || typeof challenge !== 'string') {
    return json(400, { error: 'invalid_request' });
  }
  const googleVerifier = stored['googleVerifier'];
  let exchanged: { readonly idToken: string };
  try {
    exchanged = await deps.googleCodeExchange.exchange(
      code,
      `${MCP_ISSUER}/oauth/callback`,
      typeof googleVerifier === 'string' ? googleVerifier : undefined,
    );
  } catch {
    return json(401, { error: 'invalid_token' });
  }
  const verified = await deps.google.verify(`Bearer ${exchanged.idToken}`);
  if (!verified.ok) return json(401, { error: 'invalid_token' });
  await upsertProfileDisplayName(deps.store, userHashFromSub(verified.sub), verified.displayName);
  const ours = bytesToHex(deps.randomBytes(32));
  await putObject(
    deps.store,
    `conquarrow/oauth/codes/${ours}`,
    JSON.stringify({
      sub: verified.sub,
      challenge,
      redirect,
      exp: deps.clock() + 60 * 1000,
    }),
  );
  const back = new URL(redirect);
  back.searchParams.set('code', ours);
  back.searchParams.set('iss', MCP_ISSUER);
  if (typeof stored['clientState'] === 'string' && stored['clientState'] !== '') {
    back.searchParams.set('state', stored['clientState']);
  }
  return { statusCode: 302, headers: { location: back.toString() }, body: '' };
};

const issuePair = (
  deps: McpHttpDeps,
  sub: string,
): { readonly access: string; readonly refresh: string; readonly claims: McpAccessClaims } => {
  const iat = deps.clock();
  const claims: McpAccessClaims = {
    iss: MCP_ISSUER,
    aud: MCP_AUDIENCE,
    sub,
    iat,
    exp: iat + ACCESS_MS,
  };
  return { access: deps.signer.sign(claims), refresh: bytesToHex(deps.randomBytes(32)), claims };
};

const token = async (deps: McpHttpDeps, request: McpHttpRequest): Promise<McpHttpResult> => {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? '') as unknown;
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const rec = asRecord(body);
  if (rec?.['resource'] !== MCP_AUDIENCE) return json(400, { error: 'invalid_target' });
  if (rec['grant_type'] === 'refresh_token') return refresh(deps, rec);
  if (rec['grant_type'] === 'authorization_code') return exchangeCode(deps, rec);
  return json(400, { error: 'unsupported_grant' });
};

const exchangeCode = async (deps: McpHttpDeps, rec: Record<string, unknown>): Promise<McpHttpResult> => {
  const code = rec['code'];
  const verifier = rec['code_verifier'];
  if (typeof code !== 'string' || typeof verifier !== 'string') return json(400, { error: 'invalid_request' });
  const key = `conquarrow/oauth/codes/${code}`;
  const raw = await getObject(deps.store, key);
  const stored = asRecord(raw === undefined ? undefined : JSON.parse(raw));
  if (stored === undefined) return unauthorized();
  const exp = stored['exp'];
  const challenge = stored['challenge'];
  const sub = stored['sub'];
  if (typeof exp !== 'number' || deps.clock() >= exp || typeof challenge !== 'string' || typeof sub !== 'string') {
    return unauthorized();
  }
  if (s256(verifier) !== challenge) return unauthorized();
  await deps.store.delete(key);
  const pair = issuePair(deps, sub);
  await putObject(
    deps.store,
    `conquarrow/users/${userHashFromSub(sub)}/mcp-refresh.json`,
    JSON.stringify({ hash: sha256(pair.refresh), exp: deps.clock() + REFRESH_MS, sub }),
  );
  return json(200, { access_token: pair.access, refresh_token: pair.refresh, token_type: 'Bearer' });
};

const refresh = async (deps: McpHttpDeps, rec: Record<string, unknown>): Promise<McpHttpResult> => {
  const presented = rec['refresh_token'];
  if (typeof presented !== 'string') return unauthorized();
  const digest = sha256(presented);
  const keys = [...(await listObjects(deps.store, 'conquarrow/users/'))].sort();
  for (const key of keys) {
    if (!key.endsWith('/mcp-refresh.json')) continue;
    const raw = await getObject(deps.store, key);
    const stored = asRecord(raw === undefined ? undefined : JSON.parse(raw));
    if (stored?.['hash'] !== digest) continue;
    const exp = stored['exp'];
    if (typeof exp !== 'number' || deps.clock() >= exp) return unauthorized();
    const userHash = key.split('/')[2];
    if (userHash === undefined) return unauthorized();
    const sub = typeof stored['sub'] === 'string' ? stored['sub'] : userHash;
    const pair = issuePair(deps, sub);
    await putObject(
      deps.store,
      key,
      JSON.stringify({ hash: sha256(pair.refresh), exp: deps.clock() + REFRESH_MS, sub }),
    );
    return json(200, { access_token: pair.access, refresh_token: pair.refresh, token_type: 'Bearer' });
  }
  return unauthorized();
};

const rpc = async (
  deps: McpHttpDeps,
  request: McpHttpRequest,
  claims: McpAccessClaims,
): Promise<McpHttpResult> => {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? '') as unknown;
  } catch {
    return json(400, { error: 'parse error' });
  }
  const rec = asRecord(body);
  if (rec === undefined || typeof rec['method'] !== 'string') return json(400, { error: 'invalid request' });
  const method = rec['method'];
  const id = rec['id'];
  if (method === 'notifications/initialized') {
    return { statusCode: 202, headers: { 'content-type': 'application/json' }, body: '' };
  }
  if (method === 'initialize') {
    const params = asRecord(rec['params']);
    return json(200, {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: protocolVersion(params?.['protocolVersion']),
        capabilities: { tools: {} },
        serverInfo: { name: 'conquarrow', version: '0' },
      },
    });
  }
  if (method === 'tools/list') return toolsList(id);
  if (method === 'tools/call') {
    return toolsCall(
      deps,
      id,
      asRecord(rec['params']),
      claims,
      bearerOf(request.headers?.['authorization'] ?? request.headers?.['Authorization']),
    );
  }
  return json(200, { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'method not found' } });
};

const STOP_CLAUSE =
  'When the result has stop: true, do not call another tool; tell the person to send a message when the human seat has moved.';

const toolsList = (id: unknown): McpHttpResult =>
  json(200, {
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      tools: [
        {
          name: 'join',
          description: `Bind the next unbound agent seat. Does not Start. ${STOP_CLAUSE} On a correctable error, correct once, then stop.`,
          inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] },
        },
        {
          name: 'observe',
          description: `${STOP_CLAUSE} On a correctable error, correct once, then stop.`,
          inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] },
        },
        {
          name: 'move',
          description: `Apply a BYOK reply. On a correctable error, correct once, then stop. ${STOP_CLAUSE}`,
          inputSchema: {
            type: 'object',
            properties: {
              handle: { type: 'string' },
              moves: { type: 'array' },
              endTurn: { type: 'boolean' },
            },
            required: ['handle', 'moves', 'endTurn'],
          },
        },
      ],
    },
  });

const toolsCall = async (
  deps: McpHttpDeps,
  id: unknown,
  params: Record<string, unknown> | undefined,
  claims: McpAccessClaims,
  accessToken: string | undefined,
): Promise<McpHttpResult> => {
  const name = params?.['name'];
  const args = asRecord(params?.['arguments']);
  const handleRaw = args?.['handle'];
  if (typeof name !== 'string' || typeof handleRaw !== 'string') {
    return toolResult(id, { error: 'bad arguments', stop: false }, true);
  }
  const token = handleOf(handleRaw);
  if (token === undefined) return toolResult(id, { error: 'bad-handle' }, true);
  const userHash = userHashFromSub(claims.sub);
  if (name === 'join') {
    const joined = await bindAgent(deps, token, userHash);
    return retarget(joined, id);
  }
  if (name === 'observe') return observe(deps, id, token, userHash);
  if (name === 'move') return move(deps, id, token, userHash, args ?? {}, accessToken);
  return toolResult(id, { error: 'unknown tool', stop: false }, true);
};

const retarget = (result: McpHttpResult, id: unknown): McpHttpResult => {
  const parsed = asRecord(JSON.parse(result.body));
  if (parsed === undefined) return result;
  return json(result.statusCode, { ...parsed, id });
};

const loadedTurn = async (
  deps: McpHttpDeps,
  token: string,
  userHash: string,
): Promise<
  | { readonly kind: 'stop'; readonly reason: string }
  | {
      readonly kind: 'ready';
      readonly invite: InviteRecord;
      readonly seatIndex: number;
      readonly groupHash: string;
      readonly gameNumber: string;
      readonly game: GameState;
      readonly version: number;
      readonly raw: string;
    }
> => {
  const loaded = await readInvite(deps, token);
  if (loaded === undefined) return { kind: 'stop', reason: 'not-seated' };
  if (loaded.invite.status !== 'started') return { kind: 'stop', reason: 'not-started' };
  const seatIndex = indexOfBoundAgent(loaded.invite.seats, userHash);
  if (seatIndex < 0) return { kind: 'stop', reason: 'not-seated' };
  const located = groupOf(loaded.invite);
  if (located === undefined) return { kind: 'stop', reason: 'not-started' };
  const position = await ensurePosition(
    onlineDeps(deps),
    located.groupHash,
    located.gameNumber,
    loaded.invite.seats,
    userHash,
    true,
  );
  if ('statusCode' in position) return { kind: 'stop', reason: 'not-started' };
  return {
    kind: 'ready',
    invite: loaded.invite,
    seatIndex,
    groupHash: located.groupHash,
    gameNumber: located.gameNumber,
    game: position.game,
    version: position.version,
    raw: position.raw,
  };
};

const observe = async (
  deps: McpHttpDeps,
  id: unknown,
  token: string,
  userHash: string,
): Promise<McpHttpResult> => {
  const turn = await loadedTurn(deps, token, userHash);
  if (turn.kind === 'stop') return stop(id, turn.reason);
  if (turn.game.winner !== undefined) return stop(id, 'game-over');
  if (seatIndexOf(turn.game) !== turn.seatIndex) return stop(id, 'not-your-turn');
  const offer = offerFor(turn.game, turn.seatIndex);
  if (offer === undefined) return stop(id, 'not-your-turn');
  return toolResult(id, { stop: false, offer }, false);
};

const move = async (
  deps: McpHttpDeps,
  id: unknown,
  token: string,
  userHash: string,
  args: Record<string, unknown>,
  accessToken: string | undefined,
): Promise<McpHttpResult> => {
  const turn = await loadedTurn(deps, token, userHash);
  if (turn.kind === 'stop') return stop(id, turn.reason);
  if (turn.game.winner !== undefined) return stop(id, 'game-over');
  if (seatIndexOf(turn.game) !== turn.seatIndex) return stop(id, 'not-your-turn');
  const indices = integerList(args['moves']);
  if (indices === undefined || typeof args['endTurn'] !== 'boolean') {
    return toolResult(id, { error: 'reply is not usable', stop: false }, true);
  }
  const endTurn = args['endTurn'];
  const secrets = [token, accessToken ?? ''];
  const why = clip(redactSecrets(stringOrEmpty(args['why']), secrets));
  const plan = clip(redactSecrets(stringOrEmpty(args['plan']), secrets));
  deps.log.write('agent-move');
  if (indices.length === 0 && !endTurn && stepsRemain(turn.game)) {
    const offer = offerFor(turn.game, turn.seatIndex) ?? '';
    return toolResult(id, { stop: false, offer }, false);
  }
  const applied = applyPrefix(turn.game, indices);
  if (applied === undefined) {
    return toolResult(id, { error: 'an index is unknown or illegal now', stop: false }, true);
  }
  const remain = stepsRemain(applied.game);
  const finish = endTurn || !remain || applied.game.winner !== undefined;
  let game = applied.game;
  const moves = [...applied.moves];
  if (finish && game.winner === undefined && String(game.activePlayer) === String(turn.game.activePlayer)) {
    const ended = applyMove(game, endTurnMove());
    moves.push(endTurnMove());
    game = ended;
  }
  if (finish && deps.heuristic !== undefined && game.winner === undefined) {
    const burst = runBurst(game, turn.invite.seats, deps.heuristic);
    game = burst.game;
    moves.push(...burst.moves);
  }
  const version = turn.version + 1;
  const extra = replyLine(version, indices, endTurn, why, plan);
  const wrote = await commit(
    deps,
    turn.groupHash,
    turn.gameNumber,
    version,
    game,
    moves,
    turn.raw,
    extra,
    turn.invite.seats,
    userHash,
  );
  if (wrote === 'lost') {
    return toolResult(id, { error: 'the position changed; observe and try once', stop: false }, true);
  }
  if (!finish) {
    const offer = offerFor(game, turn.seatIndex) ?? '';
    return toolResult(id, { applied: true, version, stop: false, offer }, false);
  }
  return toolResult(id, { applied: true, version, stop: true }, false);
};

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

const integerList = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const indices: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return undefined;
    indices.push(entry);
  }
  return indices;
};

const applyPrefix = (
  state: GameState,
  indices: readonly number[],
): { readonly game: GameState; readonly moves: readonly Move[] } | undefined => {
  const offer = rules.legalMoves(state);
  const moves: Move[] = [];
  let at = state;
  for (const index of indices) {
    const mapped = index >= 0 ? offer[index] : undefined;
    // The offer numbers steps only. endTurn is a flag, not a row.
    if (mapped === undefined || mapped.kind !== 'step' || !legalNow(at, mapped)) return undefined;
    at = applyMove(at, mapped);
    moves.push(mapped);
  }
  return { game: at, moves };
};


