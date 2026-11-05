# language: en
# Overview: docs/spec/chord-test/chord-test.md
# SPEC §2 (chord test), §7 (self-crossing; fill is reachability — item 36), §11 item 1

Feature: The chord test — totality, symmetry and the cases that unify
  As the rules core
  I want the chord test total, symmetric and blind to the orientation pattern
  So that combat never depends on argument order and P03 cannot invalidate it

  Background:
    Given a point with six arrow slots numbered 0 to 5 in cyclic order

  Rule: The test is total and symmetric

    Interleaving and coincidence are both symmetric relations, so a verdict that
    changed with argument order would make combat depend on which trail the
    engine happened to examine first. That is exactly the iteration-order
    determinism failure ADR 0001 names as the realistic one.

    Scenario: Every ordered pair of chords has a verdict
      When I apply the chord test to every ordered pair of the 15 distinct chords
      Then all 225 pairs return a verdict
      And no pair raises an error
      # 6 slots give 15 distinct chords. A *layout* — which three slots are
      # in-slots — makes only 9 of them realizable as a transit, so 81 pairs
      # are the ones the game can actually reach. The function is total over
      # all 225 precisely so it does not need to know the layout.

    Scenario: Swapping the arguments does not change the verdict
      When I apply the chord test to every ordered pair of the 15 distinct chords
      Then the verdict for each pair equals the verdict for its reverse

    Scenario Outline: Both candidate layouts realize exactly 81 reachable pairs
      Given the orientation pattern is <pattern>
      When I enumerate the chords a transit can draw
      Then there are exactly 9
      And every ordered pair of them returns a verdict

      Examples:
        | pattern            | in-slots |
        | alternating        | 0, 2, 4  |
        | three-consecutive  | 0, 1, 2  |

    Scenario: A chord crosses itself
      Given red draws a chord between slots 0 and 3
      And blue draws a chord between slots 0 and 3
      When I apply the chord test
      Then blue crosses red
      # Coincidence at both endpoints — the degenerate case §6.1's cut check
      # relies on. It is NOT an interleave, so §7 reads no inversion from it.

  Rule: The verdict depends only on cyclic order

    SPEC §11 item 1 is resolved — in-slots alternate with out-slots — and this
    Rule stays anyway. Layout independence is what makes the predicate total
    over all 15 chords rather than the 9 a layout realizes, so the
    three-consecutive rows below are a COUNTERFACTUAL, not a live candidate.
    They are the assertion that the test never asks which slots are in-slots.

    Scenario: Rotating every slot label leaves the verdicts unchanged
      When I rotate all six slot labels by one position
      And I apply the chord test to every ordered pair of the 9 possible chords
      Then every verdict is unchanged

    Scenario: Reflecting the slot order leaves the verdicts unchanged
      When I reverse the cyclic order of the six slots
      And I apply the chord test to every ordered pair of the 9 possible chords
      Then every verdict is unchanged

    Scenario: The test never asks which slots are in-slots
      When I inspect the chord test's inputs
      Then it takes only two chords and the cyclic slot order
      And it takes no direction information

  Rule: The three behaviours the test must permit

    These are not extra rules. They are consequences of testing the exit choice
    rather than the arrival, and each would be lost if the test fired on contact.

    Scenario: A head may shadow an enemy trail through a shared point
      Given red draws a chord between slots 0 and 3
      And blue draws a chord between slots 4 and 5
      When I apply the chord test
      Then blue does not cross red
      # Blue transited the very point red's trail runs through, and nothing
      # happened. It may do this point after point, choosing its moment.

    Scenario: Two trails may run parallel through the same corridor
      Given red draws a chord between slots 0 and 3
      And blue draws a chord between slots 1 and 2
      When I apply the chord test
      Then blue does not cross red

    Scenario: A defender may hold a contested point without committing
      Given red draws a chord between slots 0 and 3
      And blue has arrived at the point but has not chosen an exit
      When I apply the chord test
      Then no verdict is produced
      And no combat is triggered
      # Crossing is a decision. Arriving is not one.

  Rule: One predicate, and §7 asks the narrower half of it

    The enemy cut (§6.1) wants the full verdict: interleave OR coincide. Combat
    reads no chord: it resolves on the destination arrow (SPEC §6.2, item 37).
    Fill reads no chord: it is reachability, not parity (SPEC §7, item 36).

    # Superseded by item 37 in part: only the cut caller reads the verdict; combat resolves on the destination arrow (SPEC §6.2).
    Scenario Outline: The full verdict serves the cut and combat callers
      Given two chords that <relation>
      When the cut check in §6.1 applies the chord test
      Then the verdict is <verdict>

      Examples:
        | relation      | verdict     |
        | interleave    | crossing    |
        | coincide      | crossing    |
        | turn aside    | no crossing |

    # Superseded by item 36: fill is reachability, not parity, and reads no chord (SPEC §7).
    Scenario Outline: Even-odd fill inverts on interleave alone
      Given two chords of one player's own trail that <relation>
      When §7 asks whether the lobes invert
      Then the answer is <inverts>

      Examples:
        | relation      | inverts |
        | interleave    | yes     |
        | coincide      | no      |
        | turn aside    | no      |
