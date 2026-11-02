# language: en
# Overview: docs/spec/byok-opening-horizon/byok-opening-horizon.md
# Adapter only: BYOK offer rows, tips line and bench record. Not a game rule.

Feature: Edges of homeIn, leaves_horizon, the sentinel, ifHome and the bench record
  As the BYOK offer
  I want every new token to be exact at its boundaries
  So that no row says something false

  Background:
    Given a GeometryPort and a RulesPort
    And seat A to move

  Rule: Speed and count

    Scenario Outline: The same exit prints homeIn by the portion's speed
      Given a stack S1 of A with 3 heads and spent 0 on a trail arrow a0
      And a step from a0 to a1 where a1 is not own territory and d(a1) = <d>
      When the step with count <count> is annotated
      Then the row contains "homeIn=<homeIn>"

      Examples:
        | count | d | homeIn |
        | 1     | 4 | 4      |
        | 3     | 4 | 2      |
        | 3     | 1 | 0      |

    Scenario: A merge-override portion uses its override this turn and speed(count) later
      Given a group of A on a trail arrow a0 with speedOverride 1, spent 0 and 4 heads
      And a step from a0 to a1 with count 4, where a1 is not own territory and d(a1) = 4
      When the step is annotated
      Then the row contains "spd=1" and "homeIn=2"

    Scenario: A leave_home row gets homeIn after its edgeDist slot
      Given a stack S1 of A with 3 heads on own territory
      And a step that leaves territory onto a1 with d(a1) = 3
      When the step is annotated
      Then the row contains "edgeDist=" followed by "homeIn="
      And the row's tags contain "leave_home"

  Rule: Only the crossing step is tagged

    Scenario Outline: leaves_horizon fires on 2 to 3 only
      Given a portion of A whose homeIn before the step is <before>
      And a step after which its homeIn is <after>
      When the step is annotated
      Then the row's tags <verdict> "leaves_horizon"

      Examples:
        | before | after | verdict         |
        | 2      | 3     | contain         |
        | 0      | none  | contain         |
        | 3      | 4     | do not contain  |
        | 2      | 2     | do not contain  |
        | 3      | 2     | do not contain  |

  Rule: The sentinel and the tips line

    Scenario: A tip beyond the cap prints none and no ifHome
      Given an exposed tip of A with no own territory within 16 grain steps
      When buildUserPrompt is rendered for A
      Then that tip's entry contains "tipDist=none homeIn=none"
      And that entry does not contain "ifHome="

    Scenario: With no exposed tip the tips line is unchanged
      Given A has no stack on its trail
      When buildUserPrompt is rendered for A
      Then the prompt contains "Exposed tips: none"

  Rule: Nothing else moves

    Scenario: Existing tags are unchanged
      Given the archived corpus position "grok-2026-09-10T1442#34"
      When its offer is rendered before and after P83
      Then removing "homeIn=" tokens and "leaves_horizon" and mapping "none" back to "17" in tipDist gives the old rows

    Scenario: Both geometry ports give identical offer text
      Given the same position on geometry-tiling and geometry-fixtures with matching distances
      When the offer is rendered on each
      Then the texts are identical after arrow ids are replaced by placeholders

  Rule: The bench record

    Scenario: An unusable reply adds no entry, and a non-string plan records null
      Given a scripted BYOK seat whose first completion has no plan key and a numeric why
      And whose second seat-turn's reply is unusable
      When the match runs
      Then the first turn's reply is recorded as plan null and why null
      And the fallback turn's entry has an empty replies list

    Scenario: Recorded texts are one line and capped
      Given a scripted reply whose plan holds a newline and 600 characters
      When the match runs
      Then the recorded plan is one line of at most PLAN_CAP characters
