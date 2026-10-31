# language: en
# Overview: docs/spec/byok-offer-vertex-join/byok-offer-vertex-join.md
# Adapter only — BYOK offer rows and tags, not a game rule

Feature: Offer rows name the spawner vertices they advance
  As a local BYOK seat ranking step rows by income
  I want each row to say which spawner vertices it advances and by how much
  So that I never have to join the step rows to the spawner rows by hand

  Background:
    Given a GeometryPort and a RulesPort
    And seat A to move
    And annotateMove and buildUserPrompt from byokBot

  Rule: A step onto a new arrow names every flanked spawner

    Scenario: A step onto an arrow flanking one spawner emits one advances= clause
      Given arrow a1 flanks spawner vertex v1 with force 1/4 and flanks no other spawner
      And A holds 1 other border of v1 as territory
      And a1 is not on A's trail or territory
      When the step onto a1 is annotated
      Then the row contains exactly one "advances=" clause
      And that clause reads "advances=v1 1/3→2/3 force=1/4"
      And the clause appears after "trailLen=" and before " tags="
      And the row's tags do not contain "double_fed"

    Scenario: A step onto a double-fed arrow emits two clauses and double_fed
      Given arrow a2 flanks spawner vertices v1 and v2
      And a2 is not on A's trail or territory
      When the step onto a2 is annotated
      Then the row contains two "advances=" clauses, v1's then v2's in compareVertices order
      And the row's tags contain "double_fed"

    Scenario: A step onto an arrow flanking no spawner emits neither
      Given arrow a3 flanks no spawner vertex
      When the step onto a3 is annotated
      Then the row contains no "advances=" clause
      And the row's tags contain neither "double_fed" nor "completes_spawner"

  Rule: Re-walking an arrow already held advances nothing

    Scenario: The 2026-09-10T1442 cycle position emits no advances= on its trail arrows
      Given corpus position "grok-2026-09-10T1442#34" on the generated tiling
      And its offer row whose exit is on seat B's own trail and borders an open spawner
      When the offer is built
      Then that row contains no "advances=" clause
      And no row of the offer contains "borders_spawner"

  Rule: Completion is called out

    Scenario: Walking the third arrow of a vertex emits completes_spawner
      Given A holds 2 borders of spawner vertex v1 as territory
      And the third border a1 is not on A's trail or territory
      When the step onto a1 is annotated
      Then the row contains "advances=v1 2/3→3/3"
      And the row's tags contain "completes_spawner"
      And the row's tags contain no "share+" tag

    Scenario: A closing row that completes a vertex emits share+N and completes_spawner
      Given A's trail encloses the last border of spawner vertex v1 that A does not hold
      And the step onto own territory closes the shape
      When the closing step is annotated
      Then the row's tags contain "closes" and "share+1"
      And the row's tags contain "completes_spawner"

  Rule: The prompt carries the new vocabulary and not the old

    Scenario: borders_spawner no longer appears in the offer or the prompt
      Given any corpus position
      When the system prompt and the user prompt are built
      Then neither contains "borders_spawner"
      And the LEGAL_MOVES legend explains "advances="

    Scenario: The threat header names completes_spawner
      Given an offer with a row tagged "completes_spawner" and a row tagged "closes"
      When the threat line is built
      Then it contains "Offer tags: closes, completes_spawner"
