# language: en
# Overview: docs/spec/crossings/crossings.md
# SPEC §2 (trails own points, the chord test), §6.1a (all-to-all points), §11 item 26

Feature: A trail's chords at a point, and who crossed whom
  As the rules engine
  I want a trail's chords read off its arrow set and tested one by one
  So that crossing is decided by geometry rather than by a pairing nobody recorded

  Background:
    Given a fixture board behind GeometryPort
    And a game state of occupancy, trails and territory
    And chord extraction and the crossing queries are pure — they change nothing

  Rule: A player's trail presents i × o chords at a point

    §6.1a: where a trail uses i in-arrows and o out-arrows at a point, that point
    is a join followed by a split and every in feeds every out. There is no pairing
    in the set to recover, so none is guessed.

    Scenario Outline: The chord count is the product, not the maximum
      Given point P has <i> of player A's trail arrows pointing in
      And P has <o> of player A's trail arrows pointing out
      When I ask for player A's chords at P
      Then there are <chords> of them
      And every pair of one in-arrow and one out-arrow appears exactly once

      Examples:
        | shape            | i | o | chords |
        | spine            | 1 | 1 | 1      |
        | join             | 2 | 1 | 2      |
        | split            | 1 | 2 | 2      |
        | crossover        | 2 | 2 | 4      |
        | triple crossover | 3 | 3 | 9      |

    Scenario: A trail that only arrives at a point presents no chord there
      Given point P has 1 of player A's trail arrows pointing in
      And P has none of player A's trail arrows pointing out
      When I ask for player A's chords at P
      Then there are none
      # The tip of a trail. It owns the arrow it stands on, but it has not
      # transited the point ahead of it, so there is nothing to cross yet.

    Scenario: Chords are read through slotOf, never inferred from an identifier
      Given point P has one of player A's trail arrows pointing in and one pointing out
      When I ask for player A's chords at P
      Then each endpoint of the chord is the slot GeometryPort reports for that arrow
      # The port exposes slotOf rather than an opaque verdict precisely so this is
      # checkable. An engine that parsed an arrow id would pass on the tiling and
      # fail on a fixture.

  Rule: A traversal crosses an enemy trail on interleave or on coincidence

    §2's single test covers both real cases: threading between two of their arrows,
    and landing directly on one.

    Scenario: Threading between two of the enemy's arrows is a crossing
      Given player B's trail passes through point P on one in-arrow and one out-arrow
      And player A holds a head on an in-arrow of P that is not player B's
      And exit e1 is an out-arrow of P whose chord interleaves with player B's
      When I ask whether stepping from that head onto e1 crosses player B
      Then it does
      # Interleave: A's pair separates B's around the circle of six slots.

    Scenario: Landing on one of the enemy's own arrows is a crossing
      Given player B's trail passes through point P on one in-arrow and one out-arrow
      And player A holds a head on an in-arrow of P
      And exit e1 is the out-arrow player B's trail uses at P
      When I ask whether stepping from that head onto e1 crosses player B
      Then it does
      # Coincidence: A's exit arrow *is* one of B's trail arrows. This is what
      # subsumes the tile rule — an enemy cannot stand on your trail arrow without
      # entering through its tail point, which your trail also uses.

    Scenario: Landing on a trail stub is a crossing
      Given player B's trail uses out-arrow e1 of point P and no in-arrow of P
      And player A holds a head on an in-arrow of P
      When I ask whether stepping from that head onto e1 crosses player B
      Then it does
      # SPEC §2: coincide means the exit *is* a trail arrow. A dormant fragment's
      # tail presents no chord (i = 0), and landing on it is still a cut.
      And stepping onto a different out-arrow of P does not cross player B

    Scenario: Turning aside is not a crossing
      Given player B's trail passes through point P on one in-arrow and one out-arrow
      And player A holds a head on an in-arrow of P
      And exit e1 is an out-arrow of P whose chord stays on one side of player B's
      When I ask whether stepping from that head onto e1 crosses player B
      Then it does not
      # §2: a chord that stays on one side — turning aside rather than through — is
      # not a crossing.

    Scenario: The traversal is tested against every chord the trail presents
      Given player B's trail makes point P a crossover, presenting 4 chords
      And exactly one of those 4 chords interleaves with player A's intended chord
      And player A holds a head on an in-arrow of P
      When I ask whether stepping onto that exit crosses player B
      Then it does
      # One chord is enough. An implementation that tested only the first would
      # pass a spine and quietly fail a knot.

  Rule: Against your own trail, only an interleave counts

    Scenario: Re-traversing your own arrow does not self-cross
      Given player A's trail passes through point P on one in-arrow and one out-arrow
      And player A holds a head on an in-arrow of P
      And exit e1 is the out-arrow player A's own trail already uses at P
      When I ask whether stepping onto e1 self-crosses player A
      Then it does not
      # Coincidence cannot invert anything: the arrow is already in the set, so
      # re-traversing leaves the set unchanged (§6.1a) and §7's even-odd has
      # nothing to flip.

    Scenario: Looping back through your own point does self-cross
      Given player A's trail passes through point P on one in-arrow and one out-arrow
      And player A holds a head on a different in-arrow of P
      And exit e1 is an out-arrow of P whose chord interleaves with player A's own
      When I ask whether stepping onto e1 self-crosses player A
      Then it does
      # §7: crossing your own trail flips which lobes count as enclosed when the
      # path eventually lands. What it flips is P05b's; that it happened is here.

    Scenario: The same traversal can cross an enemy and not self-cross
      Given point P carries both players' trails
      And player A's intended exit coincides with player A's own trail arrow
      And that same exit interleaves with player B's chord at P
      When I ask both queries for that traversal
      Then it crosses player B
      And it does not self-cross player A
      # The predicate is shared and the question is not: §6.1 takes the full
      # verdict, §7 takes the interleave half alone.

  Rule: Crossing is a decision, not a tripwire

    The test is on the exit choice, so proximity commits to nothing. All three
    behaviours below are consequences of that and not rules of their own (§2).

    Scenario: Standing at a point the enemy's trail runs through crosses nothing
      Given player B's trail passes through point P
      And player A holds a head on an in-arrow of P
      When player A leaves that group standing and ends the turn
      Then no crossing is reported
      # No step is ever compelled (§6.2), which is what makes declining always
      # legal — and what makes the three behaviours below possible at all.

    Scenario: Shadowing an enemy trail never crosses it
      Given player B's trail runs along a corridor of points
      And player A walks a head alongside it, point after point
      And every exit player A chooses stays on one side of player B's chords
      When I ask for crossings after each step
      Then none is reported at any point
      # A head can travel beside an enemy trail indefinitely, choosing its moment.

    Scenario: Two trails race through one corridor until one of them turns
      Given both players' trails run through the same sequence of points
      And neither player's chords interleave with the other's at any of them
      When I ask for crossings along the whole corridor
      Then none is reported
      And when player A next chooses an interleaving exit
      Then a crossing is reported at that point alone
