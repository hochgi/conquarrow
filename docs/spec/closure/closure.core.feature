# language: en
# Overview: docs/spec/closure/closure.md
# SPEC §7 (closure, which arrows the landing claims, the land bridge, the pincer),
# §6.1a (a trail is a set, all-to-all points), §11 items 16, 26, 34

Feature: Closure — coming home, and what that takes with you
  As the author of the rules engine
  I want a landing to claim exactly the trail it could have been walked through
  So that the pincer and the salvaged fragment are both ordinary closures

  Background:
    Given the generated tiling behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: A closure is an ordinary step onto your own territory

    §7: depart from your own territory, land back on your own territory. There is no
    close action and no declaration — P05 left this exact branch of the safety rule
    empty and said so in a comment.

    Scenario: Landing on your own territory while trailing closes
      Given arrow t1 is player A's territory
      And player A's trail runs from a point t1 feeds, round, to an in-arrow of a point that t1's neighbour occupies
      And a head of player A's stands on the last arrow of that trail
      When player A steps that head onto a territory arrow of their own
      Then the step succeeds
      And every arrow of that trail is player A's territory
      And none of those arrows is in player A's trail

    Scenario: Moving inside your own territory closes nothing
      Given a head of player A's stands on arrow t1, which is player A's territory
      And player A has no trail
      When player A steps that head onto another of their own territory arrows
      Then the step succeeds
      And player A's territory is unchanged
      # §5's free movement. The departed arrow is not trail, so there is no path to
      # claim — this is the clause that keeps ordinary movement at home free.

    Scenario: Landing on enemy territory is not a closure
      Given arrow e1 is player B's territory
      And a head of player A's stands on an in-arrow of a point that feeds e1, and that arrow is in player A's trail
      When player A steps that head onto e1
      Then the step succeeds
      And e1 is in player A's trail
      And e1 is still player B's territory
      # §7 / P28: enemy territory is hostile ground — enterable from own
      # territory or a territory-grade trail, and exposing. Marking is trails'
      # rule and it is untouched here.

    Scenario: Landing while not trailing claims nothing
      Given a head of player A's stands on arrow n1, which is neutral and not in any trail
      And arrow t1 is player A's territory and is an out-arrow of the point n1 feeds
      When player A steps that head onto t1
      Then the step succeeds
      And player A's territory contains t1 and nothing new
      # A head can reach its own border without trailing — it walked home over ground
      # it already owned and stepped off it once. Nothing was drawn, so nothing closes.

  Rule: The claim is the trail walked backwards along the grain

    The decision the packet turns on. The trail records no path (§6.1a); the grain
    recovers it, because every arrow the closing head could have come through is
    upstream of the landing and nothing else is.

    Scenario: A straight run home claims its whole length
      Given player A's trail is a run of arrows n1, n2, n3, each feeding the next
      And n1 departs a point one of player A's territory arrows feeds
      And a head of player A's stands on n3
      When player A steps that head onto a territory arrow of their own
      Then n1, n2 and n3 are all player A's territory

    Scenario: A fork's other arm is downstream and is not claimed
      Given player A's trail runs a stem to a point P and forks there into arms X and Y
      And the stem departs player A's territory
      And a head of player A's stands on the last arrow of arm X
      When that head lands on player A's territory
      Then the stem and every arrow of arm X are player A's territory
      And every arrow of arm Y is still in player A's trail
      And no arrow of arm Y is player A's territory
      # The pincer's first half. Arm Y is downstream of P, so the backward walk never
      # reaches it — which is what leaves it something to enclose (§7).

    Scenario: A merge claims every upstream in-arrow
      Given point P has two of player A's trail arrows entering it
      And player A's trail continues out of P towards their territory
      And a head of player A's stands on the last arrow of that continuation
      When that head lands on player A's territory
      Then both in-arrows of P are player A's territory
      # §6.1a: a point is all-to-all and the set holds no pairing to prefer one by
      # (§11 item 26), so the walk takes both — the same reading evaporation takes.

    Scenario: A spur upstream of the landing is claimed
      Given player A's trail runs n1, n2, n3 towards their territory
      And a further trail arrow s1 of player A's also feeds the point n2 feeds
      And a head of player A's stands on n3
      When that head lands on player A's territory
      Then s1 is player A's territory
      # s1 is an in-arrow of a point the walk transits, so it is upstream. Being a
      # dead end does not exempt it — that is what makes salvage work.

  Rule: The path is claimed either way, and fill finds what it rings

    §11 item 36: there is no enclose-or-strip branch. The walk claims the path; a
    pocket that cannot reach infinity is claimed with it, and a strip rings nothing.

    Scenario: A loop from territory back to territory claims its interior
      Given player A's trail departs their territory, encircles at least one arrow, and returns
      And a head of player A's stands on its last arrow
      When that head lands on player A's territory
      Then the encircled arrows are player A's territory
      And the trail's own arrows are player A's territory

    Scenario: A path that encloses nothing becomes a one-wide strip
      Given player A holds two separate stretches of territory
      And player A's trail departs one of them and reaches the other without encircling anything
      When its head lands on the second stretch
      Then every arrow of that trail is player A's territory
      And no other arrow changed hands
      # §7's land bridge, and §7's own guard on it: available only between holdings
      # you already own, which is what kills the corridor exploit.

    Scenario: A cut fragment driven home claims the path and encloses nothing
      Given a stretch of player A's trail touches none of their territory
      And a stack of player A's stands on it, so it is stack grade
      And player A drives that stack from the stretch to their own territory, laying fresh trail
      When the stack lands on player A's territory
      Then the whole stretch and the fresh trail are player A's territory
      And no arrow that was not on that path changed hands
      # §7: a stack anchor pays the path. The walk stops at the fragment's anchor, and
      # a bare strip rings nothing — but if that path had crossed itself, the loop's
      # inside would be claimed too (§11 item 36).

  Rule: A closure moves ground, whoever held it

    Scenario: A loop closed inside enemy territory carves that chunk out
      Given a region of arrows is player B's territory
      And player A's trail departs player A's territory, runs into that region, encircles part of it, and returns
      When player A's head lands on player A's territory
      Then the encircled arrows are player A's territory
      And they are no longer player B's territory
      # §7, territory is contestable. Nothing is ever safe, so nobody snowballs.

    Scenario: An enemy trail on a claimed arrow is stripped
      Given arrow x1 is in player B's trail
      And player A closes a loop that encircles x1
      When the closure resolves
      Then x1 is player A's territory
      And x1 is not in player B's trail
      # P13: claim clears enemy paint on the tile; convert alone missed bare trail.
      # P87: except a territory-grade stretch carrying one of its owner's stacks,
      # which a claim alone never removes (SPEC §7).

    # Superseded by P07, P87: an enemy stack on a claimed arrow converts unless its trail is territory grade (SPEC §6.3).
    Scenario: An enemy head on a claimed arrow keeps standing
      Given a stack of player B's stands on arrow x1
      And player A closes a loop that encircles x1
      When the closure resolves
      Then x1 is player A's territory
      And player B's stack still stands on x1 with the same count
      # **The P07 seam.** §7 grants "everything standing on them — enemy heads,
      # converted (§6.3)", and conversion is P07's. Claiming the tile and leaving the
      # head is deliberately visible rather than quietly approximated.

  Rule: Claimed arrows leave the claiming player's trail

    Scenario: Closing empties the trail it claimed
      Given player A's trail is a loop from their territory back to it
      And a head of player A's stands on its last arrow
      When that head lands on player A's territory
      Then player A's trail contains none of the claimed arrows
      # trails' invariant: an arrow is never both a player's own territory and their
      # own trail. This is the first thing in the engine that removes trail.

    Scenario: Closing leaves an unclaimed arm in the trail
      Given player A's trail forks, and only one arm lands
      When the closure resolves
      Then player A's trail is exactly the unclaimed arm
