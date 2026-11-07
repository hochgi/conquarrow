/**
 * Ask before leaving a local match that is still in progress (P90).
 *
 * The decision is {@link shouldGuardLeave}. This hook only owns the history
 * entry and the unload prompt. It does not read or write the hash routes
 * online play uses.
 */

import { useEffect, useRef } from 'react';
import { LEAVE_MATCH_CONFIRM } from './resume';

const ENTRY = { conquarrowLocal: true };

const onOurEntry = (): boolean =>
  (window.history.state as { conquarrowLocal?: unknown } | null)?.conquarrowLocal === true;

/**
 * While `active`, one history entry sits above the lobby. Back asks; Cancel
 * pushes the entry again; OK calls `onLeave`. Refresh and close ask via
 * `beforeunload` — the browser supplies that copy.
 *
 * The entry is pushed only when the current one is not already ours, and it is
 * taken off again when the guard turns off while it is on top (the Lobby
 * button, or a winner). So entries never pile up, and Back from the lobby
 * leaves the app as it did before P90.
 */
export const useResumeLeaveGuard = (active: boolean, onLeave: () => void): void => {
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;

  useEffect(() => {
    if (!active) {
      if (onOurEntry()) window.history.back();
      return;
    }
    if (!onOurEntry()) window.history.pushState(ENTRY, '');
    const onPop = (): void => {
      if (window.confirm(LEAVE_MATCH_CONFIRM)) {
        leaveRef.current();
        return;
      }
      window.history.pushState(ENTRY, '');
    };
    const onUnload = (event: BeforeUnloadEvent): void => {
      // preventDefault is the current ask. returnValue is deprecated and unused.
      event.preventDefault();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active]);
};
