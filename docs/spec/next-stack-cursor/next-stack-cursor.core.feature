# language: en
# Overview: ./next-stack-cursor.md — P50, web adapter only.

Feature: Next stack cursor
  As a player with several stacks that can still act
  I want a button that walks me through them one at a time
  So that I can find the stack I have not played yet without hunting the board

  Background:
    Given a GameState and a RulesPort
    And it is player A's turn
    And the cursor is an adapter concept that changes no GameState

  Rule: The cursor advances through every movable arrow

    Scenario: The first press selects the baseline first arrow
      Given movable arrows a1, a2 and a3 in baseline order
      And no seat has acted yet
      When A's turn begins
      Then the cursor is on a1

    Scenario: A press advances to the baseline successor
      Given movable arrows a1, a2 and a3 in baseline order
      And the cursor is on a1
      When next stack is pressed
      Then the cursor is on a2

    Scenario: The cursor wraps at the end of the lap
      Given movable arrows a1, a2 and a3 in baseline order
      And the cursor is on a3
      When next stack is pressed
      Then the cursor is on a1

    Scenario: A full lap visits every movable arrow exactly once
      Given movable arrows a1, a2 and a3 in baseline order
      And the cursor is on a1
      When next stack is pressed twice
      Then the cursor has been on a1, a2 and a3
      And no arrow has been selected twice
      # The current picker fails this: it oscillates between a1 and a2 and never
      # reaches a3.

  Rule: Pressing next stack is not a move

    Scenario: No move is emitted
      Given movable arrows a1 and a2
      And the cursor is on a1
      When next stack is pressed
      Then no move is applied
      And the GameState is unchanged

    Scenario: Nothing is written to the match log
      Given a match log recording A's turn
      And the cursor is on a1
      When next stack is pressed
      Then the match log is unchanged
      And it contains no skip

    Scenario: The button is usable with nothing selected
      Given movable arrows a1 and a2
      And the cursor is on nothing
      When next stack is pressed
      Then the cursor is on a movable arrow

  Rule: A committed step advances the cursor by the same rule

    Scenario: A step that exhausts its stack advances to the successor
      Given movable arrows a1, a2 and a3 in baseline order
      And the stack on a1 has one step of allowance left
      When A steps the whole stack from a1 to an empty arrow
      And that step exhausts the moved stack
      Then the cursor is on a2

    Scenario: A partial step preempts to its destination
      Given a stack of 5 heads on a1 with allowance remaining
      And movable arrows a1, a2 and a3 in baseline order
      When A steps 2 heads from a1 to empty arrow a9
      And the stack on a9 can still act
      Then the cursor is on a9

    Scenario: The lap resumes from the preempted arrow
      Given the cursor has been preempted to a9
      And a9 is last in baseline order
      When next stack is pressed
      Then the cursor is on the first movable arrow in baseline order

  Rule: A turn begins on the stack that acted last

    Scenario: The last stack acted on is selected next turn
      Given A acted on a1, then a2, then a3 during A's previous turn
      And a3 still holds a movable stack of A
      When A's turn begins
      Then the cursor is on a3

    Scenario: A gone stack falls back to the next most recent
      Given A acted on a1, then a2, then a3 during A's previous turn
      And a3 no longer holds a stack of A
      And a2 still holds a movable stack of A
      When A's turn begins
      Then the cursor is on a2
