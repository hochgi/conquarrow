# language: en
# See docs/spec/trails-simple/trails-simple.md (P22 + P42)

Feature: Simple trails — edge cases (P22 + P42)
  As a rules author
  I want boundaries for dormant, convert wipe, and a claim walk that ignores firebreaks
  So that paint continues through a sentry while evaporation still halt-at-first

  Background:
    Given a conformant fixture board
    And players A and B with disjoint starting territory

  Rule: No size-1 freeze

    Scenario: Sole stack-grade tip may vacate
      Given player A has a size-1 stack on a stack-grade fragment with no path to A's territory
      When A lists legal moves from that stack
      Then at least one grain step that vacates the arrow is legal

  Rule: Convert wipe is P33; cut tails still persist

    Scenario: Converted stack's connected empty trail evaporates; a disconnected cut tail stands
      Given player B has heads inside A's territory with only stack-grade trail
      And that trail continues onto empty trail arrows beyond the converted stack
      When conversion resolves
      Then the converted stack becomes A's at the same head count
      And B's trail is absent from the converted arrow
      And B's trail is absent from the empty arrows the convert wipe entered
      # Disconnected dormant from a cut, with no convert wipe reaching it, still stands
      # (core Rule "Dormant marks persist"; P33).

  Rule: Claim walk ignores firebreaks (P42)

    Scenario: Unanchored tip lands home — paint continues through the sentry
      Given player A has a dormant-or-stack-grade fragment with sentry S on arrow Fire
      And tip T beyond Fire with trail arrows between Fire and T
      And trail distal beyond Fire against the grain from Fire
      And the fragment has no territory-grade path before the landing
      When T steps onto A's territory and closes
      Then trail arrows from the departure back through Fire and the distal beyond Fire become A's territory
      And Fire is A's territory
      And S still stands on Fire

    Scenario: Territory-rooted tip lands — full walk including a mid sentry
      Given player A has a territory-rooted trail with a mid sentry
      When the tip lands on A's territory
      Then the full against-grain claim walk becomes territory
      And the mid sentry's arrow is claimed with the path if it lies on the walk

    Scenario: Playtest spine — six-arrow stack-grade landing claims the sentry and the tail
      # conquarrow-match-2026-08-23T181014-387Z seat F:
      # 2,-2,0 → 3,-2,2 → 3,-3,2 (F×1) → 3,-4,0 → 4,-4,2 → 4,-5,0 landing 5,-5,0
      Given player A's trail is the six-arrow against-grain spine T1, T2, T3, T4, T5, T6
      And T3 holds A's size-1 stack
      And T6 holds A's closing tip
      And the component is not territory-grade before the landing
      And T6's grain out L is A's territory
      When A steps the tip from T6 onto L
      Then T1, T2, T3, T4, T5 and T6 are all A's territory
      And none of those arrows remain in A's trail
      And A's stack on T3 still stands on T3
      And A's landing stack stands on L

    Scenario: Fork — landing claims the upstream arm including a sentry; the other arm stays trail
      Given player A's trail runs a stem to point P and forks into arms X and Y
      And a sentry of A's stands on arm X
      And a head of A's stands on the last arrow of arm X
      And the component is stack-grade before the landing
      When that head lands on A's territory
      Then the stem and every arrow of arm X are A's territory including the sentry's arrow
      And every arrow of arm Y is still in A's trail
      And no arrow of arm Y is A's territory

    Scenario: Merge — every in-arrow on the walk is claimed, occupied or not
      Given point P has two of A's trail in-arrows I1 and I2
      And I1 is occupied by A's stack
      And A's trail continues out of P toward the closing tip
      When the tip lands on A's territory
      Then I1 and I2 are both A's territory
      And A's stack still stands on I1

    Scenario: Unanchored empty trail — no mid sentry, full walk unchanged
      Given player A has a stack-grade fragment whose only occupied arrow is the closing tip
      And the fragment has no territory-grade path before the landing
      When the tip lands on A's territory
      Then every arrow on the against-grain walk becomes A's territory

  Rule: Conversion predicate unchanged

    Scenario: Territory-grade path resists conversion
      Given player B has a head inside A's territory
      And a continuous B trail path from that head to B's territory
      When encirclement is checked
      Then that head does not convert

    Scenario: Unanchored tip inside enemy territory converts
      Given player B has a tip inside A's territory with no trail path to B's territory
      When encirclement is checked
      Then that tip converts to A

  Rule: Re-attach wakes dormant marks

    Scenario: Friendly head steps onto dormant trail
      Given player A has dormant trail marks with no A stack on them
      When an A head steps onto one of those trail arrows from territory or trail
      Then the marks remain
      And the component's grade is recomputed from reachability

  Rule: Wipe still evaporates from emptied arrow

    Scenario: Combat wipe starts evaporation; distal beyond firebreak may remain
      Given player A has trail with a sentry beyond the wipe arrow
      When combat reduces A's stack on the wipe arrow to 0 heads
      Then evaporation runs from that arrow under the halt-at-first rule
      And trail beyond the sentry firebreak remains if the front halted there
