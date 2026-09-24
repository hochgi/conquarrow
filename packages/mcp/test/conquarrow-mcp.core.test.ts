/**
 * One test per scenario of docs/spec/conquarrow-mcp/conquarrow-mcp.core.feature.
 *
 * Written against the MCP tool/handler surface. Adapter only — not a game rule.
 *
 * @see docs/spec/conquarrow-mcp/conquarrow-mcp.md
 */

import { describe, expect, it } from 'vitest';
import { chooseTurnGreedy } from '../src/greedy';
import {
  DIRT_CLAUSE,
  DIRT_CLOSE_WALK,
  createTools,
  engineStepKey,
  geometry,
  openingLeaveHomeIndex,
  openingMatch,
  openingStepMoves,
  openThree,
  parseLegalMoveRows,
  payloadHasFullSpawnerDump,
  replayActions,
  rules,
  svgAttrSet,
  svgGroupHighlights,
  svgViewBox,
} from './support';

describe('Tools over legalMoves and apply, not a scrape', () => {
  describe('Opening match is a seat-scoped view', () => {
    it('new_match seed 1 R=7 three seats returns the locked opening', () => {
      const tools = createTools();
      const result = openThree(tools);

      expect(result.matchId.length, 'result includes a matchId').toBeGreaterThan(0);
      expect(result.observation.me).toBe('A');
      expect(result.observation.activePlayer).toBe('A');
      expect(result.observation.winner).toBeNull();
      expect(result.observation.shareCounts['A']).toBe(4);
      expect(result.observation.shareCounts['B']).toBe(4);
      expect(result.observation.shareCounts['C']).toBe(3);
      expect(payloadHasFullSpawnerDump(result.observation)).toBe(false);
    });

    it("legal_moves for A's opening home stack is the BYOK row shape", () => {
      const tools = createTools();
      openThree(tools);
      const { text } = tools.legal_moves({ seat: 'A' });
      const rows = parseLegalMoveRows(text);
      const tags = rows.flatMap((row) => row.tags);

      expect(tags.includes('leave_home'), 'at least one row tagged leave_home').toBe(true);
      expect(tags.includes('home_mill'), 'at least one row tagged home_mill').toBe(true);
      expect(
        rows.length > 0 && rows.every((row) => row.body.includes('spd=')),
        'every numbered row contains spd=',
      ).toBe(true);

      const state = openingMatch();
      for (const row of rows) {
        const from = openingStepMoves(state).find(
          (move) =>
            String(move.from) === row.from &&
            String(move.exit) === row.exit &&
            move.count === row.count,
        );
        if (from === undefined) continue;
        const group = state.groups.get(from.from);
        const heads = group?.heads ?? from.count;
        if (heads > from.count) {
          expect(row.body, 'unmoved heads on from greater than count contains leave=').toContain(
            'leave=',
          );
        }
      }
      expect(
        rows.some((row) => {
          const move = openingStepMoves(state).find(
            (candidate) => engineStepKey(candidate) === `${row.from}|${row.exit}|${String(row.count)}`,
          );
          if (move === undefined) return false;
          const heads = state.groups.get(move.from)?.heads ?? move.count;
          return heads > move.count && row.body.includes('leave=');
        }),
        'a row with unmoved heads on from greater than count contains leave=',
      ).toBe(true);

      const legalKeys = new Set(openingStepMoves(state).map(engineStepKey));
      for (const row of rows) {
        expect(
          legalKeys.has(`${row.from}|${row.exit}|${String(row.count)}`),
          'no row is invented beyond legalMoves for activePlayer',
        ).toBe(true);
      }
    });

    it('apply_steps of one legal opening step then refuses the same index', () => {
      const tools = createTools();
      openThree(tools);
      tools.legal_moves({ seat: 'A' });
      const index = openingLeaveHomeIndex();
      const before = tools.observe({ seat: 'A' });

      const first = tools.apply_steps({ seat: 'A', indices: [index] });

      expect(first.observation.exposedTips).not.toEqual(before.exposedTips);
      expect(first.observation.exposedTips.length, 'leave_home exposes a trail tip').toBeGreaterThan(0);

      const refused = ((): unknown => {
        try {
          tools.apply_steps({ seat: 'A', indices: [index] });
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(refused, 'the tool refuses the same index again').toBeInstanceOf(Error);
      const afterRefuse = tools.observe({ seat: 'A' });
      expect(afterRefuse.activePlayer).toBe('A');
      expect(afterRefuse.exposedTips).toEqual(first.observation.exposedTips);
    });

    it('end_turn on the active human seat advances activePlayer', () => {
      const tools = createTools();
      openThree(tools);
      const observation = tools.end_turn({ seat: 'A' });
      expect(observation.activePlayer).toBe('B');
      expect(observation.winner).toBeNull();
    });

    it('observe after a dirt-shaped close does not invent share+N', () => {
      const tools = createTools();
      tools.new_match({
        playerCount: 3,
        seats: ['human', 'human', 'human'],
        R: 7,
        homeOffset: 5,
        dominationN: 5,
        spawnerSeed: 1,
      });
      replayActions(tools, DIRT_CLOSE_WALK.prefix);
      const pre = tools.observe({ seat: DIRT_CLOSE_WALK.seat });
      const result = tools.apply_steps({
        seat: DIRT_CLOSE_WALK.seat,
        steps: [DIRT_CLOSE_WALK.close],
      });
      const tags = result.landed[0]?.tags ?? [];
      expect(tags.includes('closes'), 'landed tags include closes').toBe(true);
      expect(
        tags.some((tag) => /^share\+\d+$/.test(tag)),
        'landed tags do not include a share+N tag',
      ).toBe(false);
      expect(result.observation.shareCounts[DIRT_CLOSE_WALK.seat]).toBe(
        pre.shareCounts[DIRT_CLOSE_WALK.seat],
      );
      const offerIsDirt =
        result.observation.offerTags.includes('dirt-closes') ||
        (result.observation.offerTags.includes('closes') &&
          !result.observation.offerTags.some((tag) => /^share\+\d+$/.test(tag)));
      if (offerIsDirt) {
        expect(result.observation.threatLine).toContain(DIRT_CLAUSE);
      }
    });

    it('play_heuristic_turn on the active heuristic seat plays greedy-v1', () => {
      const tools = createTools();
      openThree(tools, ['heuristic', 'human', 'human']);
      const pre = openingMatch();
      const expected = chooseTurnGreedy(geometry, rules, pre, pre.activePlayer);
      const result = tools.play_heuristic_turn({ seat: 'A' });
      expect(result.moves).toEqual(expected);
      expect(result.moves[result.moves.length - 1]).toEqual({ kind: 'endTurn' });
      expect(result.observation.activePlayer).toBe('B');
      const second = ((): unknown => {
        try {
          tools.play_heuristic_turn({ seat: 'A' });
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(second, 'a second play_heuristic_turn for seat A is refused').toBeInstanceOf(Error);
    });

    it('findings list only kinds whose move is a legal step for me', () => {
      const tools = createTools();
      openThree(tools);
      const forA = tools.observe({ seat: 'A' });
      expect(forA.findings.length, 'active seat A has findings').toBeGreaterThan(0);
      const legalKeys = new Set(openingStepMoves().map(engineStepKey));
      for (const finding of forA.findings) {
        expect(finding.move, 'every findings entry has a move field').toBeDefined();
        expect('step' in finding, 'no findings entry has a step field').toBe(false);
        expect(finding.move.kind).toBe('step');
        expect(
          legalKeys.has(
            `${finding.move.from}|${finding.move.exit}|${String(finding.move.count)}`,
          ),
        ).toBe(true);
      }
      const forB = tools.observe({ seat: 'B' });
      expect(forB.findings).toEqual([]);
    });

    it('no JSON tool returns the full 58-spawner array', () => {
      const tools = createTools();
      openThree(tools);
      const observation = tools.observe({ seat: 'A' });
      expect(observation.spawnersNearTips.length).toBeLessThanOrEqual(12);
      expect(payloadHasFullSpawnerDump(observation)).toBe(false);
      const picture = tools.see_board({ seat: 'A' });
      expect(picture.svg.includes('data-spawner=') || picture.svg.includes('<svg')).toBe(true);
      expect(payloadHasFullSpawnerDump(tools.legal_moves({ seat: 'A' }))).toBe(false);
      expect(payloadHasFullSpawnerDump(tools.end_turn({ seat: 'A' }))).toBe(false);
    });

    it('see_board returns SVG, identical for the same state and seat', () => {
      const tools = createTools();
      openThree(tools);
      const first = tools.see_board({ seat: 'A' });
      const second = tools.see_board({ seat: 'A' });
      expect(first.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(second.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(first.svg).toBe(second.svg);
      expect(first.svg.includes('image/png') || first.svg.startsWith('PNG')).toBe(false);
      expect(first.svg).not.toContain('data-legal-index');
      const other = tools.see_board({ seat: 'B' });
      expect(svgViewBox(other.svg)).toBe(svgViewBox(first.svg));
      expect(svgAttrSet(other.svg, 'data-arrow')).toEqual(svgAttrSet(first.svg, 'data-arrow'));
      expect(svgAttrSet(other.svg, 'data-spawner')).toEqual(svgAttrSet(first.svg, 'data-spawner'));
      for (const group of svgGroupHighlights(other.svg)) {
        if (group.highlight) expect(group.owner).toBe('B');
        if (group.owner === 'B') expect(group.highlight).toBe(true);
      }
    });
  });
});
