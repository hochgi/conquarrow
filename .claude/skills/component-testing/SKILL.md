---
name: component-testing
description: Committed component tests at a conquarrow I/O edge with @hochgi/test-kit — choosing the Goldilocks seam, one rig per test, probed S3 and probed mocks, failure injection by probe rule. Use when writing or reviewing an online-api test that probes S3Client or PostToConnection, or when deciding whether test-kit belongs in a package at all.
---

# component-testing — probed I/O edges

A component test runs the real component with its **leaf I/O seams** under a
probe the test can program, intercept and inspect. `@hochgi/test-kit` is that
probe. Here it lives only at I/O edges, because the rules engine has none.

## Where it may be used

- `packages/online-api` — the only consumer today, **devDependencies only**.
- `packages/mcp`, `packages/web` — only once they grow an injected I/O boundary.
- **Never** `packages/contracts`, `packages/rules-core`, `packages/geometry-*`
  — not in `src`, not in `test`. ESLint `no-restricted-imports` and
  `online-edge-probes.invariants.test.ts` ([CORE-CLEAN], [DEV-ONLY]) enforce it.

A rules-engine test that "needs a probe" is a design smell. The core is
`apply(state, move) -> state` with no I/O; a probe there would stand in for a
boundary that leaked into the core. Fix the boundary.

## Install

Already installed by P68:

```bash
pnpm --filter @conquarrow/online-api add -D @hochgi/test-kit @hochgi/test-kit-s3 @hochgi/test-kit-mock
```

- Node ≥ 22.
- `@hochgi/test-kit-s3` peers on `@aws-sdk/client-s3`, which is online-api's
  own production dependency. Its `@aws-sdk/s3-request-presigner` peer is
  optional and unused — leave it out.
- pnpm 11 refuses a release younger than `minimumReleaseAge` (24 h), so
  `pnpm-workspace.yaml` lists the three installed versions under
  `minimumReleaseAgeExclude`. A bump to a same-day release needs the same entry.

## This repo's Vitest

- Vitest `^2.1.8` with `globals: false`: import `describe`, `it`, `expect`,
  `beforeEach`, `afterEach` from `vitest`.
- No `@types/node` (it would leak `process` / `crypto` globals into the pure
  packages). A test that needs a Node module adds its minimal shape to
  `packages/online-api/test/node-shim.d.ts`.
- Files take the feature's name and the usual suffix —
  `<feature>.core.test.ts`, `.edge-cases.test.ts`, `.invariants.test.ts`,
  `.replay.test.ts` — with the rig factory in `<feature>.support.ts`. No `.kit`
  marker. Model: `packages/online-api/test/online-edge-probes.*`.
- One test per Gherkin scenario, as everywhere (`write-failing-tests`).

## Choose the seam (Goldilocks)

Probe the narrowest interface that hides infrastructure and leaves the logic
under test inside the component.

| | online-api | consequence |
|---|---|---|
| **Too thin** | `S3Client` injected into handlers; `ApiGatewayManagementApiClient` | tests build SDK commands, raw `Uint8Array` payloads, SDK exceptions |
| **Too fat** | a service that owns the If-Match retry, the conditional write and the notify fan-out | the logic you meant to test moved out of the component |
| **Just right** | handlers take `ObjectStore` and `PostToConnection` (`src/api-types.ts`) | the handler keeps version checks, `ifMatch` / `ifNoneMatch`, 410 cleanup |

So:

- **Handlers** keep `ObjectStore`, and `mapStore` in `test/support.ts` stays
  their default fake — a probe adds nothing a `Map` cannot answer. The ~30
  existing suites stay on it.
- **`createS3Store(bucket, client)`** (`src/s3-store.ts`) is code whose seam
  *is* `S3Client`: probe it with `createProbedS3Adapter`. Likewise a flow that
  must prove the real store composes with the handlers.
- **`PostToConnection`** is a function type, and `createProbedMock<T>` needs an
  interface of Promise-returning methods: wrap it (`ConnectionNotifier` below).
  `createAwsPostToConnection` (`src/http.ts`) is too thin and reads `env` at
  import — out of scope.
- **Synchronous deps** (`clock`, `randomBytes`, the heuristic) are not I/O, and
  `google`'s deterministic `fakeGoogle` already answers every scenario. Pass the real or a scripted function; `createProbedMock`
  rejects sync methods at compile time anyway.

