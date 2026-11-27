/**
 * docs/spec/agent-context-v2 — the builder's about blocks (D1–D3, D6, D7) and
 * SCENARIOS.md 5.
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 * @see docs/spec/agent-context-v2/agent-context-v2.core.feature
 */

import { describe, expect, it } from 'vitest';
import type { LogEvent, PlayerId } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import {
  BATCH_RULE,
  buildUserPrompt,
  clearByokPlans,
  eventText,
  offerText,
  recentWindow,
} from '../src/index';
import { geometry, rules } from './agent-board-map.support';
import { SEAT_BLOCK, line, pass, seatBTurn, seats3, step } from './agent-context-v2.support';

const a1 = 'tiling:a:1,0,0';
const a2 = 'tiling:a:2,0,0';

describe('SCENARIOS.md 5 — opt about.seats: the seat table', () => {
  it('lists every seat in turn order with kind, name and relation, after the first line', () => {
    const { state, b } = seatBTurn();
    const text = offerText(state, b, { seats: seats3 });
    const lines = text.split('\n');
    expect(lines.slice(1, 5).join('\n')).toBe(SEAT_BLOCK);
  });

  it('no seats: no table', () => {
    const { state, b } = seatBTurn();
    expect(offerText(state, b, {})).not.toContain('Seats in turn order');
    expect(offerText(state, b)).not.toContain('Seats in turn order');
  });

  it('"also you" is printed like the other relations', () => {
    const { state, b } = seatBTurn();
    const text = offerText(state, b, {
      seats: [...seats3.slice(0, 2), { player: 'C', kind: 'agent', name: "Gilad's agent", relation: 'also you' }],
    });
    expect(text).toContain("\nC agent Gilad's agent (also you)\n");
  });
});

describe('SCENARIOS.md 5 — the starvation line, from the state', () => {
  it('states dominationN and every streak in turn order, with or without about', () => {
    const { state, b } = seatBTurn();
    const [pa, pb, pc] = state.players as [PlayerId, PlayerId, PlayerId];
    const odd = { ...state, dominationN: 7, starvationStreaks: new Map([[pb, 2], [pc, 4]]) };
    const expected = `Starvation: a living seat with no spawner share loses after dominationN=7 full rounds in a row. Streaks: ${String(pa)} 0, ${String(pb)} 2, ${String(pc)} 4.`;
    expect(offerText(odd, b).split('\n')).toContain(expected);
    expect(offerText(odd, b, { seats: seats3 }).split('\n')).toContain(expected);
  });
});

describe('SCENARIOS.md 5 — the window: recentWindow', () => {
  const runs = [
    line('A', step(a1, a2)),
    pass('A', 'B'),
    line('B', step(a1, a2)),
    line('B', step(a1, a2)),
    pass('B', 'C'),
    pass('C', 'A'),
    line('A', step(a1, a2)),
    pass('A', 'B'),
  ];

  it('starts at the seat\'s last completed run and runs to the end', () => {
    expect(recentWindow(runs, 'B')).toEqual(runs.slice(2));
  });

  it('mid-turn: still starts at the last completed run, and ends with this turn\'s steps', () => {
    const mid = [...runs, line('B', step(a1, a2))];
    expect(recentWindow(mid, 'B')).toEqual(mid.slice(2));
  });

  it('the last completed run wins over an earlier one', () => {
    const twice = [...runs, line('B', step(a1, a2)), pass('B', 'C'), pass('C', 'A')];
    expect(recentWindow(twice, 'B')).toEqual(twice.slice(8));
  });

  it('first turn (no completed run of the seat): every line', () => {
    expect(recentWindow(runs.slice(0, 2), 'B')).toEqual(runs.slice(0, 2));
    expect(recentWindow(runs, 'D')).toEqual(runs);
  });

  it('an unfinished run of the seat is not a completed one', () => {
    const unfinished = [line('A', step(a1, a2)), pass('A', 'B'), line('B', step(a1, a2))];
    expect(recentWindow(unfinished, 'B')).toEqual(unfinished);
  });
});

