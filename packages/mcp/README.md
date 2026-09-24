# `@conquarrow/mcp`

Stdio MCP over `legalMoves` / `apply` / observation+findings — not a UI scrape and not raw `GameState`.

One live match per process. Seats are `human` or `heuristic`. The caller is not a seat kind.

## OpenCode stdio

```bash
pnpm --filter @conquarrow/mcp start
```

Add it as a local stdio server (one-liner; there is no second config format in this repo):

```bash
opencode mcp add --name conquarrow -- pnpm --filter @conquarrow/mcp start
```

Tools: `new_match`, `observe`, `legal_moves`, `apply_steps`, `end_turn`, `play_heuristic_turn`, `see_board`. No resources. Keys never leave the process.
