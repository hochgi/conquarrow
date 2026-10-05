# P68 — test-kit at the I/O edges

**Local agent handoff:** `/spec-to-ship docs/design/packets/P68-test-kit-at-the-edges.md`

Phase 1 writes a **new** spec directory
[`docs/spec/online-edge-probes/`](../../spec/online-edge-probes/)
(core + edge-cases `.feature`, mermaid, EARS). Do not edit the
P17 / P18 / P45 / P49 spec dirs — this packet characterises their
shipped behaviour through a second store, it does not re-spec it.

**Layer:** tooling + online adapter tests. **Depends on P17, P18, P24.**
**No game rule is added, changed, or implied. No product behaviour
changes** — `packages/online-api/src` is read, not edited, except for a
defect the new tests expose (none expected; if one appears it is an
escalate, not a silent fix).

## Why this exists

The private `@vnatures/test-kit` was open-sourced as `@hochgi/test-kit*` on
public npm (MIT, provenance). P24 kept it off every pushed branch because it
was org-private: a never-pushed `local-main` overlay, a `local-hygiene`
pre-push hook, and `scripts/check-local-hygiene.sh`. That reason is gone, so
the policy is obsolete.

What it leaves behind is a real gap. Every `online-api` suite runs against
`mapStore` in `test/support.ts` — a hand-rolled `ObjectStore`. The production
store, `createS3Store` in `src/s3-store.ts`, is never executed by a test. Its
whole job is the part `mapStore` cannot model:

- mapping the SDK's `NoSuchKey` / 404 to `undefined`;
- mapping 412 / 409 to `PreconditionFailed`, including the `ifMatch`
  read-compare-then-conditional-put dance against a real ETag;
- following `ListObjectsV2` continuation tokens past the 1000-key page cap.

`notifyOthers` in `src/notify.ts` is likewise tested only through a recording
function, never through a probe that can answer one connection 410 and reject
another.

`@hochgi/test-kit-s3` gives a real `S3Client` with an in-memory backing that
models exactly those three things (ETag = quoted MD5, conditional
`IfMatch` / `IfNoneMatch`, real pagination with a hard 1000 cap).
`@hochgi/test-kit-mock` gives a probed fake for `PostToConnection`.

## Scope

### a. Retire the local-only policy

- **AGENTS.md** — rewrite the test-layer section: test-kit is a **committed**
  fourth layer, used **only at I/O edges** — `packages/online-api` today;
  `packages/mcp` / `packages/web` only if they grow an injected I/O boundary.
  **Never** in `packages/contracts`, `packages/rules-core` or
  `packages/geometry-*`. The purity blinker is unchanged.
- Remove the `### local-main overlay` section and every "never push
  `local-main`" clause. `shalevhoch` stays forbidden.
- **lefthook.yml** — remove the `local-hygiene` pre-push command; keep `verify`.
- Delete `scripts/check-local-hygiene.sh`.
- Fix every mention in `CLAUDE.md`, `CURSOR.md`, `OPENCODE.md`,
  `.cursor/rules/*.mdc`, `.cursor/agents/*`, `.claude/agents/*`,
  `.claude/commands/*`, `.opencode/agent/*`, `.opencode/command/*`, and
  `.claude/skills/*` (`spec-to-ship`, `write-failing-tests`, `code-to-green`,
  `review-changes`, `mutation-testing`).
- Shipped packets keep their history: P24 and P17 get a one-line
  *superseded by P68* note, and P24's index row says the overlay is retired.

### b. Add the dependencies

`@hochgi/test-kit`, `@hochgi/test-kit-s3`, `@hochgi/test-kit-mock` as
**devDependencies of `@conquarrow/online-api` only**, via `pnpm add -D`, caret
ranges on the versions `npm view` reports at implementation time (2026-10-05:
`^2.0.5`, `^2.0.3`, `^2.0.2`). The `@aws-sdk/client-s3` peer is the existing
`online-api` dependency. The presigner peer is optional and unused — do not
add it. No install scripts, so `onlyBuiltDependencies` is unchanged. Lockfile
churn is limited to these three packages.

pnpm 11 refuses a version younger than its default `minimumReleaseAge`
(24 h), and these were published on 2026-10-05. `pnpm-workspace.yaml` therefore
carries a `minimumReleaseAgeExclude` entry for the three exact versions
(BSSN). It is harmless once they age past the window and may be dropped in any
later dependency bump; `--frozen-lockfile` installs in CI do not re-resolve.

