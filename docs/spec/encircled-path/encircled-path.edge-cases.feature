# language: en
# Overview: docs/spec/encircled-path/encircled-path.md
# SPEC §6.3, §6.1, §11 item 40 (P33)

Feature: Encircled path — halt, other components, and cut tails
  As the rules engine
  I want convert wipe to reuse halt-at-first and leave unrelated trail alone
  So that a surviving raider and a cut tail are not silently deleted

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Halt-at-first still bounds convert wipe

    Scenario: A remaining victim stack on neutral ground is a firebreak
      Given player B has a stack on A's territory with stack-grade trail
      And that trail continues onto unclaimed arrows to a B stack on neutral ground
      When the stack on A's territory converts
      Then B's trail is absent from the converted arrow and the empty arrows the wipe entered
      And B's trail remains on the neutral stack's arrow
      And B's trail remains beyond that firebreak away from the wipe

  Rule: Unrelated trail is not convert wipe

    Scenario: A different territory-grade component of the same victim is untouched
      Given player B has a stack-grade fragment that converts on A's territory
      And B also has a separate territory-grade trail into A's land
      When the fragment converts
      Then the fragment's trail evaporates under convert wipe
      And the separate territory-grade trail remains B's
      And the protected stack on that trail remains owned by B

    Scenario: Cut-created dormant with no convert still stands
      Given player A has dormant trail marks from a cut, with no convert this apply
      When the apply resolves
      Then those dormant marks remain in A's trail

  Rule: Closure strip and convert bookkeeping still hold

    Scenario: Bare enemy trail on newly claimed tiles is stripped even with no stacks
      Given player B has trail on arrows player A's closure will claim
      And no B group stands on those arrows
      When player A completes the closure
      Then B's trail is absent from every claimed arrow

    Scenario: Converted stacks stay intact with spent 0
      Given player B's converting stack has heads N greater than 1 and spent greater than 0
      When it converts
      Then the group is owned by A with N heads
      And spent is 0

    Scenario: Not stepping does not convert and does not wipe
      Given an authored state where player B is already encircled on A's territory
      When player A steps nothing and ends the turn
      Then the groups, territory and trails are unchanged

    Scenario: Convert wipe conserves heads and does not mutate its input
      Given a state whose occupancy change this apply is conversion
      When the converting step yields S1 from S0
      Then the sum of all group head counts is unchanged
      And S0's groups and trails are unchanged
      And applying the same step to an equal copy of S0 yields equal trails