Checklist: exposes status codes, raw bytes or SDK errors → too thin. Owns the
retry, orchestration or rule you want to test → too fat. Programmable without
conjuring infrastructure → right.

## The rig factory

One `createRig()` per test owns every probed adapter; `rig.attach(...)`
registers each for teardown. The factory option is spelled `harness: rig`.
From `test/online-edge-probes.support.ts`:

```ts
export const BUCKET = 'match-bucket';

/** `PostToConnection` narrowed to `Promise<200 | 410>` — the shape createProbedMock can probe. */
export interface ConnectionNotifier {
  post(connectionId: string, payload: StateChangedPayload): Promise<200 | 410>;
}

export const createEdgeRig = (): EdgeRig => {
  const rig = createRig();
  const s3 = rig.attach(createProbedS3Adapter({ harness: rig, bucket: BUCKET }));
  return { rig, s3, store: createS3Store(BUCKET, s3.adapter), close: () => rig.close() };
};

export const attachNotifier = (edge: EdgeRig): ProbedMock<ConnectionNotifier> =>
  edge.rig.attach(createProbedMock<ConnectionNotifier>({ harness: edge.rig, methods: ['post'] }));

export const notifierPort =
  (notifier: ProbedMock<ConnectionNotifier>): PostToConnection =>
  (connectionId, payload) =>
    notifier.adapter.post(connectionId, payload);
```

```ts
let edge: EdgeRig;

beforeEach(() => {
  edge = createEdgeRig();
});

afterEach(async () => {
  await edge.close();
});
```

- **Disposable.** A fresh rig per `it`, closed in `afterEach` or `finally`
  (`withEdgeRig` in the invariants suite does the latter for `it.each`). A
  closed rig throws `"Harness is closed."` on late registration — library text.
- **Leaves only.** The real store, the handlers and `notifyOthers` are built
  from adapters; only the leaf seams are probed.
- **Seed, then clear.** Write fixtures through the probed client, then
  `probe.clearCalls()`, so call-log assertions see only the When (`seedBacking`).
- **Backed vs mock.** The probed S3 is *backed*: a rig-installed
  `always().forward()` sends every command to the in-memory backing — ETag is
  the quoted MD5, `IfMatch` / `IfNoneMatch` fail with 412, a missing key is
  `NoSuchKey`, `ListObjectsV2` pages cap at 1000. A probed mock has no backing:
  a call no rule matches **parks** with no timer of its own. The 30 s safety
  timeout bounds waiters (`intercept`, `observe`, `atLeast`), not parked calls,
  and `rig.close()` does not settle them — an unprogrammed post hangs the When
  until Vitest's 5 s test timeout. Program `post` before the When.

## Porcelain and plumbing

Selections: `s3.probe.command(PutObjectCommand)` (typed by constructor),
`s3.probe.command('ListObjectsV2Command')` (by name, untyped),
`notifier.probe.on('post')`, and `.filter(predicate, label)` on any of them.
Label every filter — the label is what a timeout message names.

Porcelain — standing behaviour:

```ts
notifier.probe.on('post').always().answer(200);
notifier.probe
  .on('post')
  .filter((call) => call.args[0] === BOB_CONN, `connectionId === '${BOB_CONN}'`)
  .always()
  .answer(410);
```

Plumbing — one-shot rules, consumed in order:

```ts
edge.s3.probe.command(ListObjectsV2Command).once().forward(); // page 1 reaches the backing
edge.s3.probe.command(ListObjectsV2Command).once().reject(failure); // page 2 fails
```

Rule resolution runs in three tiers:

1. **Live waiters**, FIFO — `expect.observe` is notified and does not consume;
   `expect.intercept` captures, and the test owns settlement.
2. **`once()` rules** — one global FIFO queue across every selection. A
   matching one-shot beats every `always()`.
3. **`always()` rules** — a LIFO stack; the newest match wins, the rig's
   default forward sits at the bottom. That is why the 410 rule above,
   registered second, wins for `BOB_CONN` and 200 answers everyone else.

Nothing matched: a mock parks; a backed adapter takes its default forward.

## Failure injection

Through probe rules — never a new hand-written fake.

**Real SDK errors.** Reject with an `S3ServiceException` carrying `name` and
`$metadata.httpStatusCode`, the shape the SDK throws and `src/s3-store.ts`
inspects (`s3Error` in the support file):

