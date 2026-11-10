/**
 * Pure BYOK offer text and reply parser (P92).
 *
 * No React, no fetch, no clock, no Math.random. The web seat's HTTP call to a
 * model stays in web. These stubs compile the suite; they do not build a prompt.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 */

import type { GameState, PlayerId } from '@conquarrow/contracts';

/** A parsed reply. Indices are offer rows, not moves the parser applied. */
export interface ParsedReply {
  readonly moves: readonly number[];
  readonly endTurn: boolean;
  readonly why?: string;
  readonly plan?: string;
}

/**
 * The web seat installs this with the real builder. One function, no second copy.
 * A caller that has not loaded that builder gets a throw, not a different prompt.
 */
let renderOffer: ((state: GameState, seat: PlayerId) => string) | undefined;

export const installOfferRenderer = (render: (state: GameState, seat: PlayerId) => string): void => {
  renderOffer = render;
};

/**
 * User prompt for `state` and `seat`: numbered rows and the reply instruction.
 * Fresh target locks, no plan echo. The installed renderer is `buildUserPrompt`.
 */
export const offerText = (state: GameState, seat: PlayerId): string => {
  if (renderOffer === undefined) throw new Error('not implemented');
  return renderOffer(state, seat);
};

const integerIndices = (moves: unknown): number[] | undefined => {
  if (!Array.isArray(moves)) return undefined;
  const indices: number[] = [];
  for (const entry of moves) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return undefined;
    indices.push(entry);
  }
  return indices;
};

/** Parse a model reply. Does not apply it. */
export const parseReply = (text: string): ParsedReply | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec['endTurn'] !== 'boolean') return undefined;
  const moves = integerIndices(rec['moves']);
  if (moves === undefined) return undefined;
  const why = typeof rec['why'] === 'string' ? rec['why'] : undefined;
  const plan = typeof rec['plan'] === 'string' ? rec['plan'] : undefined;
  return {
    moves,
    endTurn: rec['endTurn'],
    ...(why === undefined ? {} : { why }),
    ...(plan === undefined ? {} : { plan }),
  };
};
