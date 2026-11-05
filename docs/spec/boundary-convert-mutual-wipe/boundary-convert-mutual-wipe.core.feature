# language: en
# Overview: docs/spec/boundary-convert-mutual-wipe/boundary-convert-mutual-wipe.md
# SPEC §6.2, §6.3, §7. Packet P89.

Feature: Conversion at the round boundary; a mutual wipe does not land
  As a player reading SPEC.md
  I want an attack where no unit survives to cross nothing
  And a raider demoted by a spawn's cut to convert at once
  So that the engine answers both the way SPEC states

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory

  Rule: Both wiped is A = 0

    Scenario: A mutual wipe across the defender's trail does not cut it
      Given player B's trail runs "trailIn" to "trailOut" through point P, and "trailIn" is B's territory
      And player B x3 stands on "exit", which is not in B's trail
      And player A x3 stands on "from", and the step "from" to "exit" interleaves B's chord at P
      And a battle of 2 attackers against 3 defenders wipes both sides
      When player A steps 2 heads from "from" to "exit"
      Then no group stands on "exit"
      And "exit" is not in player A's trail
      And "trailOut" is in player B's trail
      And player A x1 stays on "from"

    Scenario: A mutual wipe of a defender on its own trail evaporates from the wiped arrow
      Given player B x3 stands on its trail arrow "exit", with B's trail continuing past "exit" over a bare arrow
      And player A x3 stands on "from"
      When player A steps 2 heads from "from" to "exit"
      Then no group stands on "exit"
      And "exit" and the bare arrow beyond it are not in player B's trail
      And "exit" is not in player A's trail

    Scenario: A mutual wipe from trail onto the attacker's own territory claims nothing
      Given player A x3 stands on its trail arrow "from", and "exit" is player A's territory
      And player B x3 stands on "exit"
      When player A steps 2 heads from "from" to "exit"
      Then "from" is not player A's territory
      And "from" is in player A's trail

  Rule: Conversion at the round boundary

    Scenario: A raider demoted by a birth-cut at the round boundary converts at that boundary
      Given player B's raider stands on player A's territory, territory grade through one trail road
      And a spawner of player A will emit a head onto a bare arrow of that road at the round boundary
      And the active seat is the last seat, so its endTurn closes the full round
      When that seat ends its turn
      Then the raider is owned by player A with the same heads
      And the raider's arrow is not in player B's trail

    Scenario: An endTurn that does not close a round converts nothing
      Given a stack of player B stands on player A's territory with no life line
      And the active seat's endTurn does not close the full round
      When that seat ends its turn
      Then every group keeps its owner
