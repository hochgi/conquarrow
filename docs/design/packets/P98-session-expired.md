# P98 — An expired sign-in looks signed out

> **Not a game-rule change.** Web shell + pages adapter + the host port's
> sign-in bit. No `online-api` change. No production read or write. No new AWS.
> No session cookie.

**Status:** spec. **Depends on:** P95, P97. **Issue:** [#118](https://github.com/hochgi/conquarrow/issues/118).
**Spec:** [session-expired](../../spec/session-expired/session-expired.md).

## Symptom

After P97 (`086da51`), Android Chrome: the lobby shows **Sign out** on a Google
ID token that expired an hour ago. **Create invite** spins for about a second,
then the spinner vanishes and there is no link, no Copy button, and no error.
**My games** paints an unset library as "No games yet" when `GET /my-games`
answers 401. One Tap is often suppressed, and P97 mounts the GIS chooser slot
only while `signedIn()` is false, so the fallback has nowhere to render.

## Decisions (online BSSN — normative detail is the spec)

1. **Clear, don't pretend.** A token whose `exp` is missing, not a finite
   number, or not strictly after `deps.now()` is removed from the host store.
   `signedIn()` is then false. That is signed out, not the session-expired note.
2. **A 401 is a session expiry.** Every authenticated 401 clears the token, sets
   `sessionExpired()`, asks `gis.prompt()` even if `promptedFor` already names
   that token, and resolves. Held moves (P95 D10) stay held.
3. **Retry the create once.** A `POST /invites` answered 401 is posted once
   more when the next credential arrives on the lobby and the plan is still
   creatable. A second 401, a sign-out, or a credential off the lobby does not
   post again. The button is not merely re-offered.
4. **Empty is a 200.** "No games yet" only after a 200 with zero rows. A 401 is
   the session-expired note. Any other library failure is "Couldn't load your
   games — Retry".
5. **`REAUTH_LEAD_MS` is unchanged.** It also runs before a user-initiated
   authenticated request. It does not wait for the new credential, and it does
   not block the Sign in button.

## Out of scope

- A server session cookie or refresh token. Stays on the backlog.
- MCP OAuth. `online-api` handlers. SPEC.md.
