# language: en
# Overview: docs/spec/spec-alignment/spec-alignment.md
# SPEC §6.1, §6.2, §6.3, §7. Packet P88. Register rows R3, D1, C2, R2, D2, R1.

Feature: rules-core follows the P86 rulings
  As a player reading SPEC.md
  I want the engine to cut, strip and convert exactly where SPEC.md says
  So that a trail is never destroyed without a cut, and is when its lifeline is severed

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory

  Rule: A repelled attack does not cut (R3)

    Scenario: A repelled attack across the defender's trail leaves that trail
      Given player B's trail runs "trailIn" to "trailOut" through point P, and "trailIn" is B's territory
      And player B x2 stands on "exit", which is in B's trail
      And player A x2 stands on "from", and the step "from" to "exit" interleaves B's chord at P
      When player A steps 1 head from "from" to "exit"
      Then player B x1 stands on "exit"
      And "exit" is not in player A's trail
      And "trailOut" is in player B's trail

    Scenario: A winning attack across the defender's trail still cuts
      Given the same board, with player B x1 on "exit" and player A x3 on "from"
      When player A steps 2 heads from "from" to "exit"
      Then player A stands on "exit"
      And "trailOut" is not in player B's trail

  Rule: The convert wipe runs from a converted arrow the claim took (D1)

    Scenario: A stack-grade raider on a claimed arrow converts and its trail off the claim evaporates
      Given player A's closing step will claim arrow p
      And player B x2 stands on p with trail p plus a road of unoccupied neutral arrows leaving the claim
      And no territory of player B feeds that trail, so it is stack grade
      When player A completes the closure
      Then the group on p is owned by player A with 2 heads
      And no arrow of the road is in player B's trail

  Rule: A claim spares a territory-grade trail carrying its owner's stack, wherever it stands (C2)

    Scenario: A raider on neutral ground keeps the part of its trail the claim takes
      Given player B x1 stands on a neutral arrow outside the claim
      And player B's trail runs from that arrow through a claimed arrow r to a point B's territory feeds
      When player A completes the closure
      Then r is player A's territory
      And r is in player B's trail
      And player B's anchor grade on the raider's arrow is territory

    Scenario: A territory-grade stretch with no stack on it is still stripped
      Given player B's trail on claimed arrows is territory grade and carries no group of player B
      When player A completes the closure
      Then none of those claimed arrows is in player B's trail

  Rule: A claim that takes a trail's anchoring land is a territory-root cut (R2)

    Scenario: The anchor claimed while the raider stands on neutral ground strands it
      Given player A's land and trail ring a pocket holding player B's territory arrow f
      And f is the only clean feeder of its head point P0 for player B
      And player B's trail leaves P0 outward over a bare arrow e1 to e2, both neutral and outside the claim
      And player B x1 stands on e2
      And player A's closing step does not cross player B's trail
      When player A completes the closure
      Then f is player A's territory
      And e1 is not in player B's trail
      And e2 is in player B's trail
      And the group on e2 is owned by player B with 1 head
      And player B's anchor grade on e2 is stack

    Scenario: The anchor claimed while the raider stands on the closer's land converts it
      Given the same ring and anchor f
      And player B x1 stands on e, which leaves P0 and is player A's territory outside the claim
      And player B's trail is exactly e
      When player A completes the closure
      Then the group on e is owned by player A with 1 head
      And e is not in player B's trail

    Scenario: A claim that leaves another clean feeder is not a cut
      Given the same ring, with a second territory arrow of player B feeding P0 from outside the claim
      And player B's trail leaves P0 over e1 to e2 as before
      When player A completes the closure
      Then e1 and e2 are in player B's trail
      And player B's anchor grade on e2 is territory

  Rule: Only a clean feeder anchors (D2)

    Scenario: A feeder in an enemy trail does not anchor
      Given player B's trail is exactly an arrow "out" leaving point P0, with player B x1 on it
      And the only territory of player B feeding P0 is "feeder"
      And "feeder" is in player A's trail
      Then player B's anchor grade on "out" is stack

    Scenario: A territory-root cut that halts at once leaves the stack at stack grade
      Given player B's trail is exactly "out" leaving P0, with player B x1 on it
      And the only territory of player B feeding P0 is "feeder", clean
      And player A x2 stands on its own territory on an arrow from which "feeder" is a grain step
      When player A steps 1 head onto "feeder"
      Then "out" is in player B's trail
      And player B's anchor grade on "out" is stack

  Rule: A stack on its owner's land can be attacked by a raider with a lifeline (R1)

    Scenario: A stack stepping from its own land attacks a stack on enemy land
      Given player B x4 stands on its own territory "from"
      And player A x1 stands on its own territory "exit", an out-arrow of target("from")
      Then the step of 3 heads from "from" to "exit" is legal for player B
      When player B steps 3 heads from "from" to "exit"
      Then player B stands on "exit"
