/**
 * docs/spec/next-stack-cursor/next-stack-cursor.edge-cases.feature — P50.
 * One it() per Gherkin scenario.
 */

import { describe, expect, it } from 'vitest';
import { centerOn, toScreen } from '../src/viewport';
import {
  advanceCursor,
  emptyRecency,
  movableArrows,
  panForSelection,
  pushRecency,
  SELECTION_MARGIN_FRACTION,
  turnAnchor,
} from '../src/selection/cursor';
import {
  A,
  arrow,
  arrows,
  B,
  lap,
  stubRules,
  stubState,
  vp,
} from './next-stack-cursor.support';

describe('Movable is what the rules offer, not what allowance suggests', () => {
  it('A stack with allowance but no legal step is not selected', () => {
    // a4 holds a stack with allowance, but the rules offer no step out of it.
    const movable = movableArrows(stubRules('a1', 'a2'), stubState());
    expect(movable).toEqual(arrows('a1', 'a2'));
    const visited = lap((c) => advanceCursor(c, movable), undefined, 5);
    expect(visited.map(String)).not.toContain('a4');
  });

  it('Nothing movable leaves the cursor on nothing', () => {
    const movable = movableArrows(stubRules(), stubState());
    expect(movable).toEqual([]);
    expect(turnAnchor(emptyRecency(), A, movable).cursor).toBeUndefined();
  });

  it('A single movable arrow is re-selected by a press', () => {
    expect(advanceCursor(arrow('a1'), arrows('a1'))).toBe(arrow('a1'));
  });
});

describe('Preemption precedence', () => {
  it('Destination wins over source remainder', () => {
    const movable = arrows('a1', 'a9');
    expect(
      advanceCursor(arrow('a1'), movable, { from: arrow('a1'), exit: arrow('a9') }),
    ).toBe(arrow('a9'));
  });

  it('Source remainder is taken when the destination cannot act', () => {
    const movable = arrows('a1', 'a2');
    expect(
      advanceCursor(arrow('a1'), movable, { from: arrow('a1'), exit: arrow('a9') }),
    ).toBe(arrow('a1'));
  });

  it('Neither can act, so the lap continues', () => {
    const movable = arrows('a2', 'a3');
    expect(
      advanceCursor(arrow('a1'), movable, { from: arrow('a1'), exit: arrow('a9') }),
    ).toBe(arrow('a2'));
  });

  it('A merge into a stack with allowance left preempts', () => {
    const movable = arrows('a2', 'a9');
    expect(
      advanceCursor(arrow('a1'), movable, { from: arrow('a1'), exit: arrow('a9') }),
    ).toBe(arrow('a9'));
  });

  it('A merge that exhausts the merged stack does not preempt', () => {
    const movable = arrows('a2', 'a3');
    expect(
      advanceCursor(arrow('a1'), movable, { from: arrow('a1'), exit: arrow('a9') }),
    ).toBe(arrow('a2'));
  });

  it('A preempted arrow is not offered again in the same lap', () => {
    const movable = arrows('a1', 'a2', 'a3', 'a9');
    const preempted = advanceCursor(arrow('a1'), movable, {
      from: arrow('a1'),
      exit: arrow('a9'),
    });
    expect(preempted).toBe(arrow('a9'));
    const visited = lap((c) => advanceCursor(c, movable), preempted, 3);
    expect(visited).toEqual(arrows('a1', 'a2', 'a3'));
    expect(visited.map(String)).not.toContain('a9');
  });
});

describe('The movable set changes under the cursor', () => {
  it('A newly created stack is reached later in the lap', () => {
    const movable = arrows('a1', 'a2', 'a3');
    const first = advanceCursor(arrow('a3'), movable);
    expect(first).toBe(arrow('a1'));
    expect(advanceCursor(first, movable)).toBe(arrow('a2'));
  });

  it("The cursor's own arrow stops being movable", () => {
    expect(advanceCursor(arrow('a2'), arrows('a1', 'a3'))).toBe(arrow('a3'));
  });

  it('Every other arrow stops being movable', () => {
    expect(advanceCursor(arrow('a1'), arrows('a1'))).toBe(arrow('a1'));
  });

  it('The last movable arrow is spent', () => {
    expect(
      advanceCursor(arrow('a1'), [], { from: arrow('a1'), exit: arrow('z0') }),
    ).toBeUndefined();
  });
});

describe('Turn anchoring across seats', () => {
  it('Each seat anchors on its own history', () => {
    let recency = pushRecency(emptyRecency(), A, arrow('a1'));
    recency = pushRecency(recency, B, arrow('b1'));
    const forA = turnAnchor(recency, A, arrows('a1', 'a2'));
    expect(forA.cursor).toBe(arrow('a1'));
    const forB = turnAnchor(forA.recency, B, arrows('b1', 'b2'));
    expect(forB.cursor).toBe(arrow('b1'));
  });

  it("A seat's recency is cleared after it is read", () => {
    let recency = pushRecency(emptyRecency(), A, arrow('a1'));
    recency = pushRecency(recency, A, arrow('a2'));
    const turn = turnAnchor(recency, A, arrows('a1', 'a2', 'a3'));
    expect(turn.cursor).toBe(arrow('a2'));
    expect(turn.recency.get(A) ?? []).toEqual([]);
    const next = pushRecency(turn.recency, A, arrow('a3'));
    expect(turnAnchor(next, A, arrows('a1', 'a2', 'a3')).cursor).toBe(arrow('a3'));
  });

  it('The whole previous turn is gone', () => {
    let recency = emptyRecency();
    for (const id of ['a1', 'a2', 'a3']) recency = pushRecency(recency, A, arrow(id));
    expect(turnAnchor(recency, A, arrows('a5', 'a7')).cursor).toBe(arrow('a5'));
  });

  it('A seat that has never acted', () => {
    expect(turnAnchor(emptyRecency(), A, arrows('a1', 'a2')).cursor).toBe(arrow('a1'));
  });

  it('Acting twice on one arrow leaves one entry', () => {
    let recency = emptyRecency();
    for (const id of ['a1', 'a2', 'a1']) recency = pushRecency(recency, A, arrow(id));
    expect(recency.get(A)).toEqual(arrows('a1', 'a2'));
    expect(turnAnchor(recency, A, arrows('a1', 'a2')).cursor).toBe(arrow('a1'));
  });

  it('Recency does not survive a reload', () => {
    // A reload starts from a fresh, empty store — identical to the first turn.
    expect(turnAnchor(emptyRecency(), A, arrows('a5', 'a7')).cursor).toBe(arrow('a5'));
  });
});

describe('Camera behaviour is unchanged', () => {
  it('An on-screen selection does not move the camera', () => {
    const viewport = vp();
    const at = { x: 0.5, y: 0.25 };
    const screen = toScreen(viewport, at.x, at.y);
    const margin = Math.min(viewport.width, viewport.height) * SELECTION_MARGIN_FRACTION;
    expect(screen.x).toBeGreaterThan(margin);
    expect(screen.x).toBeLessThan(viewport.width - margin);
    expect(panForSelection(viewport, at)).toEqual(viewport);
  });

  it('An off-screen selection pans into view', () => {
    const viewport = vp();
    const at = { x: 40, y: -30 };
    expect(panForSelection(viewport, at)).toEqual(centerOn(viewport, at.x, at.y));
  });
});
