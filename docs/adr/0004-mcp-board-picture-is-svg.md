# ADR 0004 — The MCP board picture is SVG; the caller rasterizes

**Status:** Accepted
**Date:** 2026-09-24
**Context:** [P67](../design/packets/P67-conquarrow-mcp.md), [ADR 0003](./0003-pages-direct-byok.md)

P67 is a local stdio adapter over `rules-core`, not a drive of Pages. A tool caller still needs to look at the match window. The board today is a React SVG (`Board.tsx`). There is no PNG path. ImageMagick on a dev machine can rasterize a simple SVG, and it has no `rsvg` delegate, so a gradient-heavy board SVG may not survive the conversion.

**Decision:** `see_board` returns a simple SVG of the match `R`-window, drawn from state: flat fills and strokes, every arrow, trail, territory, and spawner in that window. The seat id only highlights that seat's groups. The same state and seat id produce the same SVG. The server does not rasterize, shell out, scrape, or launch a browser. A caller that wants to look converts the SVG itself. The picture is not a legal-move offer. `observe` keeps its caps.

## Considered options

- **Server returns a PNG** via a vendored rasterizer. Rejected: a new dependency for a step the caller can do, and CI would grow a renderer.
- **Server shells out to ImageMagick.** Rejected: a host binary. Tests and any other machine must not need it.
- **Screenshot Pages.** Rejected: that is the scrape this packet forbids.
- **Import `Board.tsx`.** Rejected: React, pointer handlers, and gradients. The MCP process has no DOM.

## Consequences

- Vision reasoning is a caller step, not a tool result.
- The SVG must stay simple enough that a non-`rsvg` converter can draw it.
- JSON tools still must not return the full spawner array. The picture is allowed to show the window those tools cap.
