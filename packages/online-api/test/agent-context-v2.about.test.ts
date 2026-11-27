/**
 * docs/spec/agent-context-v2 D1 — the door reads one profile per bound user,
 * and none for a chair nobody is bound to (P108).
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 */

import { describe, expect, it } from 'vitest';
import type { ObjectStore } from '../src/api-types';
import { readOfferAbout } from '../src/agent-about';
import { gameLogKey, userProfileKey } from '../src/s3-keys';
import { aliceHash, carolHash } from './support';
import { agent, heuristicSeat, human } from './remote-agent-mcp.support';

const recordingStore = (data: ReadonlyMap<string, string>): { readonly store: ObjectStore; readonly reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    store: {
      get: (key) => {
        reads.push(key);
        return data.get(key);
      },
      put: () => undefined,
      delete: () => undefined,
      listPrefix: () => [],
    },
  };
};

describe('D1 — profile names, read once per bound user', () => {
  it('two chairs of one user and one of another: two profile reads, then the log; a heuristic chair reads nothing', async () => {
    const located = { groupHash: 'g', gameNumber: '000001' };
    const { store, reads } = recordingStore(new Map([[userProfileKey(carolHash()), JSON.stringify({ displayName: 'Gilad' })]]));
    const about = await readOfferAbout(
      store,
      located,
      [human(carolHash()), agent(carolHash()), heuristicSeat(), human(aliceHash())],
      1,
      carolHash(),
    );
    expect(reads).toEqual([userProfileKey(carolHash()), userProfileKey(aliceHash()), gameLogKey('g', '000001')]);
    expect(about.seats?.map((seat) => seat.name)).toEqual(['Gilad', "Gilad's agent", 'AI', 'Player D']);
    expect(about.recent).toEqual([]);
  });
});
