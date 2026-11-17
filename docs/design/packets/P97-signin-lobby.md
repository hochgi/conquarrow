# P97 — The lobby shows who is signed in

> **Not a game-rule change.** Web shell + GIS mount. No `online-api` change.
> No production read or write. No backfill.

**Status:** shipped 2026-11-17. Phone check still open. **Depends on:** P95, P96, ADR 0011.
**Spec:** [online-reliability D13](../../spec/online-reliability/online-reliability.md#d13--the-lobby-shows-who-is-signed-in-p97).

## Symptom

After P95 #115 and P96 #116, Android Chrome: picking a Google account leaves the
yellow "Sign in with Google" button up, Google's own "Sign in as …" button stays
and keeps re-offering, and My games never appears. Create invite works, so the
credential was stored and accepted.

Desktop Chrome, same deploy, without this fix: My games *shows*, and the list is
empty, although the player is seat A of a live game created from an invite while
the lobby still looked signed out.

## Cause

Recorded in the spec, before the fix. Short version: P95 moved the token to
`localStorage`, and the shell still reads `sessionStorage`. The live game is
indexed for the hash that created it. A missing stamp does not omit a row. The
empty list is an unset library painted as no games. **No backfill.**

## In scope

1. `OnlineHostPort.signedIn()` is the only sign-in bit. No `web/src` file reads
   the token key from `sessionStorage`. A leftover `sessionStorage` token is not
   migrated.
2. A credential on the lobby reads `/my-games` once. Sign-in state changes
   re-run that read only when it is due (`lobbyLibraryDue`), so the same sign-in
   does not send a second GET. Sign-out reports signed out and clears the library.
3. The GIS button mounts once in a React-owned `#conquarrow-gis-chooser`, only
   while signed out, and is never attached under `.lobby-online-row`. The web
   package stays without jsdom; the flicker is a manual phone check.

## Out of scope

- 401 on `GET /my-games` still leaves the library unset (P95). It looks empty.
  Not this packet.
- The seat list labelling an agent seat "you" (P93-a).
- MCP OAuth token-endpoint items.
