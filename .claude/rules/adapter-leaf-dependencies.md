---
paths:
  - "packages/online-api/src/**/*.ts"
  - "packages/mcp/src/**/*.ts"
  - "packages/web/src/**/*.{ts,tsx}"
description: Composite adapters vs thin injected I/O leaves in online-api, mcp and web
globs: packages/online-api/src/**/*.ts,packages/mcp/src/**/*.ts,packages/web/src/**/*.ts,packages/web/src/**/*.tsx
alwaysApply: false
---

# Adapter leaf dependencies

The adapters' half of BSSN (AGENTS.md). The core has no I/O at all; at the edge,
I/O is allowed but lives in **leaves**.

- **Composites** hold orchestration and domain logic and *receive* their I/O:
  the handlers in `online-api` (`handlers.ts`, `game-handlers.ts`, `notify.ts`),
  bot orchestration in `web`.
- A **leaf** does one kind of I/O — object store, HTTP call, WebSocket post,
  browser storage, an LLM endpoint — and speaks DTO in, DTO out. It stays thin:
  it maps SDK errors to domain values (`s3-store.ts` → `PreconditionFailed`) and
  leaves game logic, fallback orchestration and HTTP-status choices to its
  caller. Today's leaves: `ObjectStore` (`s3-store.ts`), `PostToConnection`,
  `GoogleVerifier` (`google-tokeninfo.ts`), the `fetchImpl` seam in `byokBot.ts`.
- Inject leaves through the deps object or factory parameter — `OnlineApiDeps`,
  `TokenInfoDeps`, `createS3Store(bucket, client)`. A clock is I/O here too:
  inject `clock: () => number` as `TokenInfoDeps` does.
- SDK clients, `fetch` and generated API classes are built inside a leaf
  factory or at the composition root (`http.ts`, `create-online-*.ts`), and
  composites receive them ready-made. A default parameter on the leaf factory
  (`client = new S3Client({})`, `fetchImpl = fetch`) is the accepted shortcut.
- Give a real external boundary an interface even with one caller: it is the
  seam `component-testing` probes with `createProbedMock`, and that skill's
  Goldilocks rule picks its level. Pure helpers and in-memory logic get plain
  functions.
