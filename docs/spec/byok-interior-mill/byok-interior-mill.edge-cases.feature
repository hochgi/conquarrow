# language: en
# Overview: docs/spec/byok-interior-mill/byok-interior-mill.md
# Adapter only — BYOK offer rows and tags, not a game rule

Feature: Interior-mill edges — deeper steps, leaving home, untouched rows, determinism, teaching
  As a local BYOK seat
  I want edgeDist and to_edge to change only own-territory rows, and identically on every geometry
  So that P80 is measured as one arm and nothing else on the offer moves

  Background:
    Given a GeometryPort and a RulesPort
    And seat A to move

  Rule: Narrowed home_mill

    Scenario: A step moving deeper inside keeps home_mill
      Given a stack S1 of A on own-territory arrow a0 with edgeDist(a0) = 1 or more
      And an own-territory out-arrow a3 of a0 with edgeDist(a3) > edgeDist(a0)
      When the step from a0 to a3 is annotated
      Then the row contains "edgeDist=" with b greater than a
      And the row's tags contain "home_mill"
      And the row's tags do not contain "to_edge"

    Scenario: A step from territory onto non-territory keeps leave_home and is not to_edge
      Given a stack S1 of A on own-territory arrow a0
      And an out-arrow x of a0 that is not A's territory
      When the step from a0 to x is annotated
      Then the row contains "edgeDist=1→0"
      And the row does not contain "tipDist="
      And the row's tags contain "leave_home" and "outward"
      And the row's tags contain neither "to_edge" nor "home_mill"

  Rule: Rows off territory are unchanged

    Scenario: Rows whose from is not own territory print tipDist exactly as before
      Given a stack S2 of A on a trail arrow t0 that is not A's territory
      When every step from t0 is annotated
      Then each row contains "tipDist=" and not "edgeDist="
      And each row's text equals the pre-P80 text for that step
      And no row is tagged to_edge

    Scenario: The exposed-tips header still prints tipDist
      Given A has a stack on a trail arrow
      When buildUserPrompt is rendered
      Then the "Exposed tips:" line contains "tipDist="

  Rule: Determinism

    Scenario: Both geometry implementations produce identical offer text
      Given the same position built on geometry-tiling and on geometry-fixtures
      And A has a stack inside its territory with an approaching step
      When the LEGAL_MOVES block is formatted on each, twice
      Then all four texts are identical

  Rule: Teaching

    Scenario: The teaching file scopes the mill sentence and names to_edge once
      When docs/byok-teaching.md is read
      Then it contains "home_mill with empty trail and no expansion is wasted tempo"
      And it does not contain "home_mill / onto_home with empty trail"
      And it contains exactly one sentence naming "to_edge"
      And that sentence says crossing your own territory toward its edge is how an interior stack gets back to work and is not a mill
