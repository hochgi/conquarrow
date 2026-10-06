/**
 * Small online-api primitives at their exported functions: the total string
 * order every listing sorts by (hashing.ts), the store-error classifier the
 * handlers' retry loops branch on (api-types.ts), and the 410 body (json-result.ts).
 *
 * Characterisation of shipped behaviour; plain Vitest, no I/O.
 */

import { describe, expect, it } from 'vitest';
import { PreconditionFailed, isPreconditionFailed } from '../src/api-types';
import { compareStrings } from '../src/hashing';
import { gone } from '../src/json-result';
import { parseBody } from './support';

describe('online-primitives — core', () => {
  describe('compareStrings is a total order', () => {
    it.each([
      ['a', 'b', -1],
      ['b', 'a', 1],
      ['a', 'a', 0],
    ] as const)('compareStrings(%s, %s) is %d', (left, right, expected) => {
      expect(compareStrings(left, right)).toBe(expected);
    });
  });

  describe('isPreconditionFailed', () => {
    it.each([
      ['a PreconditionFailed', new PreconditionFailed(), true],
      ['an error named PreconditionFailed from another module copy', { name: 'PreconditionFailed' }, true],
      ['any other error', new Error('boom'), false],
      ['null', null, false],
      ['undefined', undefined, false],
    ] as const)('classifies %s as %s', (_label, error, expected) => {
      expect(isPreconditionFailed(error)).toBe(expected);
    });
  });

  describe('gone', () => {
    it('a started invite without game ids answers the reason alone', () => {
      const result = gone('started');

      expect(result.statusCode).toBe(410);
      expect(parseBody(result)).toStrictEqual({ reason: 'started' });
    });
  });
});
