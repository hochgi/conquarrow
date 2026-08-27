const ROOT = 'conquarrow';

export const inviteKey = (token: string): string => `${ROOT}/invites/${token}.json`;

export const lobbyKey = (userHash: string, token: string): string =>
  `${ROOT}/users/${userHash}/lobbies/${token}`;

export const lobbyPrefix = (userHash: string): string =>
  `${ROOT}/users/${userHash}/lobbies/`;

export const userGroupKey = (userHash: string, groupHash: string): string =>
  `${ROOT}/users/${userHash}/groups/${groupHash}`;

export const userGroupPrefix = (userHash: string): string =>
  `${ROOT}/users/${userHash}/groups/`;

export const userProfileKey = (userHash: string): string =>
  `${ROOT}/users/${userHash}/profile.json`;

export const groupMetaKey = (groupHash: string): string =>
  `${ROOT}/groups/${groupHash}/meta.json`;

export const gameMetaKey = (groupHash: string, gameNumber: string): string =>
  `${ROOT}/groups/${groupHash}/games/${gameNumber}/meta.json`;

export const gameStateKey = (groupHash: string, gameNumber: string): string =>
  `${ROOT}/groups/${groupHash}/games/${gameNumber}/state.json`;

export const gameLogKey = (groupHash: string, gameNumber: string): string =>
  `${ROOT}/groups/${groupHash}/games/${gameNumber}/log.jsonl`;

export const gamesPrefix = (groupHash: string): string =>
  `${ROOT}/groups/${groupHash}/games/`;

export const connectionKey = (userHash: string, connectionId: string): string =>
  `${ROOT}/connections/${userHash}/${connectionId}`;

export const connectionsPrefix = (userHash: string): string =>
  `${ROOT}/connections/${userHash}/`;

export const connectionIdKey = (connectionId: string): string =>
  `${ROOT}/connection-ids/${connectionId}`;
