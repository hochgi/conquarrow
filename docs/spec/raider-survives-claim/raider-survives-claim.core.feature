# language: en
# Overview: docs/spec/raider-survives-claim/raider-survives-claim.md
# SPEC §6.3, §7 (claim clears enemy trail), §6.1 (anchor grades). Packet P87.

Feature: A territory-grade raider survives a claim
  As a player whose raider's trail still reaches home
  I want a closure that claims the arrow under my raider to leave it mine
  So that only a cut, never a claim alone, can capture a trail-connected raider

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory

  Rule: The playtest case is fixed (playtest 2026-11-04, move #345)

    Scenario: A's raider on the arrow C's close claims stays A
      Given the 2026-11-04 match log replayed from makeMatch(config) up to move 345
      And A x1 stands on "tiling:a:2,2,2" with A's trail exactly "tiling:a:2,2,2"
      And A's trail on "tiling:a:2,2,2" is territory grade through feeder "tiling:a:2,3,2"
      When C plays move 345, stepping "tiling:a:3,1,1" to "tiling:a:2,2,1"
      Then "tiling:a:2,1,0", "tiling:a:2,2,2" and "tiling:a:3,1,1" are C's territory
      And the group on "tiling:a:2,2,2" is owned by A with 1 head
      And "tiling:a:2,2,2" is in A's trail
      And A's anchor grade on "tiling:a:2,2,2" is territory
      And C's trail holds none of the claimed arrows

  Rule: The contrast case is unchanged (playtest 2026-11-04, moves #329 to #331)

    Scenario: B's raider on C's existing land survives a close and converts on the cut
      Given the 2026-11-04 match log replayed from makeMatch(config) up to move 329
      And B x2 stands on "tiling:a:-1,1,2", which is C's territory
      When C plays move 329
      Then the group on "tiling:a:-1,1,2" is owned by B with 2 heads
      When the log is replayed through move 331, where C steps onto B's trail arrow "tiling:a:-1,2,2"
      Then the group on "tiling:a:-1,1,2" is owned by C with 2 heads
      And B's trail holds neither "tiling:a:-1,1,2" nor "tiling:a:-1,2,2"

  Rule: A territory-grade raider on a claimed arrow is not converted

    Scenario: A raider in the pocket a closure rings keeps its arrow's trail and its owner
      Given player A's closure will ring a pocket containing arrow p
      And player B stands on p with 1 head
      And B's trail is p plus a road that reaches B's territory outside the pocket
      When player A completes the closure
      Then p is A's territory
      And the group on p is owned by B with 1 head
      And p is in B's trail
      And B's anchor grade on p is territory

    Scenario: The outcome does not depend on whether the raider's arrow was already the closer's
      Given two states that differ only in whether arrow p is A's territory before A's closure
      And in both, player B stands on p with a territory-grade trail through p
      When player A completes the same closure in each
      Then in both results the group on p is owned by B with the same heads
      And in both results p is A's territory and in B's trail

  Rule: Without a territory-grade stretch, a claim still converts and still strips

    Scenario: Bare enemy trail on claimed arrows is stripped
      Given player B has trail on arrows player A's closure will claim
      And no B group stands on any arrow of that trail
      When player A completes the closure
      Then B's trail is absent from every claimed arrow
      And every claimed arrow is A's territory

    Scenario: A stack-grade raider on a claimed arrow converts and its trail is wiped
      Given player B stands on arrow q, which player A's closure will claim
      And B's trail through q reaches no B territory
      When player A completes the closure
      Then the group on q is owned by A with the same heads
      And q is not in B's trail

    Scenario: An enemy head with no trail on a claimed arrow converts
      Given player B stands on arrow q, which player A's closure will claim
      And q is not in B's trail
      When player A completes the closure
      Then the group on q is owned by A with the same heads
