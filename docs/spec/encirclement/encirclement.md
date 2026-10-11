# encirclement — conversion inside enemy territory

**Packet:** [P07 — Territory & encirclement](../../design/packets/P07-territory-encirclement.md)
**SPEC:** §6.3, §6.1 (anchor grades), §7 (closure seam), §11 items 9, 28, **40**
**Features:** [core](./encirclement.core.feature) · [edge cases](./encirclement.edge-cases.feature)
**Upstream:** [closure](../closure/closure.md) claims tiles; [cuts](../cuts/cuts.md) demote grade;
[encircled-path](../encircled-path/encircled-path.md) wipes victim trail on convert (P33)

## Purpose

P05b claims tiles and leaves enemy heads standing. This packet flips them when
the §6.3 predicate holds:

> An enemy head inside your territory with no **territory-grade** anchored trail
> is encircled, and converts.

## Scope

In: the state predicate, intact stack conversion, `spent` set to `speed(heads)` (P70),
order after combat → cut → closure, head conservation, grade shields, neutral
vs enemy stranded.

Out: accumulators (P08), victory (P09), combat modifiers (item 39 parked).
Convert-time trail **wipe** is [encircled-path](../encircled-path/encircled-path.md)
(P33). Cut-created dormant remains [trails-simple](../trails-simple/trails-simple.md).

Tests that need a fresh enclosure run on the **tiling**. Local grade cases may
use fixtures when territory is authored.

## Terms

| Term | Means |
|---|---|
| **encircled** | standing on another player's territory without territory-grade trail |
| **convert** | ownership flips to the territory owner; heads unchanged; `spent` is `speed(heads)`; no override |
| **territory grade** | trail connected to the owner's own territory (§6.1) |
| **stack grade** | trail anchored only on a stack — does **not** protect |

## How conversion resolves

```mermaid
flowchart TD
  Apply["apply step"] --> C["combat → cut → closure"]
  C --> Scan["scan groups in arrow-id order"]
  Scan --> P{"arrow is enemy territory<br/>for this group's owner?"}
  P -- no --> Next["next group"]
  P -- yes --> G{"owner has territory-grade<br/>trail covering this arrow?"}
  G -- yes --> Next
  G -- no --> Flip["flip owner to territory owner<br/>heads intact #59; spent = speed of heads #59; no override"]
  Flip --> Next
  Next --> More{"more groups?"}
  More -- yes --> Scan
  More -- no --> Wipe["then evaporate victim trail from each<br/>converted arrow halt-at-first — P33"]
```

## Invariants

- When a group stands on another player's territory and lacks territory-grade
  trail for its owner, the system shall convert it to the territory owner with
  the same head count.
- The system shall set `spent` to `speed` of the group's heads and drop any merge override on convert (P70).
- The system shall not convert a group whose trail is territory-grade for its owner.
- The system shall not convert a group on neutral ground or on its own territory.
- The system shall not let stack-grade or dormant trail protect inside enemy territory.
- When conversion runs, the system shall conserve total heads on the board for
  that pass.
- The system shall run conversion after combat, cut, and closure within one `apply`.
- When a group converts, the system shall evaporate the victim's trail from each
  converted arrow under halt-at-first (P33 / item 40).
- The system shall not mutate the input state, and shall return equal outputs for
  equal inputs.
- The system shall enumerate no vertex — **P37: measured as a delta.** Loss resolution sits on the tail of `apply` and reads the spawner lattice when a seat owns ground and holds no head, so this sentence can no longer be measured across a whole `apply`. The rule itself still reads no vertex: assert it as *no lattice read beyond an idle move on the same board*. See `docs/spec/immediate-loss/immediate-loss.md`. **This invariant has no test** — a pre-existing gap P37 did not create and does not close: there is no `vertexReads` assertion anywhere in the encirclement suite, so the delta note above is attached to a claim nothing currently checks. Conversion runs inside `apply`, so when it is asserted it will be a delta, not a hard zero.

## What this file deliberately does not decide

- **Accumulator reset on owner change** — P08.
- **Elimination / victory** — P09.
- **Territory combat modifiers** — §11 item 39.
- **Self-walk-in onto foreign territory** — P28 / §11 item 43 makes that step
  **illegal** rather than converting. The predicate here still runs on groups
  that become encircled on *another* player's apply.
- **Convert wipe of the encircled path** — P33.
