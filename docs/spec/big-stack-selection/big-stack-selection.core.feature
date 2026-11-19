# language: en
# Overview: docs/spec/big-stack-selection/big-stack-selection.md
# Packet P99 — big-stack selection lag, happy path

Feature: A large stack's reach wash matches today's set and walks one portion
  As a player selecting a stack of many heads
  I want the move markers to be the same set, computed from the carry alone
  So that selection does not walk every smaller portion and throw the answer away

  Background:
    Given the generated tiling
    And a RulesPort whose apply calls are counted, including calls that throw
    And an empty draft

  Rule: The wash matches the full-reach golden (D3)

    Scenario Outline: An open-field wash at 8, 16 and 32 heads matches the golden
      Given an open field with stack S1 of <heads> heads on arrow a0
      And the carry equals <heads>
      And the tip is a0
      When the route offer is built
      Then the reach wash equals the full reach's arrows that have a plan for the carry, minus a0, the clickable set and the walked arrows
      And the reach wash is not empty
      And the painted wash equals the offer's reach wash

      Examples:
        | heads |
        | 8     |
        | 16    |
        | 32    |

  Rule: The wash walks only the carry (D1, D5)

    Scenario: A 16-head wash costs less than walking every portion
      Given an open field with stack S1 of 16 heads on arrow a0
      And the tip is a0
      When the route offer is built at carry 16
      And the route offer is built at carry 0
      And the full reach is asked from a0 with no portion
      Then the wash calls are greater than 0
      And the wash calls are strictly fewer than the full calls

    Scenario: A 32-head wash costs less than a 16-head full reach
      Given an open field with stack S1 of 32 heads on arrow a0
      And an open field with stack S2 of 16 heads on arrow a0
      When the wash calls of S1 are measured
      And the full calls of S2 are measured
      Then S1's wash calls are greater than 0
      And S1's wash calls are strictly fewer than S2's full calls
