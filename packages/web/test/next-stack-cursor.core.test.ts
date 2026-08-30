/**
 * docs/spec/next-stack-cursor/next-stack-cursor.core.feature — P50.
 * One it() per Gherkin scenario. Pure helpers only — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  advanceCursor,
  emptyRecency,
  movableArrows,
  pushRecency,
  turnAnchor,
} from '../src/selection/cursor';
import {
  A,
  appSource,
  arrow,
  arrows,
  codeOf,
  cursorSource,
  hudSource,
  lap,
  stubRules,
  stubState,
} from './next-stack-cursor.support';

describe('The cursor advances through every movable arrow', () => {
  it('The first press selects the baseline first arrow', () => {
    const movable = movableArrows(stubRules('a1', 'a2', 'a3'), stubState());
    expect(movable).toEqual(arrows('a1', 'a2', 'a3'));
    const { cursor } = turnAnchor(emptyRecency(), A, movable);
    expect(cursor).toBe(arrow('a1'));
  });

  it('A press advances to the baseline successor', () => {
    const movable = arrows('a1', 'a2', 'a3');
    expect(advanceCursor(arrow('a1'), movable)).toBe(arrow('a2'));
  });

  it('The cursor wraps at the end of the lap', () => {
    const movable = arrows('a1', 'a2', 'a3');
    expect(advanceCursor(arrow('a3'), movable)).toBe(arrow('a1'));
  });

  it('A full lap visits every movable arrow exactly once', () => {
    const movable = arrows('a1', 'a2', 'a3');
    const visited = [arrow('a1'), ...lap((c) => advanceCursor(c, movable), arrow('a1'), 2)];
    expect(visited).toEqual(arrows('a1', 'a2', 'a3'));
    expect(new Set(visited.map(String)).size).toBe(3);
  });
});

describe('Pressing next stack is not a move', () => {
  it('No move is emitted and the GameState is unchanged', () => {
    const state = stubState();
    const before = JSON.stringify(state);
    const movable = arrows('a1', 'a2');
    const next = advanceCursor(arrow('a1'), movable);
    expect(next).toBe(arrow('a2'));
    expect(JSON.stringify(state)).toBe(before);
    // The module cannot emit a move: it never touches `apply` or a move factory.
    const code = codeOf(cursorSource());
    expect(/\bapply\s*\(/.test(code), 'cursor.ts reaches for rules.apply').toBe(false);
    expect(/\bskip\s*\(/.test(code), 'cursor.ts builds a skip move').toBe(false);
  });

  it('Nothing is written to the match log and it contains no skip', () => {
    const code = codeOf(appSource());
    expect(code.includes('requestSkip'), 'App.tsx still calls requestSkip').toBe(false);
    expect(/\bskip\s*\(/.test(code), 'App.tsx still builds a skip move').toBe(false);
    // `\bonSkip\b` and not a bare substring: the tutorial's own `onSkipLesson`
    // is a different control and must not be dragged into a rename by this test.
    const hud = codeOf(hudSource());
    expect(/\bonSkip\b/.test(hud), 'Hud.tsx still has an onSkip handler').toBe(false);
    expect(hud.includes('onNextStack'), 'Hud.tsx has no onNextStack handler').toBe(true);
  });

  it('The button is usable with nothing selected', () => {
    const movable = arrows('a1', 'a2');
    const next = advanceCursor(undefined, movable);
    expect(next).toBeDefined();
    expect(movable.map(String)).toContain(String(next));
    // ...and the button itself is not gated on having a selection. No RTL here,
    // so this reads the button's own `disabled` expression out of the source.
    const hud = codeOf(hudSource());
    const button = /onClick=\{onNextStack\}([\s\S]*?)Next stack/.exec(hud)?.[1];
    expect(button, 'the Next stack button is not in Hud.tsx').toBeDefined();
    expect(button).toContain('disabled={controlsLocked}');
    expect(/idle/.test(button ?? 'idle'), 'the button is still disabled from idle').toBe(false);
  });
});

describe('A committed step advances the cursor by the same rule', () => {
  it('A step that exhausts its stack advances to the successor', () => {
    // a1 spent its last allowance and the destination cannot act either.
    const movable = arrows('a2', 'a3');
    const next = advanceCursor(arrow('a1'), movable, {
      from: arrow('a1'),
      exit: arrow('z0'),
    });
    expect(next).toBe(arrow('a2'));
  });

  it('A partial step preempts to its destination', () => {
    const movable = arrows('a1', 'a2', 'a3', 'a9');
    const next = advanceCursor(arrow('a1'), movable, {
      from: arrow('a1'),
      exit: arrow('a9'),
    });
    expect(next).toBe(arrow('a9'));
  });

  it('The lap resumes from the preempted arrow', () => {
    const movable = arrows('a1', 'a2', 'a3', 'a9');
    expect(advanceCursor(arrow('a9'), movable)).toBe(arrow('a1'));
  });
});

describe('A turn begins on the stack that acted last', () => {
  it('The last stack acted on is selected next turn', () => {
    let recency = emptyRecency();
    for (const id of ['a1', 'a2', 'a3']) recency = pushRecency(recency, A, arrow(id));
    const { cursor } = turnAnchor(recency, A, arrows('a1', 'a2', 'a3'));
    expect(cursor).toBe(arrow('a3'));
  });

  it('A gone stack falls back to the next most recent', () => {
    let recency = emptyRecency();
    for (const id of ['a1', 'a2', 'a3']) recency = pushRecency(recency, A, arrow(id));
    const { cursor } = turnAnchor(recency, A, arrows('a1', 'a2'));
    expect(cursor).toBe(arrow('a2'));
  });
});