### c. Component tests in `online-api`, at the Goldilocks boundary

- `createS3Store(bucket, s3.adapter)` against `createProbedS3Adapter`:
  NoSuchKey / 404 → `undefined`; 412 / 409 → `PreconditionFailed` including
  `ifMatch`; `ListObjectsV2` continuation; one handler flow end to end through
  `createOnlineApi` with the real store.
- `notifyOthers` through `createProbedMock` for `PostToConnection`: who is
  notified, who is not, and the 410 Gone stale-connection cleanup.
- Failure injection uses probe rules (`once().reject`, `expect.intercept`),
  **not** new hand-written fakes.
- Scenarios come from existing behaviour (P17 / P18 specs and the code).

### d. Port test-kit's `component-testing` skill

From `~/dev_ext/test-kit/.cursor/skills/component-testing/SKILL.md` to
`.claude/skills/component-testing/SKILL.md` — the canonical skills location;
Cursor and OpenCode read `.claude/skills/` (CURSOR.md "Skills"). Adapted for a
consumer repo; every API snippet checked against the installed `.d.ts`.
Referenced from `write-failing-tests` and `code-to-green`.

### e. Guard the core

A cheap, mechanical guard that test-kit never reaches the pure packages:
an ESLint `no-restricted-imports` pattern on
`packages/{contracts,rules-core,geometry-*}/**`, and a committed test that no
pure package's manifest names test-kit.

## BSSN decided here

1. **Packet number P68**, spec dir `docs/spec/online-edge-probes/`.
2. **File names.** test-kit tests are ordinary committed Vitest and take the
   repo's existing suffixes — `online-edge-probes.core.test.ts`,
   `.edge-cases.test.ts`, `.invariants.test.ts` — with the rig factory in
   `online-edge-probes.support.ts` (the `game-library.support.ts` shape). The
   `*.kit.test.ts` suffix is retired with the overlay: a suffix that marks
   "uses a library" ages badly, and the scenario's feature name is what a
   reader searches for.
3. **Which boundary is probed.** Handlers keep `ObjectStore` as their seam and
   `mapStore` stays the default fake for the existing ~30 suites. The
   `S3Client` seam is probed only where the code under test *is* the S3
   adapter (`createS3Store`) or where a flow must prove the real adapter
   composes with the handlers. Rewriting the existing suites onto test-kit is
   **out of scope**.
4. **`PostToConnection` is the probed seam, not
   `ApiGatewayManagementApiClient`.** The management client is too thin
   (raw `Uint8Array` payloads, SDK exceptions); `createAwsPostToConnection` in
   `src/http.ts` maps it to `200 | 410` and lives in a Lambda entry module
   that reads `env` at import. Probing it is out of scope.
5. **Characterisation, not red.** Section c encodes shipped behaviour, so
   those tests pass on arrival. Phase 2 proves each is *able* to fail: the
   test-author mutates the guarded production line by hand (e.g. drop the
   `status === 410` branch, drop the continuation loop) and records that the
   test went red, then reverts. Sections a and e are genuinely new and are
   red until phase 3.
6. **The guard is lint plus a manifest test**, not a programmatic ESLint run:
   typed lint over a synthetic file needs a tsconfig the file is not in.

## Open — noted, not fixed here

- `notifyOthers` awaits each `PostToConnection` with no timeout. A post that
  never settles holds the move response open (the API Gateway integration
  timeout is the only bound). This packet observes it only as context; it is
  a product-behaviour change and belongs to a later online packet.

## Out of scope

- Converting existing `online-api` suites from `mapStore` to test-kit.
- Stryker on `online-api`.
- test-kit in `packages/mcp` or `packages/web` (allowed by policy, not needed).
- Any change to `src/s3-store.ts`, `src/notify.ts`, or handler behaviour.

## Done when

- `pnpm verify` is green; the pre-push hook runs `verify` only.
- `git grep` finds no live `local-main` / `local-hygiene` / `@vnatures/test-kit`
  policy text outside shipped-packet history.
- The three devDependencies are in `packages/online-api/package.json` only,
  and the lockfile diff names only them.
- Every scenario in `docs/spec/online-edge-probes/` has one test.
- `.claude/skills/component-testing/SKILL.md` exists, is referenced from
  `write-failing-tests` and `code-to-green`, and every snippet compiles
  against the installed packages.
- Any published test-kit API that is wrong or missing for a scenario is listed
  in the PR as an upstream issue for `hochgi/test-kit`, not worked around.
