# language: en
# Overview: docs/spec/byok-interior-mill/byok-interior-mill.md
# Adapter only — BYOK offer rows and tags, not a game rule

Feature: Interior steps toward the territory edge are not mills
  As a local BYOK seat whose stack sits inside its own territory
  I want each own-territory row to say how far the edge is and to tag the approaching step to_edge
  So that I am not told every move is waste, and the baseline suggestion is not withheld

  Background:
    Given a GeometryPort and a RulesPort
    And seat A to move
    And annotateMove, millOmit and buildUserPrompt from byokBot

  Rule: Own-territory rows carry edgeDist and to_edge

    Scenario: A stack two arrows inside territory gets edgeDist=2→1 and to_edge on the approaching step
      Given a stack S1 of A on arrow a0, own territory, with edgeDist(a0) = 2
      And an out-arrow a1 of a0 that is own territory with edgeDist(a1) = 1
      When the step from a0 to a1 is annotated
      Then the row contains "edgeDist=2→1"
      And the row does not contain "tipDist="
      And the row's tags contain "to_edge" and "onto_home"
      And the row's tags do not contain "home_mill"

    Scenario: A sideways interior step keeps home_mill
      Given a stack S1 of A on own-territory arrow a0 with edgeDist(a0) = 2
      And an own-territory out-arrow a2 of a0 with edgeDist(a2) = 2
      When the step from a0 to a2 is annotated
      Then the row contains "edgeDist=2→2"
      And the row's tags contain "home_mill" and "onto_home"
      And the row's tags do not contain "to_edge"

  Rule: millOmit follows the tag

    Scenario: With every row home_mill or to_edge, the baseline suggestion is printed
      Given every step on A's offer is an interior step
      And at least one of them is tagged to_edge
      When the offer tag rows are built
      Then millOmit is false
      And buildUserPrompt contains "A weak one-ply baseline would play"

    Scenario: With every row home_mill, millOmit stays true
      Given every step on A's offer is an interior step tagged home_mill
      When the offer tag rows are built
      Then millOmit is true
      And buildUserPrompt does not contain "A weak one-ply baseline would play"

  Rule: The archived stall

    Scenario: The archived position re-rendered offers a to_edge row and the baseline
      Given corpus position "grok-2026-09-10T0657#56" with its seat to move
      When buildUserPrompt is rendered for that seat with its legal offer
      Then at least one LEGAL_MOVES row is tagged to_edge
      And every row whose from is the seat's territory contains "edgeDist="
      And the prompt contains "A weak one-ply baseline would play"
