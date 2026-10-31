# language: en
# Overview: docs/spec/byok-offer-vertex-join/byok-offer-vertex-join.md
# Adapter only — BYOK offer rows and tags, not a game rule

Feature: advances= clauses are exact at the boundaries
  As a local BYOK seat
  I want the advances= clause to be true in every corner case
  So that a clause I act on never describes progress that is not there

  Background:
    Given a GeometryPort and a RulesPort
    And seat A to move
    And annotateMove, formatLegalMoves and snapshotForPrompt from byokBot

  Rule: Held means territory, read after apply

    Scenario: A step onto own territory that flanks a spawner emits no advances=
      Given arrow a1 is A's territory and flanks spawner vertex v1
      When a step onto a1 is annotated
      Then the row contains no "advances=" clause

    Scenario: A's own trail on another border is not a holding
      Given A's trail, not territory, covers one other border of spawner vertex v1
      And arrow a1, a third border of v1, is not on A's trail or territory
      When the step onto a1 is annotated
      Then the clause for v1 reads "0/3→1/3"

    Scenario: An arrow flanking a vertex wholly held by an opponent reports that opponent's hold
      Given spawner vertex v1's three borders are all seat B's territory
      And A's stack is territory-grade protected and may step onto border a1 of v1
      When the step onto a1 is annotated
      Then the clause for v1 reads "advances=v1 0/3→1/3"
      And the clause continues " denies=B:3/3→2/3"

    Scenario: No denies= on an unowned exit
      Given arrow a1 is unowned and flanks spawner vertex v1 where B holds 2 borders
      When the step onto a1 is annotated
      Then the clause for v1 contains no "denies="

  Rule: Order and identity are deterministic

    Scenario: Clause order is stable across calls
      Given a double-fed arrow a2
      When the step onto a2 is annotated twice from the same state
      Then both rows are byte-identical
      And the two clauses follow compareVertices order, not flankVertices order

    Scenario: Two GeometryPort implementations produce identical offer text
      Given the same position on the fixture board and on the generated tiling, with matching spawner holdings
      When the offer rows are built on each
      Then the rows are identical after arrow and vertex ids are replaced by placeholders

    Scenario: A row that flanks no spawner is unchanged except for borders_spawner
      Given any corpus position
      When each row with no flanked spawner is annotated before and after P75
      Then the two texts are identical

  Rule: The spawner rows cover every vertex an offer row advances

    Scenario: The cap never hides an advanced vertex
      Given a position where more than 12 interesting spawner vertices touch incident arrows
      When STATE_JSON is built
      Then every interesting vertex named by an advances= clause has a spawner row
      And tier-1 rows appear only while the total is below 12

  Rule: Budget

    Scenario: Offer growth on a mid-game position is within 15%
      Given corpus position "grok-2026-09-10T1442#34"
      When the user prompt is built before and after P75
      Then its length grows by at most 15%
