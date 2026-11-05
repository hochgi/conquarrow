# language: en
# Overview: docs/spec/closure/closure.md
# SPEC §7 (the pincer, the land bridge, territory is contestable), §6.1a, §11 item 16

Feature: Closure — the pincer, the degenerate claims, and the seams
  As the author of the rules engine
  I want the shapes that look like special cases to resolve as ordinary closures
  So that §7's claim — forking needs no additional rule — is testable rather than asserted

  Background:
    Given the generated tiling behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: The pincer is two closures and nothing else

    §7 is explicit that a forked trail whose branches both land "requires no
    additional rule". These two scenarios are the whole proof of that, and they are
    instances of the core rules rather than new behaviour.

    Scenario: The second arm lands and takes the ground between
      Given player A's trail runs a stem from their territory to point P and forks into arms X and Y
      And arm X has already landed, so the stem and X are player A's territory
      And arm Y is still an open trail rooted at P
      And a head of player A's stands on the last arrow of arm Y
      When that head lands on player A's territory
      Then every arrow of arm Y is player A's territory
      And the arrows between arm Y and arm X are player A's territory
      # The second landing's backward walk runs Y → P, and P is territory now, so it
      # has territory at both ends. The ground between falls out of fill.

    Scenario: An arm that never lands claims nothing and stays cuttable
      Given player A's trail forks at point P into arms X and Y
      And arm X has landed
      When player A ends their turn without landing arm Y
      Then every arrow of arm Y is still in player A's trail
      And arm Y's grade is territory, because P is now player A's territory
      # It is re-rooted rather than claimed. That is the trade §7 prices: two trails
      # to defend instead of one, with the stem a single point of failure.

  Rule: Degenerate claims

    Scenario: The minimal closure is three arrows and encloses no tile
      Given the three arrows bordering one vertex form a directed cycle
      And two of them are player A's territory
      And the third is in player A's trail, with a head of player A's on it
      When that head lands on one of the two territory arrows
      Then all three arrows are player A's territory
      And no other arrow changed hands
      # §11 item 16 and §7: the lattice triangle is the minimum enclosable territory
      # and it encloses *zero tiles*. It takes a whole spawner anyway, because
      # ownership is read off the three bordering arrows in thirds (§11 item 34) —
      # and nothing here enumerates the vertex to find that out.

    Scenario: A single-arrow closure claims just that arrow
      Given a head of player A's stands on arrow n1, which is in player A's trail
      And n1 departs a point one of player A's territory arrows feeds
      And a territory arrow of player A's leaves the point n1 feeds
      When that head lands on it
      Then n1 is player A's territory
      And n1 is not in player A's trail

    Scenario: A trail that crosses itself before landing still claims every upstream arrow
      Given player A's trail departs their territory and passes through one point twice
      And a head of player A's stands on its last arrow
      When that head lands on player A's territory
      Then every arrow of that trail is player A's territory
      # The claim does not care that the curve self-intersects — a crossover is a
      # merge as well as a split, so the walk takes both upstreams. *Which lobe* the
      # crossing puts inside is fill's question, not this file's.

    Scenario: A closure claims nothing twice
      Given player A's trail is a loop from their territory back to it
      When player A closes it
      And player A moves a head out over the same ground and closes again
      Then the second closure claims only the arrows it newly trailed
      # Ground already owned is not re-claimed, and stepping over it lays no trail at
      # all (§5), so the second closure has almost nothing upstream of it.

  Rule: A closure is refused for the same reasons any step is

    Scenario: A closure onto an arrow the enemy occupies is refused
      Given arrow t1 is player A's territory and a stack of player B's stands on it
      And a head of player A's stands on a trail arrow feeding the point t1 leaves
      When player A tries to step that head onto t1
      Then the step is refused with a contract violation
      And nothing is claimed
      # P04's rule survives closure: contact is combat (P06), and owning the ground
      # does not make an occupied arrow enterable.

    # Superseded by P22: branching is free and no head is required at a join, so the closure is legal (SPEC §5).
    Scenario: A closure that would strip a branch anchor is refused
      Given point P is a join in player A's trail
      And the closing head is the only head on an in-arrow of P
      When player A tries to land that head on their own territory
      Then the step is refused with a contract violation
      And nothing is claimed
      # ARCHIVE (P22): branch toll withdrawn — tests assert the step is legal.
      # See docs/spec/trails-simple/ and closure.edge-cases.test.ts (P22).

  Rule: Purity and determinism

    Scenario: Closing does not mutate the input state
      Given a state S0 in which player A can close
      When I apply the closing step to S0 yielding S1
      Then S0's trails and territory are unchanged
      And S1's territory contains the claim

    Scenario: The claim does not depend on the order the trail was built
      Given two states differing only in the insertion order of player A's trail set
      When I apply the same closing step to each
      Then the two resulting states are equal
      And their territory maps enumerate in the same order
      # ADR 0001. A claim is an ordered answer derived from a Set, which is where
      # insertion order hides — and it surfaces only as replay drift.

    Scenario: No vertex is enumerated
      Given any closure on the generated tiling
      When it resolves
      Then no vertex identifier is requested beyond what an idle move requests
      # §11 item 34. Ownership of a special is a *reading* of the three bordering
      # arrows, so a closure that touched a vertex would be a second copy of a fact
      # it is supposed to derive.
