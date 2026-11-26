/**
 * Presentational elimination toasts (P102 D4). No loss rule lives here.
 *
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

import { useEffect, useRef, type ReactElement } from 'react';
import type { EliminationToast } from './lostSeat';

export interface EliminationToastsProps {
  readonly toasts: readonly EliminationToast[];
  readonly dismissMs: number;
  readonly onDismiss: (id: string) => void;
}

// Stryker disable all -- no DOM harness; eliminationToasts / ELIMINATION_TOAST_MS hold the decision and are tested.
const ToastButton = ({
  toast,
  dismissMs,
  onDismiss,
}: {
  readonly toast: EliminationToast;
  readonly dismissMs: number;
  readonly onDismiss: (id: string) => void;
}): ReactElement => {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    timer.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, dismissMs);
    return () => {
      window.clearTimeout(timer.current);
    };
  }, [dismissMs, onDismiss, toast.id]);

  return (
    <button
      type="button"
      className="elimination-toast"
      onClick={() => {
        window.clearTimeout(timer.current);
        onDismiss(toast.id);
      }}
    >
      {toast.text}
    </button>
  );
};

/** Live region. Each toast's timer starts on its own mount and clears on dismiss and unmount. */
export const EliminationToasts = ({
  toasts,
  dismissMs,
  onDismiss,
}: EliminationToastsProps): ReactElement => (
  <div className="elimination-toasts" aria-live="polite" aria-atomic="false">
    {toasts.map((toast) => (
      <ToastButton key={toast.id} toast={toast} dismissMs={dismissMs} onDismiss={onDismiss} />
    ))}
  </div>
);
// Stryker restore all
