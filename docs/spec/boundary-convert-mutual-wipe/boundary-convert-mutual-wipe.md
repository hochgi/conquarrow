# boundary-convert-mutual-wipe — conversion at the round boundary; a mutual wipe does not land

**Packet:** [P89](../../design/packets/P89-boundary-convert-mutual-wipe.md)
**SPEC:** §6.2 (outcomes, *both wiped*), §6.3 (when conversion is judged), §7 (the accrual tick)
**Features:** [core](./boundary-convert-mutual-wipe.core.feature)
**Upstream:** [spec-alignment](../spec-alignment/spec-alignment.md) (P88), [birth-cut](../birth-cut/birth-cut.md), [encircled-path](../encircled-path/encircled-path.md)

## The rules

1. **Both wiped is A = 0** (§6.2). A step whose battle wipes both sides does
   not land. No mark is left, and no crossing cut or territory-root cut
   follows from a mark. Nothing is claimed. The defender's stack is wiped,
   so its owner's trail evaporates from that arrow (§6.1, combat wipe). The
   attacker's stepping heads never stood on the arrow, so no wipe of the
   attacker's trail runs. The stay-behind stays on `from`.
2. **Conversion at the round boundary** (§6.3, §7). When `endTurn` closes a
   full round, the order is: accrual and births, then birth-cuts, then
   `convertEncircled` (with its convert wipe), then the starvation tick and
   loss resolution. An `endTurn` that does not close a round converts
   nothing, because nothing on the board changed.

## Decisions (BSSN)

1. **One `landed` flag.** In `applyStep`, `landed` is true when there was no
   contact, or when the defender is wiped and the attacker has heads left.
   The mutual-wipe branch sets it to false and records only the defender's
   wipe. Everything that P88 guards on `landed` (mark, crossing cut, root
   cut after a mark, closure, claim root cuts) follows from that flag.
2. **Conversion runs only where the board changed.** It runs after the
   round-boundary accrual and nowhere else in `endTurn`. The P51 scenarios
   ("a turn in which nothing stepped converts nothing") end a turn that
   does not close a round, and they stay true.
3. **A boundary conversion spends the stack as any conversion does.** ADR 0005
   sets `spent = speed(heads)` on every convert, so a stack converted at the
   boundary cannot step in the turn that follows. That matters only when its
   new owner is `players[0]`, whose turn comes next. Every other turn ends
   with `spent` cleared as usual. This is no new rule: ADR 0005 applied where
   the conversion happens.
4. **Conversion runs before the starvation tick.** A conversion changes
   heads, and §9 resolves losses at that tick on the board it reads.

## Invariants (EARS)

1. When a battle wipes both sides, the system shall leave the attacker's
   trail and territory unchanged and every other player's trail unchanged,
   except for the evaporation from the defender's wiped arrow.
2. When `endTurn` closes a full round, the system shall leave no stack
   standing on another player's territory without a life line.
3. When `endTurn` does not close a full round, the system shall leave
   ownership of every group unchanged.
4. The system shall not mutate the input state, and shall return equal
   outputs for equal inputs.

## Counts

Core: 5 scenarios. Invariants: 4.
