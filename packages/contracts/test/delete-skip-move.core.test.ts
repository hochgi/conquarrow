/**
 * docs/spec/delete-skip-move/delete-skip-move.core.feature — P51.
 *
 * The move vocabulary half of the packet. One it() per Gherkin scenario.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md
 */

import { describe, expect, it } from 'vitest';
import { MOVE_KINDS } from '../src/index';

describe('The move vocabulary has no skip', () => {
  it('The move kinds are step and end turn', () => {
    expect([...MOVE_KINDS]).toEqual(['step', 'endTurn']);
  });
});