describe('SCENARIOS.md 5 — the history block', () => {
  const combat: LogEvent = {
    kind: 'combat',
    arrow: a2,
    attacker: 'C',
    defender: 'B',
    attackerSent: 3,
    defenderBefore: 2,
    attackerLost: 1,
    defenderLost: 2,
    holder: 'C',
  };
  const cut: LogEvent = { kind: 'trailCut', victim: 'C', attacker: 'B', cutArrow: a2, arrowCount: 4 };

  it('alt recent given: one line per run, oldest first, turnPassed not printed', () => {
    const { state, b } = seatBTurn();
    const me = String(b);
    const other = me === 'C' ? 'A' : 'C';
    const recent = [
      line(me, step(a1, a2), [cut]),
      line(me, step(a1, a2)),
      pass(me, other),
      line(other, step(a1, a2), [combat]),
      pass(other, me),
    ];
    const text = offerText(state, b, { recent });
    const block = [
      `Since your last turn (oldest first; ${me} is you):`,
      `${me}, 2 steps: B cut C's trail at ${a2} (4 arrows)`,
      `${other}, 1 steps: combat at ${a2}: C sent 3 vs B 2, C lost 1, B lost 2, C holds`,
    ].join('\n');
    expect(text).toContain(block);
  });

  it('alt window empty: says nothing recorded yet', () => {
    const { state, b } = seatBTurn();
    expect(offerText(state, b, { recent: [] }).split('\n')).toContain('Since your last turn: nothing recorded yet.');
  });

  it('alt recent undefined: no history block', () => {
    const { state, b } = seatBTurn();
    expect(offerText(state, b, { seats: seats3 })).not.toContain('Since your last turn');
  });

  it('a run with no printable event reads nothing', () => {
    const { state, b } = seatBTurn();
    const text = offerText(state, b, { recent: [pass('A', 'B')] });
    expect(text.split('\n')).toContain('A, 0 steps: nothing');
  });

  it('a run with more than 12 printable events prints 12, then … +k more', () => {
    const { state, b } = seatBTurn();
    const shares = Array.from({ length: 15 }, (_, i): LogEvent => ({ kind: 'sharesChanged', player: 'A', from: i, to: i + 1 }));
    const text = offerText(state, b, { recent: [line('A', step(a1, a2), shares)] });
    const row = text.split('\n').find((l) => l.startsWith('A, 1 steps: '));
    const printed = shares.slice(0, 12).map((e) => eventText(e)).join('; ');
    expect(row).toBe(`A, 1 steps: ${printed}; … +3 more`);
  });

  it('exactly 12 printable events: no more-clause', () => {
    const { state, b } = seatBTurn();
    const shares = Array.from({ length: 12 }, (_, i): LogEvent => ({ kind: 'sharesChanged', player: 'A', from: i, to: i + 1 }));
    const text = offerText(state, b, { recent: [line('A', step(a1, a2), shares)] });
    expect(text).not.toContain('more');
  });

  it('the history block follows the threat line and comes before STATE_JSON', () => {
    const { state, b } = seatBTurn();
    const text = offerText(state, b, { recent: [] });
    const threat = text.indexOf('\nLead: ');
    const history = text.indexOf('\nSince your last turn');
    expect(threat).toBeGreaterThan(0);
    expect(history).toBeGreaterThan(threat);
    expect(history).toBeLessThan(text.indexOf('\nSTATE_JSON:'));
  });
});

describe('SCENARIOS.md 5 — eventText, every log event', () => {
  it.each<[LogEvent, string | null]>([
    [{ kind: 'combat', arrow: 'x', attacker: 'A', defender: 'B', attackerSent: 3, defenderBefore: 3, attackerLost: 3, defenderLost: 3 }, 'combat at x: A sent 3 vs B 3, A lost 3, B lost 3, nobody holds'],
    [{ kind: 'trailCut', victim: 'C', attacker: 'B', arrowCount: 2 }, "B cut C's trail (2 arrows)"],
    [{ kind: 'enclosureClosed', player: 'A', closingArrow: 'x', boundaryCount: 5, claimedCount: 6 }, 'A closed a loop at x (6 claimed)'],
    [{ kind: 'enclosureClosed', player: 'A', boundaryCount: 5, claimedCount: 6 }, 'A closed a loop (6 claimed)'],
    [{ kind: 'territoryCaptured', player: 'A', arrowCount: 4, takenFrom: ['B', 'C'] }, 'A took 4 territory from B, C'],
    [{ kind: 'territoryLost', player: 'B', to: 'A', arrowCount: 4 }, 'B lost 4 territory to A'],
    [{ kind: 'territoryLost', player: 'B', arrowCount: 4 }, 'B lost 4 territory'],
    [{ kind: 'unitsConverted', arrow: 'x', from: 'B', to: 'A', heads: 2 }, '2 heads at x converted B→A'],
    [{ kind: 'unitsProduced', player: 'A', arrow: 'x', amount: 1 }, 'A +1 heads at x (spawner)'],
    [{ kind: 'seatVanished', player: 'C', arrowCount: 0 }, 'C is out'],
    [{ kind: 'sharesChanged', player: 'A', from: 2, to: 3 }, 'A shares 2→3'],
    [{ kind: 'matchWon', player: 'A' }, 'A won'],
    [{ kind: 'turnPassed', from: 'A', to: 'B' }, null],
  ])('%j', (event, text) => {
    expect(eventText(event)).toBe(text);
  });
});

describe('D6 — the batch rule is stated before the reply instruction', () => {
  it('the offer carries BATCH_RULE on the line before the reply instruction', () => {
    const { state, b } = seatBTurn();
    const lines = offerText(state, b).split('\n');
    expect(BATCH_RULE).toBe(
      'Batch rule: every index refers to this offer, so move each stack at most once per reply. A stack\'s rows here describe it before it moves; walk it further from the next offer. A step that is no longer legal when it is reached spoils the reply.',
    );
    expect(lines.at(-2)).toBe(BATCH_RULE);
    expect(lines.at(-1)).toMatch(/^Reply with only JSON/);
  });
});

describe('D7 / E6 — one builder, one text', () => {
  it('buildUserPrompt (no plan, no locks) equals offerText for the same about', () => {
    clearByokPlans();
    const { state, b } = seatBTurn();
    const about = { seats: seats3, recent: [pass('A', String(b))] };
    expect(buildUserPrompt(geometry, state, b, rules.legalMoves(state), false, rules, [], about)).toBe(
      offerText(state, b, about),
    );
    expect(buildUserPrompt(geometry, state, b, rules.legalMoves(state), false, rules, [])).toBe(offerText(state, b));
    expect(endTurn().kind).toBe('endTurn');
  });
});
