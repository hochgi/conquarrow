/**
 * docs/spec/match-log-v2/match-log-v2.md E6 — the web animates with the shared
 * resolver from `@conquarrow/rules-core` and keeps no copy of it (P107 D1).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveEvents as shared } from '@conquarrow/rules-core';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');

describe('E6 — one resolver', () => {
  it('the web has no fx/events.ts, and present.ts / conversionPlayback.ts import resolveEvents from rules-core', () => {
    expect(existsSync(join(src, 'fx/events.ts'))).toBe(false);
    for (const file of ['fx/present.ts', 'conversionPlayback.ts']) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).toMatch(/import \{ resolveEvents \} from '@conquarrow\/rules-core';/);
      expect(text, file).not.toMatch(/const resolveEvents\b|function resolveEvents\b/);
    }
    expect(typeof shared).toBe('function');
  });
});
