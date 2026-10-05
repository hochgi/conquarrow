# P24 — Delivery harness

> **Status:** landing (tooling). Not a rules packet. **Skips** the four-phase
> Gherkin loop (`spec-to-ship` "when NOT to run the full pipeline").
>
> **Layer:** tooling / docs. **Depends on:** nothing. **Unblocks:** disciplined
> `/spec-to-ship` of P14 then P16–P19.

## Intent

Make this repo safe to grow past playtest: same pipeline as cycle-processing
where it pays, without publishing org-private test-kit.

- Cursor subagents pin `cursor-grok-4.6-xhigh` (Claude Code agents stay `opus`).
- Stryker on `packages/rules-core/src` (`break: null`, local, not CI).
- CRAP report (`pnpm crap`) advisory; boy-scout files you touch.
- Complexity ESLint **warn** on core/geometry (≤12 / depth 4 / 80 lines / 5 params).
  Eventual gate is raw complexity, not CRAP — coverage can hide a god function.
- `pnpm verify` CI on push/PR; pre-push runs verify + local-hygiene.
- Never-pushed `local-main` may carry `@vnatures/test-kit` and `*.kit.test.ts`.
  Committed spec-to-ship tests stay plain Vitest against ports.

> **Superseded by P68:** test-kit is public (`@hochgi/test-kit*`), so the
> `local-main` overlay, the `local-hygiene` pre-push command and
> `scripts/check-local-hygiene.sh` are retired; pre-push runs `pnpm verify` only.

## Out of scope

- Flipping complexity to `error` (later, when hotspots shrink).
- Mutating `packages/web` or a not-yet-existing `online-api`.
- Copying cycle-processing's skill-sync / Turbo / Prettier / CRAP CI gate.
- Writing Gherkin for this packet.

## Done when

- Four `.cursor/agents/` frontmatters agree on the Grok slug.
- `pnpm verify` is green (warnings allowed).
- `scripts/check-local-hygiene.sh` refuses `local-main` and test-kit manifests.
- Packet index lists P24 and the online track in ship order.
