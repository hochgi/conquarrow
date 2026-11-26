/**
 * docs/spec/seat-labels — web side: the roster, the seat line, the parser,
 * the host seat option, the CSS and the wiring scans. The table itself is
 * tested in packages/contracts/test/seat-labels.*.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InviteSeat } from '@conquarrow/contracts';
import { parseSeats } from '../src/online-parse';
import { labelForSeat, rosterLabel, seatLineLabel } from '../src/seatLabel';
import { onlineTurnSeat, turnBannerCopy } from '../src/turnBanner';
import { eliminationSentence } from '../src/lostSeat';
import { standingsForHud } from '../src/standings';
import { committedDir } from './source-scan.support';

const here = committedDir(import.meta.url);
const src = (file: string): string => readFileSync(join(here, '../src', file), 'utf8');
/** Comments out, so a scan reads code only. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ME = 'alice-hash';

describe('The frozen roster labels every chair with the one table', () => {
  it('you, a named joiner, waiting and AI', () => {
    const seats: readonly InviteSeat[] = [
      { kind: 'human', userHash: ME, name: 'Alice' },
      { kind: 'human', userHash: 'bob', name: 'Bob' },
      { kind: 'human' },
      { kind: 'heuristic' },
    ];
    expect(seats.map((seat, index) => rosterLabel(seat, index, ME))).toEqual(['you', 'Bob', 'waiting', 'AI']);
  });

  it('my agent is "your agent", never "you" (old P93-a)', () => {
    expect(rosterLabel({ kind: 'agent', userHash: ME }, 1, ME)).toBe('your agent');
  });

  it('signed out: Player A, not you', () => {
    expect(rosterLabel({ kind: 'human', userHash: ME }, 0, undefined)).toBe('Player A');
  });
});

describe('The seat line uses the same labels', () => {
  const players = ['A', 'B', 'C'];
  const seats: readonly InviteSeat[] = [
    { kind: 'human', userHash: ME },
    { kind: 'agent', userHash: 'ada', name: 'Ada' },
    { kind: 'heuristic' },
  ];

  it('online: A=you · B=Ada’s agent · C=AI', () => {
    const labels = players.map((letter) =>
      labelForSeat({ letter, online: { players, seats, userHash: ME }, local: { configKind: undefined, logSeats: [] } }),
    );
    expect(labels).toEqual(['you', "Ada's agent", 'AI']);
  });

  it('online, no chairs yet: Player letters', () => {
    expect(labelForSeat({ letter: 'B', online: { players }, local: { configKind: undefined, logSeats: [] } })).toBe(
      'Player B',
    );
  });

  it('local with one human: you; local hot-seat: Player letters', () => {
    const one = [
      { player: 'A', kind: 'human' as const },
      { player: 'B', kind: 'heuristic' as const },
      { player: 'C', kind: 'byok' as const },
    ];
    expect(one.map((s) => labelForSeat({ letter: s.player, local: { configKind: s.kind, logSeats: one } }))).toEqual([
      'you',
      'AI',
      'AI',
    ]);
    const hot = [
      { player: 'A', kind: 'human' as const },
      { player: 'B', kind: 'human' as const },
      { player: 'C', kind: 'heuristic' as const },
    ];
    expect(hot.map((s) => labelForSeat({ letter: s.player, local: { configKind: s.kind, logSeats: hot } }))).toEqual([
      'Player A',
      'Player B',
      'AI',
    ]);
  });

  it('the seat line prints the letter already, so the fallback reads Player there', () => {
    const hot = [
      { player: 'A', kind: 'human' as const },
      { player: 'B', kind: 'human' as const },
      { player: 'C', kind: 'heuristic' as const },
    ];
    expect(hot.map((s) => seatLineLabel({ letter: s.player, local: { configKind: s.kind, logSeats: hot } }))).toEqual([
      'Player',
      'Player',
      'AI',
    ]);
    const chairs: readonly InviteSeat[] = [
      { kind: 'human', userHash: ME },
      { kind: 'human', userHash: 'bob', name: 'Bob' },
      { kind: 'human', userHash: 'cy' },
    ];
    expect(
      players.map((letter) =>
        seatLineLabel({ letter, online: { players, seats: chairs, userHash: ME }, local: { configKind: undefined, logSeats: [] } }),
      ),
    ).toEqual(['you', 'Bob', 'Player']);
  });
});

describe('The parser keeps names on human and agent chairs only', () => {
  it('name kept, label no longer read, heuristic stays bare', () => {
    expect(
      parseSeats([
        { kind: 'human', userHash: 'h', name: 'Hana' },
        { kind: 'agent', userHash: 'a', name: 'Ada', label: 'Agent (Ada)' },
        { kind: 'agent', label: 'Agent (Zed)' },
        { kind: 'heuristic', name: 'Bot' },
        { kind: 'human', name: '' },
        { kind: 'human', name: 7 },
      ]),
    ).toStrictEqual([
      { kind: 'human', userHash: 'h', name: 'Hana' },
      { kind: 'agent', userHash: 'a', name: 'Ada' },
      { kind: 'agent' },
      { kind: 'heuristic' },
      { kind: 'human' },
      { kind: 'human' },
    ]);
  });

  it('a name without a hash is kept on both kinds', () => {
    expect(parseSeats([{ kind: 'human', name: 'Hana' }, { kind: 'agent', name: 'Ada' }])).toStrictEqual([
      { kind: 'human', name: 'Hana' },
      { kind: 'agent', name: 'Ada' },
    ]);
  });
});

describe('The banner reads the owner from `name`, never a reserved word', () => {
  const base = {
    venue: 'online' as const,
    replaying: false,
    vsBot: false,
    pause: 'running' as const,
    botBusy: false,
    byokActive: false,
    phase: 'idle' as const,
    movableCount: 1,
    routeHint: '',
  };

  it("an agent chair's name feeds <name>'s agent is playing", () => {
    const seat = onlineTurnSeat({ players: ['A', 'B'], active: 'B', userHash: ME, seats: [{ kind: 'human', userHash: ME }, { kind: 'agent', userHash: 'ada', name: 'Ada' }] });
    expect(seat.ownerName).toBe('Ada');
    expect(turnBannerCopy({ ...base, ...seat }).suffix).toBe(" · Ada's agent is playing…");
  });

  it('a reserved name is no owner', () => {
    const seat = onlineTurnSeat({ players: ['A', 'B'], active: 'B', seats: [{ kind: 'human' }, { kind: 'agent', userHash: 'x', name: 'you' }] });
    expect(seat.ownerName).toBeUndefined();
    expect(turnBannerCopy({ ...base, ...seat }).suffix).toBe(" · B's agent is playing…");
  });
});

describe('"you" needs proof (EARS 10)', () => {
  it('another player named "you" is never you in standings or the toast', () => {
    const view = standingsForHud(
      true,
      {
        winner: 'A',
        turns: 3,
        standings: [
          { seat: 0, player: 'A', kind: 'human', territory: 1, shares: 1, heads: 1, lost: false },
          { seat: 1, player: 'B', kind: 'human', territory: 0, shares: 0, heads: 0, lost: true },
        ],
      },
      [
        { kind: 'human', userHash: ME },
        { kind: 'human', userHash: 'bob', name: 'you' },
      ],
      ME,
    );
    expect(view.kind === 'table' ? view.rows.map((row) => [row.label, row.you]) : view).toEqual([
      ['you', true],
      ['Player B', false],
    ]);
    expect(eliminationSentence('Player B')).toBe('Player B was eliminated');
  });
});

// P105's seat-A (2b) options are superseded by P106: see seat-choice.scenarios.test.ts.

describe('Wiring (source scans — no DOM harness)', () => {
  it('EARS 9: the select and the roster column share one width', () => {
    const css = src('styles.css');
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    for (const selector of ['.lobby-seat-head select', '.lobby-seat-occupancy']) {
      expect(rule(selector)).toMatch(/width:\s*var\(--seat-kind-width\)/);
      expect(rule(selector)).toMatch(/flex:\s*0 0 auto/);
    }
    expect(css).toMatch(/--seat-kind-width:\s*[\d.]+rem/);
    expect(rule('.lobby-seat-occupancy')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('the Lobby labels the roster with rosterLabel and picks seats with pickOnlineSeat (P106)', () => {
    const lobby = code(src('Lobby.tsx'));
    expect(lobby).toMatch(/rosterLabel\(seat, index, userHash\)/);
    expect(lobby).toMatch(/lobbyKindOptions\(onlineMode \? 'online' : 'local'\)/);
    expect(lobby).toMatch(/pickOnlineSeat\(plan, index, kind\)/);
    expect(lobby).not.toMatch(/\(you\)'/);
  });

  it('App builds the seat line with labelForSeat', () => {
    const app = code(src('App.tsx'));
    expect(app).toMatch(/kindLabel: seatLineLabel\(/);
    expect(app).not.toMatch(/displaySeatKind/);
  });

  it('the peek no longer forces an anonymous request', () => {
    expect(code(src('online-pages.ts'))).not.toMatch(/\/invites\/\$\{inviteToken\}`, \{ auth: false \}/);
  });

  it("EARS 1: no other web or server source words a chair (`'s agent`, `Agent (`)", () => {
    const roots = [join(here, '../src'), join(here, '../../online-api/src')];
    const files = roots.flatMap((root) =>
      (readdirSync(root, { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => join(root, f)),
    );
    // The banner's "is playing" sentence is cluster 03's wording; it reads its name through usableSeatName.
    // P106: online-shell-ui names the lobby choice `Agent (yours)` — a pick, not a chair's label.
    const allowed = new Set(['turnBanner.ts', 'online-shell-ui.ts']);
    const offenders = files.filter((file) => {
      const base = file.split(/[\\/]/).pop() ?? '';
      if (allowed.has(base)) return false;
      const text = code(readFileSync(file, 'utf8'));
      return /'s agent|Agent \(/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
