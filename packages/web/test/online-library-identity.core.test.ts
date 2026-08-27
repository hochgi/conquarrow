/**
 * docs/spec/online-library-identity/online-library-identity.core.feature — shell.
 *
 * @see docs/spec/online-library-identity/online-library-identity.md
 */

import { describe, expect, it } from 'vitest';
import type { LibrarySeat } from '@conquarrow/contracts';
import { libraryVsLine } from '@conquarrow/contracts';
import { styleFor } from '../src/colors';
import {
  formatLibraryRow,
  formatLibraryStartedAt,
  libraryRowTint,
} from '../src/online-shell-ui';
import { seatPlayerId } from '../src/seatPlan';
import { GAME_ONE } from './online-web.support';

const STARTED_AT = '2026-08-27T09:10:00.000Z';

const shalevAiSeats: readonly LibrarySeat[] = [
  { kind: 'human', label: 'Gilad', you: true },
  { kind: 'human', label: 'Shalev', you: false },
  { kind: 'heuristic', label: 'AI', you: false },
];

describe('Colour and time', () => {
  it("Caller's seatIndex is their chair", () => {
    expect(libraryRowTint(1)).toBe(styleFor(seatPlayerId(1)).fill);
  });

  it('Start stamps startedAt onto game meta', () => {
    expect(formatLibraryStartedAt(STARTED_AT)).toBe('27 Aug 2026, 09:10 UTC');
  });
});

describe('Shell first line stays status and game number', () => {
  it('formatLibraryRow stays P45 copy and libraryVsLine is the second line', () => {
    expect(formatLibraryRow('waiting', GAME_ONE)).toBe('Open (waiting) · 000001');
    expect(libraryVsLine(shalevAiSeats)).toBe('Shalev · AI');
  });
});
