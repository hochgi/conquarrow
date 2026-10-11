# language: en
# Overview: docs/spec/convert-spent/convert-spent.md
# SPEC §6.3, §11 item 40 (P70). ADR 0005.

Feature: A converted stack is spent for the capturing turn
  As the rules engine and the spectated board
  I want a converted stack to have no step left, and the flip to sit on its tile
  So that a same-turn departure cannot hide whose head it was

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Conversion spends the stack

    Scenario: A converted 1-stack offers no step
      Given player B has 1 head on an arrow that player A's closure will claim
      And that head has no territory-grade trail for B
      When player A completes the closure
      Then the group on that arrow is owned by A with 1 head
      And its spent equals the speed of 1 head
      And it has no merge override
      And legalMoves offers no step from that arrow

    Scenario Outline: Stacks of every speed are spent out
      Given player B has <heads> heads on an arrow that player A's closure will claim
      And that stack has no territory-grade trail for B
      When player A completes the closure
      Then the group on that arrow is owned by A with <heads> heads
      And its spent equals the speed of <heads> heads
      And legalMoves offers no step from that arrow

      Examples:
        | heads |
        | 1     |
        | 2     |
        | 3     |
        | 4     |

    Scenario: The capturer's other stack can still step
      Given player A converts player B's stack on one arrow
      And player A has another group with allowance remaining on a different arrow
      When the converting step resolves
      Then legalMoves offers a step from that other arrow

    Scenario: Ending the capturing turn clears the spent
      Given player A has just converted player B's stack
      When player A ends the turn
      Then that group's spent is 0
      And it has no merge override

  Rule: The hand-off sits on the tile

    Scenario: One conversion plays a 700 ms hand-off after the cut
      Given a step whose events include one unitsConverted
      When the step is presented
      Then there is one conversion overlay for that arrow
      And its offset is 300 ms
      And its duration is 700 ms
      And the overlay carries the head count and both owners

    Scenario: Two conversions on one step share the hand-off
      Given a step whose events include two unitsConverted
      When the step is presented
      Then both conversion overlays have offset 300 ms and duration 700 ms

    Scenario Outline: A spectated converting step waits out the hand-off and the hold
      Given playback is spectated
      And reduced motion is off
      And playback speed is <speed>
      When the gap after a step that converted a stack is asked
      Then the gap is 1500 ms

      Examples:
        | speed |
        | 1     |
        | 2     |
        | 3     |

    Scenario: A spectated step that converts nothing keeps the ordinary gap
      Given playback is spectated
      And playback speed is 2
      When the gap after a step that converted nothing is asked
      Then the gap is 200 ms

  Rule: The camera looks at the stack before the colours trade

    Scenario: A converted stack outside the shot is framed first
      Given a viewport whose safe box does not contain a converted centroid
      When the converting step is framed
      Then the fit contains that centroid and the step's arrows
      And the hand-off does not start until the ease finishes

    Scenario: A converted stack already in the shot does not move the camera
      Given a viewport whose safe box already contains every converted centroid
      When the converting step is framed
      Then the camera target is unchanged
      And no ease is requested
