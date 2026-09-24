# Index row to paste into `docs/design/02-work-packets.md`

P66 already landed (`#57`). Add this row after P66 (or after P64/P65 if the
index still lags). Do not rewrite the whole 35k index in this handoff.

```
| P67 | Conquarrow MCP | adapter | — | P01, P03, P09, P21, P38, P53, P64, P66 | **[packet](./packets/P67-conquarrow-mcp.md).** Stdio MCP over `legalMoves` / `apply` / observation+findings. Not a UI scrape, not raw `GameState`, not a Pages BYOK replacement. After P66 teaching lock. |
```

Mermaid (after the P64 → P66 edge, or next to `P21`):

```
  P66 --> P67["P67 MCP"]
  P21 --> P67
```
