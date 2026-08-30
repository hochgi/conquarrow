# language: en
# Overview: docs/spec/encirclement/encirclement.md
# SPEC §6.3, §11 item 40

Feature: Encirclement — boundaries, conservation, and purity
  As the rules engine
  I want the non-triggers and conservation pinned as scenarios
  So that conversion cannot quietly destroy heads or fire on neutral ground

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Neutral stranded is not capture

    Scenario: A stack-grade fragment on neutral ground does not convert
      Given player B stands on an arrow with no territory owner
      And B's trail is stack grade
      When an apply resolves
      Then the group remains owned by B

    Scenario: A stack on its own territory never converts
      Given player B stands on B's territory
      When an apply resolves
      Then the group remains owned by B

  Rule: Conversion wipes the connected trail (P33)

    Scenario: Victim trail on a different component survives convert wipe
      Given conversion flips a stack on arrow e1
      And player B still holds trail arrows on a separate component the wipe does not reach
      When conversion resolves
      Then those other trail arrows remain in B's trail
      # Convert wipe reuses halt-at-first; it does not delete unrelated marks.

  Rule: Head conservation and purity

    Scenario: Conversion alone conserves total heads on the board
      Given a state whose only occupancy change this apply is conversion
      When conversion resolves
      Then the sum of all group head counts is unchanged

    Scenario: Applying conversion does not mutate the input state
      Given a state S0 in which a convertible group exists
      When I apply a step that converts yielding S1
      Then S0's groups are unchanged
      And S1 shows the converted ownership

    Scenario: Equal inputs yield equal conversion outcomes
      Given the same geometry and convertible setup
      When I apply the converting step twice from equal copies
      Then both resulting states have equal group maps in the same order

  Rule: Order and seams

    Scenario: The P05b seam — claimed arrow with enemy heads — now converts
      Given a closure claims an arrow occupied by player B with no territory-grade trail
      When the closure commits
      Then that group is owned by the claimer
      # Replaces the P05b "leaves standing" observation.

    Scenario: Not stepping does not itself convert an already-convertible authored state
      Given an authored state where player B is already encircled on A's territory
      When player A steps nothing and ends the turn
      Then the groups, territory and trails are unchanged
      # Conversion runs on state-changing steps (applyStep), and nothing else.
      # The prior apply that created the condition is what should have converted.
