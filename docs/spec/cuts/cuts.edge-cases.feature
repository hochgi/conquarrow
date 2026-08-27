# language: en
# Overview: docs/spec/cuts/cuts.md
# SPEC §6.1, §6.1a, §11 items 24, 26, 27, 28, 50

Feature: Cuts — firebreak sieges, headless trail, and seams
  As the rules engine
  I want the shapes that look like special cases to resolve as ordinary evaporation
  So that §6.1's claim — forks need no rule of their own — is testable

  Background:
    Given a fixture board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Halt is per arrow, never per point

    Scenario: A head on another arrow of the cut point does not shield against fire
      Given point P has player B's trail on one out-arrow o1
      And a head of player B's stands on a different arrow of P
      And a forward front enters o1
      When the front resolves on o1
      Then the head on the other arrow does not halt that front
      # §6.1 / item 27: combat and fire sit on different axes; point-wide shield withdrawn.

  Rule: Headless trail is ordinary

    Scenario: A mid-trail cut leaves a headless stretch behind the cut
      Given player B's trail runs past point P with no head on the stretch behind P
      When player A cuts at P
      Then the surviving stretch behind the destroyed region remains in player B's trail
      And it may have no head on it
      # §6.1a: no cleanup pass; a head may walk onto it later.

  Rule: Interactions

    Scenario: A cut mid-closure destroys the trail before it can claim
      Given player A's trail is one step from landing on their own territory
      And player B cuts that trail
      When the cut resolves
      Then the destroyed arrows are no longer in player A's trail
      And no new territory of player A's appears from that path
      # P05b's claim needs the trail; evaporation removes it.

    Scenario: Cut after combat on the same step uses the post-combat trail
      Given player A's step onto arrow e1 both contacts an enemy group and crosses that player's trail
      When the step resolves
      Then contact combat is applied first
      And then the cut evaporates against the trail set
      # Trail is independent of heads (§6.1a). Order settled for P06.

  Rule: A cut on one arm still respects firebreaks on the other (P47)

    Scenario: A garrison on the sibling arm halts that arm
      Given player B's trail forks at point Q into arms X and Y
      And a head of player B's stands on arm Y
      And a cut arrives along arm X
      When the cut resolves
      Then empty trail on arm X is gone
      And the garrisoned arrow of arm Y remains in player B's trail
      And trail beyond that garrison on arm Y is unchanged
      # Halt-at-first still bounds the region. P47 floods the sibling; it does not walk through a firebreak.

    Scenario: An interleave that does not land on the trail still floods the sibling
      Given player B's trail uses one out-arrow of point P and forks further along
      And a head of player A's steps onto a different out-arrow of P
      And that step's chord interleaved with player B's trail at P
      When the cut resolves
      Then every ungarrisoned arm of that fork is no longer in player B's trail
      # Playtest 2026-08-27: F 0,-1,1 → -1,0,1 did not coincide; dHadExit was false.

    Scenario: A coincide landing continues past the cutter
      Given player B's trail uses out-arrow e1 of point P and continues beyond e1
      And no head of player B's stands on e1 or on the next trail arrow
      When player A steps onto e1
      Then e1 is no longer in player B's trail
      And the next trail arrow beyond e1 is no longer in player B's trail
      And player A's stack stands on e1

    Scenario: A combat wipe on one fork arm evaporates the sibling
      Given player B's trail forks at point Q into ungarrisoned arms X and Y
      And a stack of player B's on arm X is wiped to 0 heads
      When the wipe evaporates from that arrow
      Then arm X is no longer in player B's trail
      And arm Y is no longer in player B's trail
      # Shared flood: evaporateFromArrow uses the same all-to-all region as a crossing.

    Scenario: A birth on one fork arm evaporates the sibling
      Given player B's trail forks at point Q into ungarrisoned arms X and Y
      And a spawner emits an enemy head onto arm X
      When the birth-cut evaporates from that arrow
      Then arm X is no longer in player B's trail
      And arm Y is no longer in player B's trail
      And the newborn still stands on arm X
      # P40 trigger, P47 region. The newborn is not the victim's firebreak.

  Rule: Playtest 2026-08-27 — leftover sibling on the tiling

    Scenario: F's interleave at p:-1,0 evaporates D's sibling out -1,1,0
      Given the generated tiling behind GeometryPort
      And D's trail includes -1,1,2, -1,1,0, -1,0,2 and -1,-1,1
      And a head of D's stands on -1,-1,1
      And F's 4-stack stands on 0,-1,1
      When F steps that stack onto -1,0,1
      Then -1,1,0 is no longer in D's trail
      And -1,-1,1 remains in D's trail
      And D's head still stands on -1,-1,1
      And F's 4 heads stand on -1,0,1
      # Item 50 / playtest 2026-08-27. Interleave, not coincide. Authored tiling
      # occupancy matching that position — not a 235-move fold. D's sentry is the
      # firebreak; F is not.

  Rule: Purity and determinism

    Scenario: Applying a cut does not mutate the input state
      Given a state S0 in which player A can cut player B
      When I apply the cutting step to S0 yielding S1
      Then S0's trails and groups are unchanged
      And S1's trails differ where the cut destroyed arrows

    Scenario: Equal inputs yield equal ordered trail removals
      Given two states differing only in the insertion order of player B's trail set
      When I apply the same cutting step to each
      Then the two resulting trail sets enumerate equal contents in the same order

    Scenario: No vertex is enumerated
      Given any cut on a fixture board
      When it resolves
      Then no vertex identifier is requested beyond what an idle move requests
