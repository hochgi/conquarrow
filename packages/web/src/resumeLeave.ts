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

/**
 * While `active`, one history entry sits above the lobby. Back asks; Cancel
 * pushes the entry again; OK calls `onLeave`. Refresh and close ask via
 * `beforeunload` — the browser supplies that copy.
 *
 * The pushed flag survives Strict Mode's extra effect pass, so dev does not
 * stack two entries for one match.
 */
export const useResumeLeaveGuard = (active: boolean, onLeave: () => void): void => {
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  const pushed = useRef(false);

  useEffect(() => {
    if (!active) {
      pushed.current = false;
      return;
    }
    if (!pushed.current) {
      window.history.pushState(ENTRY, '');
      pushed.current = true;
    }
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
