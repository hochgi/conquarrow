/**
 * Local AI move playback — plan once, apply with an injected gap.
 */

import type { GameState, Move, RulesPort } from '@conquarrow/contracts';

export const BOT_PLAYBACK_GAP_MS = 400;

export type PlaybackGapCtx = {
  readonly move: Move;
  readonly before: GameState;
  readonly after: GameState;
  readonly index: number;
};

export function localAiChairKey(
  state: GameState | undefined,
  opts: { online: boolean; isAiSeat: (id: string) => boolean },
): string | null {
  if (state === undefined || opts.online || state.winner !== undefined) {
    return null;
  }
  const key = String(state.activePlayer);
  if (!opts.isAiSeat(key)) return null;
  return key;
}

/** Camera / FX choreography is presentation; a fault in it must not abort playback. */
const awaitPresentation = async (hook: (() => Promise<void>) | undefined): Promise<void> => {
  if (hook === undefined) return;
  try {
    await hook();
  } catch {
    // Camera choreography is presentation; a fault in it must not abort playback.
  }
};

const gapAfter = (
  gapMs: number | ((ctx: PlaybackGapCtx) => number),
  ctx: PlaybackGapCtx,
): number => (typeof gapMs === 'function' ? gapMs(ctx) : gapMs);

export async function applyMovesSequentially(
  rules: RulesPort,
  start: GameState,
  moves: readonly Move[],
  opts: {
    gapMs: number | ((ctx: PlaybackGapCtx) => number);
    sleep: (ms: number) => Promise<void>;
    onApplied: (move: Move, after: GameState, index: number) => void;
    cancelled: () => boolean;
    /**
     * Camera choreography for the move about to play (P48): ease out, ease in,
     * hold. Awaited *before* `rules.apply`, and it cannot change what applies —
     * the turn was decided in full before playback began. A rejection is
     * swallowed: a camera fault must never stop the turn from resolving.
     */
    beforeApply?: (move: Move, index: number) => Promise<void>;
    /**
     * Conversion framing (P70): ease to converted stacks outside the shot
     * *after* apply, before FX enqueue, so the hand-off waits for the ease.
     */
    afterApply?: (ctx: PlaybackGapCtx) => Promise<void>;
  },
): Promise<GameState> {
  let at = start;
  let index = 0;
  for (const move of moves) {
    if (opts.cancelled()) return at;
    const beforeHook = opts.beforeApply;
    await awaitPresentation(
      beforeHook === undefined ? undefined : () => beforeHook(move, index),
    );
    if (opts.cancelled()) return at;
    const before = at;
    at = rules.apply(at, move);
    const ctx: PlaybackGapCtx = { move, before, after: at, index };
    const afterHook = opts.afterApply;
    await awaitPresentation(afterHook === undefined ? undefined : () => afterHook(ctx));
    opts.onApplied(move, at, index);
    if (index < moves.length - 1) {
      if (opts.cancelled()) return at;
      await opts.sleep(gapAfter(opts.gapMs, ctx));
    }
    index += 1;
  }
  return at;
};
