# language: en
# Overview: docs/spec/convert-spent/convert-spent.md
# SPEC §6.3, §3, §11 item 40 (P70). ADR 0005.

Feature: Converted stacks stay spent, and the hand-off is not a vanish
  As a player watching a capture
  I want the spent state and the cue to survive merges, motion settings, and nearby stacks
  So that the flip stays readable and the rest of the turn does not change

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Prior spending does not carry, and neither does a fresh allowance

    Scenario: A victim's spent and merge override are discarded
      Given player B's encircled stack has spent greater than 0 and a merge override
      When it converts to player A
      Then its spent equals the speed of its heads
      And it has no merge override
      And legalMoves offers no step from its arrow

    Scenario: A larger friendly arrival does not wake the converted stack
      Given player A has converted player B's 1-stack
      And that group's spent equals the speed of 1 head
      When player A steps 2 heads from another group onto that arrow
      Then the merged group offers no step

    Scenario: An equal friendly arrival does not wake the converted 1-stack
      Given player A has converted player B's 1-stack
      When player A steps 1 head from another group onto that arrow
      Then the merged group's spent equals the speed of 1 head
      And the merged group offers no step

    Scenario: Joining a converted 3-stack keeps the spent
      Given player A has converted player B's 3-stack
      And that group's spent equals the speed of 3 heads
      When player A steps 1 head from another group onto that arrow
      Then the merged group's spent equals the speed of 3 heads
      And the merged group offers no step

    Scenario: A group that does not convert keeps its spent
      Given player B has a stack on neutral ground with spent 1
      And that stack is not encircled
      When player A plays a step that converts a different stack
      Then the neutral stack is still owned by B
      And its spent is still 1

    Scenario: Stepping the converted stack is refused
      Given player A has converted player B's stack on an arrow
      When a step from that arrow is applied
      Then the step was not in legalMoves
      And apply throws

  Rule: Capture bookkeeping that P70 does not reopen

    Scenario: Conversion conserves heads
      Given a state whose occupancy change this apply is conversion
      When the converting step resolves
      Then the sum of all group head counts is unchanged

    Scenario: Convert wipe still clears the victim trail on the converted arrow
      Given player B's trail contains the arrow their stack converts on
      When the stack converts
      Then that arrow is absent from B's trail

    Scenario: A self-convert step stays illegal
      Given player B stands on stack-grade trail
      And the grain exit is player A's territory
      When legalMoves is asked
      Then no step onto that exit is offered

  Rule: The hold is spectated, and the paint is not a vanish

    Scenario: Reduced motion holds without the alternation
      Given playback is spectated
      And reduced motion is on
      And playback speed is 3
      When the gap after a step that converted a stack is asked
      Then the gap is 500 ms

    Scenario: A non-spectated converting step does not take the hold
      Given playback is not spectated
      And playback speed is 1
      When the gap after a step that converted a stack is asked
      Then the gap is 400 ms

    Scenario: Two converted stacks share one fit
      Given two converted centroids and the step's arrows
      When the converting step is framed
      Then one fit contains every one of those centroids
      And both hand-offs share one start

    Scenario: A span past the fit cap hard-cuts
      Given converted centroids whose padded half-diagonal exceeds FIT_CAP_RADIUS
      When the converting step is framed
      Then the fit is a hard cut

    Scenario: The hand-off ends on the new colour and is not a vanish
      Given the conversion stylesheet
      When the outgoing plate's keyframes are read
      Then the beats are opaque, transparent, opaque, transparent
      And the 100% keyframe is transparent
      And the un-animated plate is transparent
      And the plate stays transparent until the beats start
      And the beats change in steps
      And there is no new-accent ring
      And the animation is not flicker-then-fade
