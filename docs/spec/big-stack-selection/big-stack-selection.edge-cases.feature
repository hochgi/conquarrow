# language: en
# Overview: docs/spec/big-stack-selection/big-stack-selection.md
# Packet P99 — big-stack selection lag, edge cases

Feature: The portion walk stays inside the engine's answers
  As a player whose carry is not the whole stack, or whose hop the engine refuses
  I want the wash and the portion reach to follow that carry and that refusal
  So that a faster walk is not a different game

  Background:
    Given the generated tiling
    And a RulesPort whose apply calls are counted, including calls that throw

  Rule: The wash follows the carry, not the head count (D1, D6)

    Scenario Outline: A reduced carry washes that portion, not the whole stack
      Given an open field with stack S1 of 32 heads on arrow a0
      And the carry is <carry>
      And the tip heads are 32
      And the draft is empty
      When the route offer is built
      Then the reach wash equals the golden for carry <carry>
      And the reach wash does not equal the golden for carry 32
      And the clickable set equals the clickable set built at carry 32

      Examples:
        | carry |
        | 1     |
        | 4     |
        | 16    |

    Scenario: The opening board's wash matches the golden at 16 and at 32
      Given the opening board with the active stack rewritten to 16 heads
      And an empty draft at that stack with the carry equal to its heads
      When the route offer is built
      Then the reach wash equals the golden for that carry
      And the same holds after the active stack is rewritten to 32 heads

  Rule: A portion outside 1..heads is not walked (D2)

    Scenario Outline: An out-of-range portion returns an empty reach and calls apply zero times
      Given an open field with stack S1 of 16 heads on arrow a0
      When reachFrom is asked from a0 for portion <portion>
      Then the reach is empty
      And rules.apply was not called

      Examples:
        | portion |
        | 0       |
        | -1      |
        | 17      |
        | 1.5     |

  Rule: A refused hop is absent from that portion's reach (D1, invariant 6)

    Scenario: A full-stack portion does not reach an adjacent enemy the engine refuses
      Given an open field with stack S1 of 8 heads on arrow a0
      And an enemy stack stands on an out-arrow e1 of a0's target point
      When reachFrom is asked from a0 for portion 8
      And reachFrom is asked from a0 for portion 1
      Then portion 8's reach does not contain e1
      And portion 1's reach does contain e1
      And portion 8's arrows equal the full reach's plans for portion 8
      And portion 1's arrows equal the full reach's plans for portion 1

  Rule: Allowance left is the engine's (D1)

    Scenario: A stack with one step left reaches only what apply accepts
      Given an open field with stack S1 of 16 heads on arrow a0
      And S1's spent is speed of 16, minus 1
      When reachFrom is asked from a0 for portion 16
      Then every reached arrow is one step from a0
      And a two-step arrow is absent
      And the reached arrows equal the full reach's plans for portion 16

    Scenario: A speed override of 1 caps the portion walk as it caps the full walk
      Given an open field with stack S1 of 16 heads on arrow a0
      And S1's speed override is 1
      When reachFrom is asked from a0 for portion 16
      Then every reached arrow is one step from a0
      And the reached arrows equal the full reach's plans for portion 16

  Rule: The short-circuit stays (D1, invariant 5)

    Scenario: A carry below 1 paints an empty wash and does not walk a reach
      Given an open field with stack S1 of 16 heads on arrow a0
      And the draft is empty
      When the route offer is built at carry 0
      And the route offer is built at carry -1
      Then both reach washes are empty
      And both offers make the same number of rules.apply calls
      And that number is strictly fewer than the offer at carry 16

    Scenario: A terminal tip paints an empty wash and does not walk a reach
      Given an open field with stack S1 of 16 heads on arrow a0
      And the tip is terminal
      And the draft is empty and there is no last run
      When the route offer is built at carry 16
      Then the reach wash is empty
      And the clickable set is empty
      And rules.apply was not called

  Rule: The full walk and the empty tip stay (D2, D3)

    Scenario: Asking reachFrom with no portion still prices every portion
      Given an open field with stack S1 of 8 heads on arrow a0
      When reachFrom is asked from a0 with no portion
      Then the farthest distance is the speed of 8
      And a distance-1 arrow's max count is 8
      And the plans for portion 8 are present on a distance-4 arrow that portion 8 reaches

    Scenario: A portion query on an arrow the active player does not hold is empty
      Given an open field with stack S1 of 8 heads on arrow a0
      And arrow a1 holds no group
      When reachFrom is asked from a1 for portion 4
      And reachFrom is asked from a1 with no portion
      Then both reaches are empty
      And rules.apply was not called

  Rule: No cache, and the louder tiers stay louder (D4, invariant 9)

    Scenario: A second identical offer costs the same number of apply calls
      Given an open field with stack S1 of 32 heads on arrow a0
      And the carry equals 32
      And the draft is empty
      When the route offer is built
      And the route offer is built again from the same inputs
      Then the two reach washes are equal
      And the two offers made the same number of rules.apply calls

    Scenario: A clickable arrow is not in the wash
      Given an open field with stack S1 of 16 heads on arrow a0
      And the carry equals 16
      And the draft is empty
      When the route offer is built
      Then no clickable arrow is in the reach wash
      And a0 is not in the reach wash
      And every wash arrow is in the portion-16 reach
