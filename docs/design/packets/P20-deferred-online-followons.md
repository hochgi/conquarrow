# P20+ — Deferred follow-ons

> **Status:** parked. Written wishes, not in the first online cut.
> Do not invent details here during P16–P19.

| Wish | Notes |
|---|---|
| **Viewers** | Extra people on an invite become read-only. Rejected in MVP (409 full). |
| **Fork** | Copy state (+ optional log prefix) into a **new** group with remapped seats (`userHash \| heuristic`). Original untouched. |
| **Arena** | Open list of joinable lobbies (not ranked matchmaking). Invite-only is enough until friends-and-family play exists. |
| **Replay button** | On a finished game URL: auto-play the log, speed control, hide legal-move HUD. Engine already has `replay()`. Not free UI; members can already open the final position in P19. |
| **Elo / leaderboard** | Shape completed `meta.json` in P17/P18 so this can compute later. Do not ship ratings in v1. |
| **Online BYOK / hosted LLM** | Parked. Local Pages-direct BYOK is ADR 0003. Online extras stay heuristic. A Lambda pump is only if CORS-ok BYOK fails or we later want LLM chairs after every tab is gone. |
| Visual juice / onboarding | Accessibility over elegance (old critique). |
| Search AI (non-LLM) | BYOK local may postpone this a long time. |
| Seats other than 3/6 | Playtest found 2 unfair on grain. Not online v1. |
| Under-18 Sign-In | Google Family Link / under-18 blocks GIS ID tokens. Publishing OAuth to Production lets any 18+ Gmail in (no Test users). Designed-for-families is compliance, not a code packet. |
| Admin panel | Family scale: S3 `conquarrow/` prefixes + CloudWatch. No extra AWS app. |
