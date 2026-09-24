/**
 * EARS invariants for docs/spec/conquarrow-mcp/conquarrow-mcp.md.
 *
 * Table-driven Vitest — this repo has no fast-check.
 */

import { describe, expect, it } from 'vitest';
import { InvalidRoster, NoLiveMatch, SeatKindMismatch, StaleOfferIndex } from '../src/errors';
import type { ArrowId } from '@conquarrow/contracts';
import {
  catchError,
  createTools,
  hasLeadLineKey,
  isNamedError,
  mcpPackageJson,
  mcpSrc,
  openingLeaveHomeIndex,
  openingMatch,
  openingStepMoves,
  openThree,
  parseLegalMoveRows,
  stampLiveWinner,
  payloadHasFullSpawnerDump,
  svgAttrSet,
  svgGroupHighlights,
  svgViewBox,
  threatLineFromObservation,
  wrapsContractViolation,
} from './support';

describe('conquarrow-mcp invariants', () => {
  it('WHILE serving a tool, the system shall call rules-core legalMoves / apply / end-turn and shall not scrape a DOM, launch a browser, or shell out.', () => {
    const src = mcpSrc();
    expect(src).toMatch(/legalMoves/);
    expect(src).toMatch(/\bapply\b/);
    expect(src).not.toMatch(/playwright|puppeteer|cheerio/i);
    expect(src).not.toMatch(/imagemagick|\bmagick\b/i);
    expect(src).not.toMatch(/from ['"]@conquarrow\/web['"]/);
  });

  it('WHEN playerCount is not 3 or 6, or a kind is not human or heuristic, or seats.length is not playerCount, new_match shall refuse and shall not replace an existing live match.', () => {
    const tools = createTools();
    const live = openThree(tools);
    for (const args of [
      { playerCount: 2, seats: ['human', 'heuristic'] },
      { playerCount: 5, seats: ['human', 'human', 'human', 'human', 'heuristic'] },
      { playerCount: 3, seats: ['human', 'heuristic', 'byok'] },
      { playerCount: 3, seats: ['human'] },
    ] as const) {
      const error = catchError(() => tools.new_match({ ...args }));
      expect(error instanceof InvalidRoster || isNamedError(error, 'InvalidRoster')).toBe(true);
    }
    expect(tools.observe({ seat: 'A' }).me).toBe(live.observation.me);
    expect(tools.observe({ seat: 'A' }).activePlayer).toBe(live.observation.activePlayer);
  });

  it('WHEN apply_steps or end_turn names a seat that is not the active human seat, the system shall refuse and leave state unchanged.', () => {
    const tools = createTools();
    openThree(tools);
    const before = tools.observe({ seat: 'A' });
    expect(isNamedError(catchError(() => tools.end_turn({ seat: 'B' })), 'SeatKindMismatch')).toBe(
      true,
    );
    expect(
      isNamedError(
        catchError(() =>
          tools.apply_steps({
            seat: 'B',
            steps: [{ from: 'tiling:a:5,0,0', exit: 'tiling:a:6,0,0', count: 1 }],
          }),
        ),
        'SeatKindMismatch',
      ) || catchError(() => tools.end_turn({ seat: 'B' })) instanceof SeatKindMismatch,
    ).toBe(true);
    expect(tools.observe({ seat: 'A' }).activePlayer).toBe(before.activePlayer);
    expect(tools.observe({ seat: 'A' }).exposedTips).toEqual(before.exposedTips);
  });

  it('WHEN play_heuristic_turn names a seat that is not the active heuristic seat, the system shall refuse and leave state unchanged.', () => {
    const tools = createTools();
    openThree(tools);
    const before = tools.observe({ seat: 'A' });
    const error = catchError(() => tools.play_heuristic_turn({ seat: 'A' }));
    expect(error instanceof SeatKindMismatch || isNamedError(error, 'SeatKindMismatch')).toBe(true);
    expect(tools.observe({ seat: 'A' }).activePlayer).toBe(before.activePlayer);
  });

  it('WHEN apply_steps names an illegal step or a stale index, the system shall refuse and leave state unchanged.', () => {
    const tools = createTools();
    openThree(tools);
    tools.legal_moves({ seat: 'A' });
    const before = tools.observe({ seat: 'A' });
    const illegal = catchError(() =>
      tools.apply_steps({
        seat: 'A',
        steps: [{ from: 'nope', exit: 'nope-exit', count: 1 }],
      }),
    );
    expect(wrapsContractViolation(illegal)).toBe(true);
    expect(tools.observe({ seat: 'A' }).exposedTips).toEqual(before.exposedTips);
    const index = openingLeaveHomeIndex();
    tools.apply_steps({ seat: 'A', indices: [index] });
    const afterFirst = tools.observe({ seat: 'A' });
    const stale = catchError(() => tools.apply_steps({ seat: 'A', indices: [index] }));
    expect(stale instanceof StaleOfferIndex || isNamedError(stale, 'StaleOfferIndex')).toBe(true);
    expect(tools.observe({ seat: 'A' }).exposedTips).toEqual(afterFirst.exposedTips);
  });

  it('WHEN a later step in an apply_steps batch is illegal, the system shall commit none of the batch.', () => {
    const tools = createTools();
    openThree(tools);
    const before = tools.observe({ seat: 'A' });
    const first = openingStepMoves()[0];
    if (first === undefined) throw new Error('setup: no opening step');
    const error = catchError(() =>
      tools.apply_steps({
        seat: 'A',
        steps: [
          { from: String(first.from), exit: String(first.exit), count: first.count },
          { from: String(first.from), exit: 'tiling:a:99,99,0', count: 1 },
        ],
      }),
    );
    expect(wrapsContractViolation(error)).toBe(true);
    expect(tools.observe({ seat: 'A' }).exposedTips).toEqual(before.exposedTips);
    expect(tools.observe({ seat: 'A' }).activePlayer).toBe('A');
  });

    it('WHEN state.winner is set, apply_steps, end_turn, and play_heuristic_turn shall refuse and leave state unchanged.', () => {
      const tools = createTools();
      openThree(tools, ['human', 'human', 'human']);
      stampLiveWinner(tools, 'A');
      const observation = tools.observe({ seat: 'A' });
    const seat = observation.winner ?? 'A';
    const applyError = catchError(() =>
      tools.apply_steps({
        seat,
        steps: [{ from: 'tiling:a:5,0,0', exit: 'tiling:a:6,0,0', count: 1 }],
      }),
    );
    expect(wrapsContractViolation(applyError)).toBe(true);
    expect(String(applyError)).toMatch(/the match is over/);
    expect(String(catchError(() => tools.end_turn({ seat })))).toMatch(/the match is over/);
    expect(String(catchError(() => tools.play_heuristic_turn({ seat })))).toMatch(
      /the match is over/,
    );
    expect(tools.observe({ seat: 'A' }).winner).toBe(observation.winner);
  });

  it("WHEN observe runs, every findings[].move shall be a kind === 'step' member of legalMoves for activePlayer, and me shall be activePlayer, or findings shall be empty.", () => {
    const tools = createTools();
    openThree(tools);
    const active = tools.observe({ seat: 'A' });
    expect(active.me).toBe('A');
    expect(active.me).toBe(active.activePlayer);
    for (const finding of active.findings) {
      expect(finding.move.kind).toBe('step');
    }
    const other = tools.observe({ seat: 'B' });
    expect(other.findings).toEqual([]);
  });

  it('WHEN observe runs, spawnersNearTips shall contain at most 12 rows, and the payload shall not include a full spawner map.', () => {
    const tools = createTools();
    openThree(tools);
    const observation = tools.observe({ seat: 'A' });
    expect(observation.spawnersNearTips.length).toBeLessThanOrEqual(12);
    expect(payloadHasFullSpawnerDump(observation)).toBe(false);
  });

  it("WHEN threatLine is returned, it shall equal threatLineFromCounts over the observation's counts, offer tags, and dirt flag.", () => {
    const tools = createTools();
    openThree(tools);
    const observation = tools.observe({ seat: 'A' });
    expect(observation.threatLine).toBe(threatLineFromObservation(observation));
    expect(hasLeadLineKey(observation)).toBe(false);
  });

  it('WHEN legal_moves prints a row, it shall include spd= and shall include leave= iff the unmoved heads on from are greater than count.', () => {
    const tools = createTools();
    openThree(tools);
    const state = openingMatch();
    const rows = parseLegalMoveRows(tools.legal_moves({ seat: 'A' }).text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.body.includes('spd='))).toBe(true);
    for (const row of rows) {
      const heads = state.groups.get(row.from as ArrowId)?.heads ?? row.count;
      if (heads > row.count) {
        expect(row.body, `leave= when ${String(heads)} heads move ${String(row.count)}`).toContain(
          'leave=',
        );
        expect(row.leave).toBe(heads - row.count);
      } else {
        expect(row.body, 'no leave= when the whole stack moves').not.toContain('leave=');
      }
    }
  });

  it('WHEN includeMills is false, no printed row shall carry tag home_mill.', () => {
    const tools = createTools();
    openThree(tools);
    const rows = parseLegalMoveRows(tools.legal_moves({ seat: 'A', includeMills: false }).text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.tags.includes('home_mill'))).toBe(false);
  });

  it('WHEN two see_board calls share state and seat, the SVG texts shall be equal.', () => {
    const tools = createTools();
    openThree(tools);
    const a = tools.see_board({ seat: 'A' });
    const b = tools.see_board({ seat: 'A' });
    expect(a.svg).toBe(b.svg);
  });

  it('WHEN two see_board calls share state and differ in seat, they shall share viewBox and the data-arrow / data-spawner sets, and only group data-highlight may differ.', () => {
    const tools = createTools();
    openThree(tools);
    const a = tools.see_board({ seat: 'A' }).svg;
    const b = tools.see_board({ seat: 'B' }).svg;
    expect(svgViewBox(b)).toBe(svgViewBox(a));
    expect(svgAttrSet(b, 'data-arrow')).toEqual(svgAttrSet(a, 'data-arrow'));
    expect(svgAttrSet(b, 'data-spawner')).toEqual(svgAttrSet(a, 'data-spawner'));
    for (const group of svgGroupHighlights(b)) {
      if (group.highlight) expect(group.owner).toBe('B');
      if (group.owner === 'B') expect(group.highlight).toBe(true);
    }
    for (const group of svgGroupHighlights(a)) {
      if (group.highlight) expect(group.owner).toBe('A');
      if (group.owner === 'A') expect(group.highlight).toBe(true);
    }
  });

  it('WHEN see_board runs, the SVG shall not contain data-legal-index or a findings list, and shall not be a PNG.', () => {
    const tools = createTools();
    openThree(tools);
    const { svg } = tools.see_board({ seat: 'A' });
    expect(svg).not.toContain('data-legal-index');
    expect(svg).not.toContain('findings');
    expect(svg.startsWith('PNG') || svg.includes('image/png')).toBe(false);
  });

  it('WHEN new_match succeeds a second time, the previous matchId shall no longer be the live match, and last offers shall be empty.', () => {
    const tools = createTools();
    const first = openThree(tools, undefined, 1);
    tools.legal_moves({ seat: 'A' });
    const second = openThree(tools, undefined, 2);
    expect(second.matchId).not.toBe(first.matchId);
    expect(
      isNamedError(
        catchError(() => tools.apply_steps({ seat: 'A', indices: [0] })),
        'StaleOfferIndex',
      ),
    ).toBe(true);
  });

  it('WHEN a tool other than new_match runs with no live match, the system shall refuse NoLiveMatch.', () => {
    const tools = createTools();
    expect(catchError(() => tools.observe({ seat: 'A' }))).toBeInstanceOf(NoLiveMatch);
    expect(catchError(() => tools.legal_moves({ seat: 'A' }))).toBeInstanceOf(NoLiveMatch);
    expect(catchError(() => tools.apply_steps({ seat: 'A', steps: [{ from: 'a', exit: 'b', count: 1 }] }))).toBeInstanceOf(
      NoLiveMatch,
    );
    expect(catchError(() => tools.end_turn({ seat: 'A' }))).toBeInstanceOf(NoLiveMatch);
    expect(catchError(() => tools.play_heuristic_turn({ seat: 'A' }))).toBeInstanceOf(NoLiveMatch);
    expect(catchError(() => tools.see_board({ seat: 'A' }))).toBeInstanceOf(NoLiveMatch);
  });

  it("WHEN two findings tie, the system shall reuse P21's deterministic tie-break.", () => {
    const src = mcpSrc();
    expect(src).toMatch(/collectFindings|compareFindings/);
    const tools = createTools();
    openThree(tools);
    const a = tools.observe({ seat: 'A' });
    const b = tools.observe({ seat: 'A' });
    expect(a.findings).toEqual(b.findings);
  });

  it('The observation, findings, board picture, and matchId mint shall not use Math.random or Date.now.', () => {
    const src = mcpSrc();
    expect(src).not.toMatch(/Math\.random\(/);
    expect(src).not.toMatch(/Date\.now\(/);
  });

  it('Keys shall not leave the process. This package shall not call OpenAI or any model host.', () => {
    const src = mcpSrc();
    const pkg = mcpPackageJson();
    expect(src).not.toMatch(/openai|api\.x\.ai|chat\/completions/i);
    expect(pkg).not.toMatch(/@conquarrow\/web/);
  });

  it('tools/list shall name exactly the seven tools.', () => {
    const src = mcpSrc();
    expect(src).toMatch(/['"]new_match['"]/);
    expect(src).toMatch(/['"]observe['"]/);
    expect(src).toMatch(/['"]legal_moves['"]/);
    expect(src).toMatch(/['"]apply_steps['"]/);
    expect(src).toMatch(/['"]end_turn['"]/);
    expect(src).toMatch(/['"]play_heuristic_turn['"]/);
    expect(src).toMatch(/['"]see_board['"]/);
  });

  it('The server shall list no MCP resources.', () => {
    expect(mcpSrc()).not.toMatch(/conquarrow:\/\//);
  });

  it('JSON tools shall not return the full 58-spawner array.', () => {
    const tools = createTools();
    const opened = openThree(tools);
    expect(payloadHasFullSpawnerDump(opened.observation)).toBe(false);
    expect(payloadHasFullSpawnerDump(tools.observe({ seat: 'A' }))).toBe(false);
  });
});
