# language: en
# Overview: docs/spec/spec-alignment/spec-alignment.md
# SPEC §6.1, §6.2, §6.3, §7. Packet P88. Edge cases.

Feature: rules-core follows the P86 rulings — edge cases
  As a maintainer of the rules engine
  I want the boundaries of each ruling pinned
  So that a later change cannot move a cut, a strip or a conversion unnoticed

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory

  Rule: Landing decides the cut (R3)

    Scenario: A mutual wipe lands and cuts
      Given player B's trail runs through point P and player B x3 stands on "exit"
      And player A x3 stands on "from", and the step "from" to "exit" interleaves B's chord at P
      And a battle of 2 attackers against 3 defenders wipes both sides
      When player A steps 2 heads from "from" to "exit"
      Then no group stands on "exit"
      And "trailOut" is not in player B's trail

    Scenario: A repelled attack onto the defender's trail arrow leaves the other arms
      Given player B x2 stands on its trail arrow "exit", and B's trail has another arm through target("from")
      And player A x2 stands on "from"
      When player A steps 1 head from "from" to "exit"
      Then every arrow of player B's trail is still in it

  Rule: The convert wipe and the strip (D1, decision 2)

    Scenario: The convert wipe halts at the next victim stack on neutral ground
      Given player B x2 stands on claimed arrow p, its trail p, then road arrow r1, then r2 off the claim
      And player B x1 stands on r2, which is neutral
      And no territory of player B feeds the trail
      When player A completes the closure
      Then the group on p is owned by player A
      And r1 is not in player B's trail
      And r2 is in player B's trail with player B's group on it

    Scenario: Bare claimed trail with no stack is removed and nothing converts
      Given player B's dormant trail lies on claimed arrows and no group of player B is on the claim
      When player A completes the closure
      Then none of those arrows is in player B's trail
      And no group changes owner

  Rule: The claim spares a stretch, not a stack (C2)

    Scenario: A raider deeper in neutral ground keeps the same road
      Given player B x1 stands two neutral arrows away from the claim on the same territory-grade trail
      When player A completes the closure
      Then every arrow of player B's trail is still in it

    Scenario: A territory-grade raider on a claimed arrow is still unchanged
      Given player B x1 stands on a claimed arrow on a stretch that reaches player B's territory outside the claim
      When player A completes the closure
      Then the group on that arrow is owned by player B
      And player B's anchor grade on that arrow is territory

  Rule: The claim root cut is the ordinary cut (R2)

    Scenario: The anchor-carving claim that also encloses the raider converts it
      Given player B x1 stands on claimed arrow p, territory grade only through B's territory arrow f
      And player A's closure also claims f
      When player A completes the closure
      Then the group on p is owned by player A
      And p is not in player B's trail

  Rule: The clean-feeder predicate is shared (D2)

    Scenario: A clean feeder anchors
      Given player B's trail leaves P0 over "out", and player B's only territory feeding P0 is "feeder"
      And no other player's trail holds "feeder"
      Then player B's anchor grade on "out" is territory
