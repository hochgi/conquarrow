# language: en
# Overview: docs/spec/byok-opening-horizon/byok-opening-horizon.md
# Adapter only: BYOK offer rows, tips line and bench record. Not a game rule.

Feature: The BYOK offer says how far home is, in the portion's own turns
  As a local BYOK seat walking a stack off its territory
  I want each row to say how many of this portion's turns it is from home, and to mark the step that crosses a 2-turn horizon
  So that a walk away from home has a visible cost, and the nearest close has a visible value

  Background:
    Given a GeometryPort and a RulesPort
    And seat A to move
    And annotateMove, formatLegalMoves and buildUserPrompt from byokBot

  Rule: homeIn counts this portion's turns

    Scenario: A trail row prints homeIn in turns of the portion
      Given a stack S1 of A with 3 heads and spent 1 on a trail arrow a0
      And a step from a0 to a1 with count 3, where a1 is not own territory and d(a1) = 6
      When the step is annotated
      Then the row contains "tipDist=" and "homeIn=3"
      And "homeIn=3" appears after the distance slot and before "trailLen="

    Scenario: A row whose remaining walk this turn reaches home prints homeIn=0
      Given a stack S1 of A with 3 heads and spent 0 on a trail arrow a0
      And a step from a0 to a1 with count 3, where a1 is not own territory and d(a1) = 1
      When the step is annotated
      Then the row contains "homeIn=0"

    Scenario: A row that lands on own territory has no homeIn
      Given a stack S1 of A on a trail arrow a0
      And a step from a0 to an own-territory arrow a1
      When the step is annotated
      Then the row does not contain "homeIn="
      And the row's tags do not contain "leaves_horizon"

  Rule: leaves_horizon marks the crossing step

    Scenario: The step that takes homeIn from 2 to 3 is tagged leaves_horizon
      Given a portion of A whose homeIn before the step is 2
      And a step after which its homeIn is 3
      When the step is annotated
      Then the row's tags contain "leaves_horizon"

  Rule: The sentinel is not a number

    Scenario: A row beyond the distance cap prints none
      Given a stack S1 of A on a trail arrow a0 with no own territory within 16 grain steps
      When a step from a0 to an arrow a1 with no own territory within 16 grain steps is annotated
      Then the row contains "tipDist=none→none" and "homeIn=none"
      And the row does not contain "17"

  Rule: The tips line shows the nearest close

    Scenario: An exposed tip shows homeIn and the claim of the shortest walk home
      Given a fixture where A has territory, a trail ending at tip t with a stack of 3 heads, and the shortest walk home from t
      And landing that walk would claim L arrows of which S are spawner shares
      When buildUserPrompt is rendered for A
      Then the tips line entry for t contains "homeIn=", "ifHome=+L share+S" and "heads=3"
      And playing that walk out with apply gains A exactly L territory and S shares

  Rule: Bench hygiene

    Scenario: A benched match records each BYOK turn's plan and why
      Given a matches-tier match whose BYOK chair answers with a scripted fetch
      And the scripted replies carry "plan" and "why" strings
      When the match runs
      Then the record's byokTurns has one entry per BYOK seat-turn played
      And each entry's at indexes that seat-turn's first move in moves
      And each entry's replies hold the plan and why of each completion, in call order
