# language: en
# Overview: docs/spec/raider-survives-claim/raider-survives-claim.md
# SPEC §6.3, §7, §6.1, §11 item 15. Packet P87, decisions 2–4.

Feature: A territory-grade raider survives a claim — stretches, carve-outs and what follows
  As the rules engine
  I want the boundaries of the strip exemption pinned as scenarios
  So that a claim spares exactly the trail that keeps a raider from conversion

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: The whole shielding stretch stays (decision 2)

    Scenario: A raider's road home through the claim stays with it
      Given player B stands on arrow p inside the pocket A's closure will ring
      And B's trail runs from p through bare arrow r, also inside the pocket, to B's territory
      When player A completes the closure
      Then p and r are A's territory
      And p and r are in B's trail
      And the group on p is owned by B

    Scenario: A separate bare stretch of the same player is still stripped
      Given player B has a territory-grade stretch carrying a B group on arrow p, which A's closure claims
      And B has a second stretch, carrying no B group, on arrow s, which A's closure also claims
      When player A completes the closure
      Then p is in B's trail
      And s is not in B's trail

    Scenario: A territory-grade stretch with no head on it is stripped
      Given player B's trail on arrows A's closure will claim is territory grade
      And no B group stands on that stretch
      When player A completes the closure
      Then B's trail is absent from every claimed arrow

  Rule: Grade is judged on the board the claim leaves (decision 3)

    Scenario: A closure that carves out the raider's anchoring territory converts it
      Given player B stands on arrow p, which A's closure will claim
      And B's trail through p is territory grade only through a feeder arrow f of B's territory
      And A's closure also claims f
      When player A completes the closure
      Then f and p are A's territory
      And the group on p is owned by A with the same heads
      And p is not in B's trail

  Rule: Only a stretch keeping a group from conversion is spared (decision 4)

    # Superseded by C2: a claim alone never removes a territory-grade stretch carrying its owner's stack, wherever the stack stands, so r stays in B's trail (SPEC §7).
    Scenario: A raider on neutral ground loses the part of its trail the claim takes
      Given player B stands on neutral arrow n, which A's closure does not claim
      And B's territory-grade trail through n runs over arrow r, which A's closure claims
      And no other B group stands on that stretch
      When player A completes the closure
      Then r is A's territory and not in B's trail
      And the group on n is owned by B

  Rule: Every claimed arrow changes owner (invariant 1)

    Scenario: An arrow under a surviving raider is the closer's land, and counts as captured
      Given player B stands with a territory-grade trail on arrow p, which A's closure claims
      And p borders a spawner whose share on p carried a nonzero accumulator for its previous owner
      When player A completes the closure
      Then p is A's territory
      And the accumulator on p is reset to zero

  Rule: The surviving raider is ordinary trail on enemy land afterwards

    Scenario: A cut that drops the surviving raider's grade converts it on that apply
      Given player B's raider survived A's closure on arrow p with a territory-grade stretch
      When player A's next step cuts that stretch between p and B's territory
      Then the group on p is owned by A with the same heads
      And the P33 convert wipe removes B's trail from p

    Scenario: The surviving raider's owner can claim its arrow back
      Given player B's raider survived A's closure on arrow p, and p is A's territory and in B's trail
      When player B steps from p onto B's own territory
      Then p is B's territory

  Rule: Purity

    Scenario: Equal inputs yield equal outputs, and the input is not mutated
      Given a state S0 in which A's closing step claims the arrow under a territory-grade B raider
      When I apply that step twice to S0
      Then both results are equal
      And S0's groups, trails and territory are unchanged
