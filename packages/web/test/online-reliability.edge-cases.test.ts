/**
 * P95 web edge cases.
 *
 * @see docs/spec/online-reliability/online-reliability.web.edge-cases.feature
 */

import { describe, expect, it } from 'vitest';
import { REAUTH_LEAD_MS, SUBMIT_RETRY_MS } from '../src/online-pages';
import { submitNote } from '../src/online-submit';
import { mark, pass, snapshotScript, wake } from './online-move-log-replay.support';
import {
  heldPost,
  ifMatches,
  postRejected,
  postStatus,
  posted,
  postsOf,
} from './online-turn-flow.support';
import {
  ALICE,
  GAME_ONE,
  GROUP_HASH,
  gameHash,
  quotedVersion,
} from './online-web.support';
import {
  VERSION_PATH,
  myGamesScript,
  sequentialIds,
  showingWith,
  snapshotReadsOf,
  submitIdsOf,
  tokenExpiringAt,
  versionReads,
  versionScript,
} from './online-reliability.support';

const NOW = 1_800_000_000_000;

describe('online-reliability web edge cases', () => {
  it('A refusal is not retried', async () => {
    const h = await showingWith(4, [postStatus(409), snapshotScript(4)]);

    expect(await h.adapter.submitMoves([pass()])).toBe('stale');

    expect(postsOf(h)).toBe(1);
  });

  it('Retries are bounded', async () => {
    const h = await showingWith(
      4,
      [postRejected(), postRejected(), postRejected(), postRejected(), snapshotScript(4)],
      { newId: sequentialIds() },
    );

    expect(await h.adapter.submitMoves([pass()])).toBe('failed');

    expect(submitIdsOf(h)).toEqual(['id-1', 'id-1', 'id-1']);
  });

  it('A 403 is reported as not your seat', async () => {
    const h = await showingWith(4, [postStatus(403), snapshotScript(4)]);

    expect(await h.adapter.submitMoves([pass()])).toBe('forbidden');

    expect(submitNote('forbidden')).toMatch(/not yours/);
    expect(postsOf(h)).toBe(1);
  });

  it('A held submit is dropped on sign-out', async () => {
    const h = await showingWith(4, [postStatus(401)]);
    expect(await h.adapter.submitMoves([pass()])).toBe('unauthorized');
    expect(h.adapter.submitPending()).toBe(true);

    h.adapter.signOut();

    expect(h.adapter.submitPending()).toBe(false);
  });

  it('The poll sends nothing while a submit is in flight', async () => {
    const held = heldPost();
    const h = await showingWith(4, [held.script, versionScript(5), snapshotScript(5)]);
    const submit = h.adapter.submitMoves([pass()]);

    await h.adapter.poll();

    expect(versionReads(h)).toBe(0);
    held.answer(5);
    await submit;
  });

  it('The poll at the displayed version does nothing more', async () => {
    const h = await showingWith(4, [versionScript(4)]);
    const reads = snapshotReadsOf(h);

    await h.adapter.poll();

    expect(versionReads(h)).toBe(1);
    expect(snapshotReadsOf(h)).toBe(reads);
  });

  it('A token near expiry prompts once', async () => {
    const h = await showingWith(
      4,
      [snapshotScript(4), snapshotScript(4), myGamesScript(), myGamesScript()],
      { now: () => NOW },
      tokenExpiringAt(NOW + 2 * 60 * 1000),
    );
    const before = h.gis.promptCount;

    await h.adapter.becomeVisible();
    await h.adapter.becomeVisible();

    expect(h.gis.promptCount - before).toBe(1);
  });

  it('The heartbeat pings an open socket', () => {
    return showingWith(4, []).then((h) => {
      h.adapter.heartbeat();

      expect(h.sockets[0]?.sent).toEqual(['{"action":"ping"}']);
    });
  });

  it('A wake during a submit is left to the reconcile', async () => {
    const held = heldPost();
    const h = await showingWith(4, [held.script, snapshotScript(5), snapshotScript(5)]);
    const reads = snapshotReadsOf(h);
    const submit = h.adapter.submitMoves([pass()]);

    await h.adapter.receiveStateChanged(wake(5));

    expect(snapshotReadsOf(h)).toBe(reads);
    held.answer(5);
    await submit;
  });

  describe('Pins from the P95 mutation review', () => {
    it('Retries wait longer each time', async () => {
      const waits: number[] = [];
      const h = await showingWith(
        4,
        [postRejected(), postRejected(), postRejected(), snapshotScript(4)],
        {
          wait: (ms) => {
            waits.push(ms);
            return Promise.resolve();
          },
        },
      );

      await h.adapter.submitMoves([pass()]);

      expect(waits).toEqual([SUBMIT_RETRY_MS, 2 * SUBMIT_RETRY_MS]);
    });

    it('A held submit resends only what the 401 stopped, from the version it reached', async () => {
      const h = await showingWith(
        4,
        [posted(5), postStatus(401), posted(6), snapshotScript(6), snapshotScript(6)],
        { newId: sequentialIds() },
      );

      expect(await h.adapter.submitMoves([mark('a'), mark('b')])).toBe('unauthorized');
      await h.adapter.deliverGoogleCredential(ALICE.bearer);

      expect(submitIdsOf(h)).toEqual(['id-1', 'id-2', 'id-2']);
      expect(ifMatches(h)).toEqual([quotedVersion(4), quotedVersion(5), quotedVersion(5)]);
      expect(h.adapter.submitPending()).toBe(false);
    });

    it('A credential that arrives on another route drops the held submit', async () => {
      const h = await showingWith(4, [postStatus(401)]);
      await h.adapter.submitMoves([pass()]);
      h.location.hash = '';

      await h.adapter.deliverGoogleCredential(ALICE.bearer);

      expect(postsOf(h)).toBe(1);
      expect(h.adapter.submitPending()).toBe(false);
    });

    it('Opening another game drops the held submit; reopening its own keeps it', async () => {
      const h = await showingWith(4, [postStatus(401), snapshotScript(4)]);
      await h.adapter.submitMoves([pass()]);

      await h.adapter.openMyGame(GROUP_HASH, GAME_ONE);
      expect(h.adapter.submitPending()).toBe(true);

      await h.adapter.openMyGame(GROUP_HASH, '000002');
      expect(h.adapter.submitPending()).toBe(false);
    });

    it('A token far from expiry is not refreshed', async () => {
      const h = await showingWith(
        4,
        [snapshotScript(4), myGamesScript()],
        { now: () => NOW },
        tokenExpiringAt(NOW + 60 * 60 * 1000),
      );
      const before = h.gis.promptCount;

      await h.adapter.becomeVisible();

      expect(h.gis.promptCount).toBe(before);
    });

    it('A token exactly the lead away from expiry is refreshed', async () => {
      const h = await showingWith(
        4,
        [snapshotScript(4), myGamesScript()],
        { now: () => NOW },
        tokenExpiringAt(NOW + REAUTH_LEAD_MS),
      );
      const before = h.gis.promptCount;

      await h.adapter.becomeVisible();

      expect(h.gis.promptCount - before).toBe(1);
    });

    it('A token with no readable expiry is not refreshed', async () => {
      const h = await showingWith(
        4,
        [snapshotScript(4), myGamesScript()],
        { now: () => NOW },
        'not-a-jwt',
      );
      const before = h.gis.promptCount;

      await h.adapter.becomeVisible();

      expect(h.gis.promptCount).toBe(before);
    });

    it('The poll and resume keep an open socket', async () => {
      const h = await showingWith(4, [versionScript(4), snapshotScript(4)]);

      await h.adapter.poll();
      await h.adapter.becomeVisible();

      expect(h.sockets).toHaveLength(1);
    });

    it('A late close of a replaced socket does not forget the new one', async () => {
      const h = await showingWith(4, [snapshotScript(4)]);
      await h.adapter.deliverGoogleCredential(ALICE.bearer);
      expect(h.sockets).toHaveLength(2);

      h.sockets[0]?.drop();
      h.adapter.heartbeat();

      expect(h.sockets[1]?.sent).toEqual(['{"action":"ping"}']);
    });

    it('The heartbeat with no socket sends nothing', async () => {
      const h = await showingWith(4, []);
      h.sockets[0]?.drop();

      h.adapter.heartbeat();

      expect(h.sockets[0]?.sent).toEqual([]);
    });

    it('The poll does nothing while a submit is held', async () => {
      const h = await showingWith(4, [postStatus(401), versionScript(6)]);
      await h.adapter.submitMoves([pass()]);

      await h.adapter.poll();

      expect(versionReads(h)).toBe(0);
    });

    it('The poll does nothing when the version read fails or says nothing', async () => {
      const h = await showingWith(4, [
        { method: 'GET', path: VERSION_PATH, status: 500, body: { version: 9 } },
        { method: 'GET', path: VERSION_PATH, status: 200, body: { version: 'nine' } },
      ]);
      const reads = snapshotReadsOf(h);

      await h.adapter.poll();
      await h.adapter.poll();

      expect(versionReads(h)).toBe(2);
      expect(snapshotReadsOf(h)).toBe(reads);
    });

    it('The poll does nothing signed out', async () => {
      const h = await showingWith(4, [versionScript(6)]);
      h.adapter.signOut();
      h.location.hash = gameHash(GROUP_HASH, GAME_ONE);

      await h.adapter.poll();

      expect(versionReads(h)).toBe(0);
    });
  });
});