```ts
export const s3Error = (name: string, status?: number): S3ServiceException =>
  new S3ServiceException({
    name,
    $fault: status !== undefined && status >= 500 ? 'server' : 'client',
    $metadata: status === undefined ? {} : { httpStatusCode: status },
    message: `${name} (${status === undefined ? 'no status' : String(status)})`,
  });

edge.s3.probe.command(GetObjectCommand).once().reject(s3Error('NotFound', 404));
```

**Intercept, race, forward.** Hold a call in flight, change the world, then let
it reach the backing:

```ts
const held = edge.s3.probe
  .command(PutObjectCommand)
  .filter((call) => call.command.input.Key === K1, `Key === '${K1}'`)
  .expect.intercept();

const outcome = rejectionOf(Promise.resolve(edge.store.put(K1, 'mine', { ifMatch: 'v0' })));
const pending = await held;
await rawPut(edge, K1, 'theirs'); // another writer: the real ETag moves
pending.forward();

expect(await outcome).toBeInstanceOf(PreconditionFailed);
```

- Pass `{ within: seconds(2) }` to `intercept` when it might not match: the
  kit's default wait and Vitest's test timeout are both 5 s, and only the kit's
  error names the filter that failed.
- Register the intercept **before** the When. A call the default forward has
  already settled cannot be intercepted retroactively; only a call that parked
  because no rule matched can.
- Start the When unawaited and attach its rejection handler at once
  (`rejectionOf`), so it cannot surface as unhandled between steps.

**Mixed outcomes.** A filtered `always()` over an unfiltered one (above), or
`answerWith((call) => …)` discriminating on `call.args`.

**Park.** `always().park()`, or an intercept you never settle, lets a
component's own timeout fire. Nothing in online-api owns a timer today:
`notifyOthers` awaits each post with no timeout, so a parked post holds the
move response open indefinitely (in a test, Vitest's timeout is the only
bound). That is a P68 open item, not a
test to write.

## Assertions

Synchronous, on recorded history — prefer these once the When is awaited:

```ts
edge.s3.probe.command(PutObjectCommand).expect.neverCalled();
edge.s3.probe.command(ListObjectsV2Command).expect.calledTimes(3);
const puts = edge.s3.probe.command(PutObjectCommand).calls;
expect(puts[0]?.command.input.IfMatch).toBe(etagOfV0);
expect(notifier.probe.on('post').calls.map((call) => call.args[0])).toEqual([BOB_CONN]);
const order = edge.s3.probe.calls.map((call) => call.commandName); // cross-command order
```

Live, returning promises and waiting real time: `intercept`, `observe`,
`atLeast(n)`. `none` and `exactly(n)` **require** `within`, because their
meaning is a window — and they cost the whole window:

```ts
await notifier.probe.on('post').expect.none({ within: milliseconds(50) });
```

Cross-probe order: `rig.expect.sequence([...], { within })` and
`rig.expect.allOf([...], { within })`.

## Fake timers

Only when a component under test owns a timer — none in online-api today.
`createRig()` auto-detects `vi.useFakeTimers()`; drive the component with
`await rig.clock.advance(milliseconds(n))`. test-kit's own waiter deadlines and
safety timeout always run on real time, so a forgotten advance fails fast
rather than hanging, and `expect.none` never advances virtual time. Attach the
`.catch` to the component's promise before advancing.

Streaming (`createProbedStreamMock`) and SQL probes (`@hochgi/test-kit-pg-*`)
exist upstream; conquarrow has neither seam.

## Known gaps (upstream `hochgi/test-kit`)

Report these upstream (P68: list them in the PR); do not paper over them with
a local fake.

- **`ForwardableSelection.filter()` returns a plain `Selection`**, so
  `probe.command(X).filter(…).once()` has no `.forward()` in its type. Use an
  unfiltered `command(X).once().forward()` (one-shot order does the
  selecting), or `filter(…).expect.intercept()` then `pending.forward()`.
- **`S3Call.input` is `unknown`.** Read `call.command.input` off a
  `command(Ctor)` selection for the typed copy.
- **Forwarded responses are not recorded on `.calls`.** To assert on what the
  backing answered (say `NextContinuationToken`), re-derive it from the
  unchanged backing — see the listing test in `online-edge-probes.core.test.ts`.
