# ADR 0005 — A converted stack is spent for the capturing turn

**Status:** Accepted
**Date:** 2026-10-11
**Context:** [`SPEC.md`](../../SPEC.md) §6.3, §11 item 40, [P70](../design/packets/P70-convert-spent.md)

## Context

Item 40 set a converted stack's `spent` to 0 and dropped any merge override, so
the capturer could step it immediately. Playtest 2026-10-08: a cut converted a
1-stack and the capturer walked it onto an empty tile in the same turn. The
departure hid the flip. The human read the arriving head as a unit that had
always belonged to the capturer.

Slowing the animation alone leaves the same-turn walk, which is what erased the
place where the flip happened. Freezing the stack with a new status would sit
beside **box** (no legal exit) and invent a word the rules do not have.

## Decision

On convert, `spent` is set to `speed(heads)` and any merge override is dropped.
The stack has no step for the rest of the capturing turn. End of turn still
clears `spent`. A merge onto the stack is an ordinary merge and keeps that
`spent`.

The adapter amends the existing conversion overlay into a four-beat hand-off
and, on spectated playback only, holds until that hand-off has settled and then
500 ms more. The camera frames a converted stack that is outside the shot
before the colours trade.

## Consequences

A saved match that steps a converted stack on the capturing turn is no longer a
legal replay at that step. Bots are not offered the step. The victim's old
`spent` does not carry, and neither does a fresh allowance.
