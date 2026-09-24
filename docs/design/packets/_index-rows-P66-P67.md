# Index rows to paste into `docs/design/02-work-packets.md`

Replace the P64 / P65 / P20+ block in the packet index, and add the mermaid edges.

```
| P64 | BYOK hint, threat, plan | web | — | P63 | **[packet](./packets/P64-byok-hint-and-threat.md).** Tags are hints; one threat line; baseline names lump close/cut; persist + echo `plan`; tip-local spawners. Landed teaching+header; 2026-09-10 playtest showed plan echo of a tag-chase and two 0-share dirt closes. |
| P65 | Quiet-home leftover pass | web | — | P59 | **[packet](./packets/P65-quiet-home-pass.md).** 3-seat BSSN 20: a ready 2⁺ stack with leftover speed may not pass when a contest-advancing complete exists. Amends mission-and-staging. 2026-09-10: A r3 walked. |
| P66 | BYOK plan budget + dirt | web | — | P64 | **[packet](./packets/P66-byok-plan-budget-and-dirt.md).** Plan cap 80→512; `closes` without `share+N` is dirt; plan that names a tag is wrong; header dirt clause. Fixture: 2026-09-10 hits 5 / 9 / 13. Handoff for `/spec-to-ship`. |
| P67 | Conquarrow MCP | adapter | — | P01, P21, P64, P66 | **[packet](./packets/P67-conquarrow-mcp.md).** Stdio MCP over `legalMoves` / `apply` / observation+findings. Not a UI scrape, not raw `GameState`, not a Pages BYOK replacement. After P66 teaching lock. Handoff for `/spec-to-ship`. |
| P20+ | Deferred follow-ons | — | — | — | **[packet](./packets/P20-deferred-online-followons.md).** Viewers, fork, arena, replay button, Elo, online BYOK, under-18 GIS, admin panel |
```

Mermaid (after `P59 --> P65`):

```
  P64 --> P66["P66 plan budget + dirt"]
  P66 --> P67["P67 MCP"]
  P21 --> P67
```
