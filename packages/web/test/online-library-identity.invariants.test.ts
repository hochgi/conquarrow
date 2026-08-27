/**
 * EARS invariants for docs/spec/online-library-identity/online-library-identity.md — shell.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LibrarySeat } from '@conquarrow/contracts';
import { libraryVsLine } from '@conquarrow/contracts';
import { styleFor } from '../src/colors';
import { formatLibraryStartedAt, libraryRowTint } from '../src/online-shell-ui';
import { seatPlayerId } from '../src/seatPlan';

const here = dirname(fileURLToPath(import.meta.url));
const lobbySrc = readFileSync(join(here, '../src/Lobby.tsx'), 'utf8');
const cssSrc = readFileSync(join(here, '../src/styles.css'), 'utf8');

const STARTED_AT = '2026-08-27T09:10:00.000Z';

describe('online-library-identity shell invariants', () => {
  it("The vs-line shall list every chair except the caller's, in seat order", () => {
    const cases: readonly {
      readonly seats: readonly LibrarySeat[];
      readonly line: string;
    }[] = [
      {
        seats: [
          { kind: 'human', label: 'Gilad', you: true },
          { kind: 'human', label: 'Shalev', you: false },
          { kind: 'heuristic', label: 'AI', you: false },
        ],
        line: 'Shalev · AI',
      },
      {
        seats: [
          { kind: 'heuristic', label: 'AI', you: false },
          { kind: 'human', label: 'Gilad', you: true },
          { kind: 'human', label: 'Dana', you: false },
        ],
        line: 'AI · Dana',
      },
      {
        seats: [{ kind: 'human', label: 'Gilad', you: true }],
        line: '',
      },
      {
        seats: [
          { kind: 'human', label: 'Player A', you: false },
          { kind: 'human', label: 'Player B', you: true },
          { kind: 'heuristic', label: 'AI', you: false },
        ],
        line: 'Player A · AI',
      },
    ];
    for (const { seats, line } of cases) {
      expect(libraryVsLine(seats), line).toBe(line);
    }
  });

  it("The shell shall tint a library row from the caller's seatIndex board colour and shall not use that colour as the button's entire fill", () => {
    for (let index = 0; index < 6; index += 1) {
      expect(libraryRowTint(index), String(index)).toBe(styleFor(seatPlayerId(index)).fill);
    }
    expect(libraryRowTint(1)).not.toBe('');
    expect(lobbySrc).toContain('libraryVsLine');
    expect(lobbySrc).toContain('formatLibraryStartedAt');
    expect(lobbySrc).toContain('borderLeftColor');
    expect(lobbySrc).toContain('lobby-game-vs');
    expect(lobbySrc).toContain('lobby-game-started');
    expect(lobbySrc).toContain('lobby-game-swatch');
    expect(lobbySrc).not.toMatch(/background(?:Color)?\s*:\s*tint/);
    expect(cssSrc).toMatch(/\.lobby-game-open\s*\{[^}]*border-left-width/);
    expect(cssSrc).toMatch(/\.lobby-game-open\s*\{[^}]*background:\s*transparent/);
    expect(cssSrc).toMatch(/\.lobby-game-swatch\.ai\s*\{[^}]*opacity/);
    expect(cssSrc).toMatch(/\.lobby-game-swatch\.you\s*\{[^}]*box-shadow/);
  });

  it('formatLibraryStartedAt shall render UTC, not the operator\'s local timezone', () => {
    expect(formatLibraryStartedAt(STARTED_AT)).toBe('27 Aug 2026, 09:10 UTC');
    expect(formatLibraryStartedAt(undefined)).toBeUndefined();
  });
});
