/**
 * Identity leaves at their exported functions: `requireUserHash` (auth.ts) and
 * the per-user profile overlay `readProfileDisplayName` (user-profile.ts, P46).
 *
 * Characterisation of shipped behaviour — the handler suites reach these only
 * through well-formed fixtures, so the guards on a persisted profile that is
 * not the expected shape had no test.
 */

import { describe, expect, it } from 'vitest';
import type { GoogleVerifier, GoogleVerifyResult } from '../src/api-types';
import { requireUserHash } from '../src/auth';
import { readProfileDisplayName } from '../src/user-profile';
import { ALICE, mapStore, userHashOf } from './support';

const verifierAnswering = (result: GoogleVerifyResult): GoogleVerifier => ({
  verify: () => result,
});

const profileKey = (userHash: string): string => `conquarrow/users/${userHash}/profile.json`;

describe('online-identity — edge cases', () => {
  describe('requireUserHash', () => {
    it('omits displayName entirely when the verifier yields none', async () => {
      const auth = await requireUserHash(verifierAnswering({ ok: true, sub: ALICE.sub }), 'x');

      expect(auth).toStrictEqual({ ok: true, userHash: userHashOf(ALICE.sub) });
    });
  });

  describe('readProfileDisplayName', () => {
    const userHash = userHashOf(ALICE.sub);

    it.each([
      ['JSON null', 'null'],
      ['a displayName that is not a string', '{"displayName":42}'],
    ])('reads a profile holding %s as no name', async (_label, body) => {
      const s3 = mapStore(new Map([[profileKey(userHash), body]]));

      expect(await readProfileDisplayName(s3, userHash)).toBeUndefined();
    });
  });
});
