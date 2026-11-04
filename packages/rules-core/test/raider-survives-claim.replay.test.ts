/**
 * Replay fixtures for P87 — the 2026-11-04 playtest log, folded from
 * `makeMatch(config)` on the generated tiling.
 *
 * Two independent folds of the same record: `playtest20261104` applies each move
 * directly, and `replay` re-folds it, refusing any move `legalMoves` does not offer.
 * Equal snapshots are the determinism check; the named facts are the golden.
 *
 * - **#345, the fix.** C's close claims the arrow under A's territory-grade raider
 *   `2,2,2`. A x1 stays A, with its trail mark, on C's land.
 * - **#329 → #331, the contrast.** B x2 on `-1,1,2`, already C's land, survives C's
 *   close at #329 and converts at #331, when C steps onto B's trail `-1,2,2`.
 *
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 * @see docs/design/packets/P87-raider-survives-claim.md
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import { replay } from '../src/replay';
import { A, B, headsOn, isTrail, ownerOf, snapshot, territoryOf } from './support';
import { C, playtest20261104, stateAt } from './raider-survives-claim.support';

const arrow = mintArrowId;
const log = playtest20261104(345);
const opening = stateAt(log.states, 0);
const replayed = replay(log.table.rules, opening, log.moves.slice(0, 346));

describe('P87 replay — playtest 2026-11-04', () => {
  it('replays moves 0..345 legally and identically to a direct fold', () => {
    expect(snapshot(replayed)).toEqual(snapshot(stateAt(log.states, 346)));
  });

  it('#345 leaves A x1 unconverted on 2,2,2, on C’s land, with its trail mark', () => {
    const raider = arrow('tiling:a:2,2,2');
    expect(ownerOf(replayed, raider)).toBe(A);
    expect(headsOn(replayed, raider)).toBe(1);
    expect(territoryOf(replayed, raider)).toBe(C);
    expect(isTrail(replayed, A, raider)).toBe(true);
    expect(territoryOf(replayed, arrow('tiling:a:2,1,0'))).toBe(C);
    expect(territoryOf(replayed, arrow('tiling:a:3,1,1'))).toBe(C);
  });

  it('#329 → #331 is unchanged: B x2 survives the close, then converts on the cut', () => {
    const raider = arrow('tiling:a:-1,1,2');
    const road = arrow('tiling:a:-1,2,2');
    const afterClose = stateAt(log.states, 330);
    expect(ownerOf(afterClose, raider)).toBe(B);
    expect(headsOn(afterClose, raider)).toBe(2);
    expect(isTrail(afterClose, B, raider)).toBe(true);
    expect(isTrail(afterClose, B, road)).toBe(true);

    const afterCut = stateAt(log.states, 332);
    expect(ownerOf(afterCut, raider)).toBe(C);
    expect(headsOn(afterCut, raider)).toBe(2);
    expect(isTrail(afterCut, B, raider)).toBe(false);
    expect(isTrail(afterCut, B, road)).toBe(false);
  });
});
