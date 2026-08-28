/**
 * Local bot pause — hold heuristic/BYOK decisions without ending the match.
 *
 * ADR 0003 / CONTEXT.md: Pause is an operator control; idle pause is all-bot
 * only, while the watching tab is not focused. Not a game rule. Pure: no clock,
 * no I/O, no DOM — App injects `tabFocused` from visibility/focus listeners.
 *
 * @see docs/spec/bot-pause/bot-pause.md
 */

import type { SeatKind } from './seatPlan';

export type PauseKind = 'running' | 'manual' | 'idle';

export const pauseOffered = (args: {
  readonly vsBot: boolean;
  readonly online: boolean;
  readonly matchOver: boolean;
  readonly tutorial: boolean;
}): boolean => args.vsBot && !args.online && !args.matchOver && !args.tutorial;

export const isAllBot = (kinds: readonly SeatKind[]): boolean =>
  kinds.length > 0 && kinds.every((kind) => kind !== 'human');

export const idlePaused = (args: {
  readonly allBot: boolean;
  readonly tabFocused: boolean;
  readonly online: boolean;
}): boolean => args.allBot && !args.tabFocused && !args.online;

export const botsHeld = (args: {
  readonly manual: boolean;
  readonly idle: boolean;
}): boolean => args.manual || args.idle;

export const pauseKind = (args: {
  readonly manual: boolean;
  readonly idle: boolean;
}): PauseKind => {
  if (args.manual) return 'manual';
  if (args.idle) return 'idle';
  return 'running';
};

export const pauseButtonLabel = (manual: boolean): 'Pause' | 'Resume' =>
  manual ? 'Resume' : 'Pause';

export const turnControlsLocked = (args: {
  readonly matchOver: boolean;
  readonly botBusy: boolean;
  readonly aiChair: boolean;
}): boolean => args.matchOver || args.botBusy || args.aiChair;

export const pauseHint = (kind: PauseKind): string | undefined => {
  switch (kind) {
    case 'manual':
      return 'Paused — bots will not move until you resume';
    case 'idle':
      return 'Paused — this tab is in the background';
    case 'running':
      return undefined;
  }
};
