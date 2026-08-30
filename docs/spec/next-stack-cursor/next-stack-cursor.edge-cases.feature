# language: en
# Overview: ./next-stack-cursor.md — P50, web adapter only.

Feature: Next stack cursor — edge cases
  As a player whose board changes under the cursor
  I want the cursor to stay on something I can actually act with
  So that a split, a death or a blocked stack never strands the selection

  Background:
    Given a GameState and a RulesPort
    And it is player A's turn

  Rule: Movable is what the rules offer, not what allowance suggests

    Scenario: A stack with allowance but no legal step is not selected
      Given a stack on a4 with allowance remaining
      And no step from a4 is offered
      And movable arrows a1 and a2
      When the cursor laps
      Then the cursor is never on a4

    Scenario: Nothing movable leaves the cursor on nothing
      Given no step is offered to A
      When A's turn begins
      Then the cursor is on nothing

    Scenario: A single movable arrow is re-selected by a press
      Given a1 is the only movable arrow
      And the cursor is on a1
      When next stack is pressed
      Then the cursor is on a1

  Rule: Preemption precedence

    Scenario: Destination wins over source remainder
      Given a stack of 5 heads on a1 with allowance remaining
      When A steps 2 heads from a1 to empty arrow a9
      And both the remainder on a1 and the stack on a9 can still act
      Then the cursor is on a9

    Scenario: Source remainder is taken when the destination cannot act
      Given a stack of 5 heads on a1 with allowance remaining
      When A steps 2 heads from a1 to a9
      And the stack on a9 cannot act again this turn
      And the remainder on a1 can still act
      Then the cursor is on a1

    Scenario: Neither can act, so the lap continues
      Given movable arrows a1, a2 and a3 in baseline order
      And the cursor is on a1
      When A steps from a1 to a9
      And neither a9 nor the remainder on a1 can act again
      Then the cursor is on a2

    Scenario: A merge into a stack with allowance left preempts
      Given a movable stack on a9 with allowance remaining
      When A steps heads from a1 onto a9
      And the merged stack on a9 can still act
      Then the cursor is on a9

    Scenario: A merge that exhausts the merged stack does not preempt
      Given a stack on a9
      And movable arrows a1, a2 and a3 in baseline order
      And the cursor is on a1
      When A steps heads from a1 onto a9
      And the merged stack on a9 cannot act again this turn
      Then the cursor is on a2
      # A merge costs the stack its speed bonus for the turn (SPEC §3), so this
      # is the ordinary case, not the exotic one.

    Scenario: A preempted arrow is not offered again in the same lap
      Given movable arrows a1, a2, a3 and a9 with a9 last in baseline order
      And the cursor is preempted from a1 to a9
      When next stack is pressed twice
      Then the cursor has been on a1, a2 and a3
      And the cursor has not returned to a9

  Rule: The movable set changes under the cursor

    Scenario: A newly created stack is reached later in the lap
      Given movable arrows a1, a2 and a3 in baseline order
      And the cursor is on a3 after a split created a movable stack on a2
      When next stack is pressed
      Then the cursor is on a1
      And a further press puts the cursor on a2

    Scenario: The cursor's own arrow stops being movable
      Given the cursor is on a2
      And a2 stops being movable
      When next stack is pressed
      Then the cursor is on the next movable arrow after a2 in baseline order

    Scenario: Every other arrow stops being movable
      Given movable arrows a1 and a2
      And the cursor is on a1
      And a2 stops being movable
      When next stack is pressed
      Then the cursor is on a1

    Scenario: The last movable arrow is spent
      Given a1 is the only movable arrow
      And the cursor is on a1
      When A spends the last allowance on a1
      Then the cursor is on nothing

  Rule: Turn anchoring across seats

    Scenario: Each seat anchors on its own history
      Given A acted last on a1 and B acted last on b1
      When A's turn begins, then B's turn begins
      Then A's turn began with the cursor on a1
      And B's turn began with the cursor on b1
      # Hot seat interleaves the seats, so a single shared history would be wiped
      # by the other seat before its owner could read it.

    Scenario: A seat's recency is cleared after it is read
      Given A acted on a1 and then a2 during A's previous turn
      When A's turn begins
      And A acts on a3 and ends the turn
      Then A's next turn begins with the cursor on a3

    Scenario: The whole previous turn is gone
      Given every arrow A acted on during A's previous turn no longer holds a
        movable stack of A
      And movable arrows a5 and a7 in baseline order
      When A's turn begins
      Then the cursor is on a5

    Scenario: A seat that has never acted
      Given A has not acted in the match
      And movable arrows a1 and a2 in baseline order
      When A's turn begins
      Then the cursor is on a1

    Scenario: Acting twice on one arrow leaves one entry
      Given A acted on a1, then a2, then a1 again during A's previous turn
      And both a1 and a2 still hold movable stacks of A
      When A's turn begins
      Then the cursor is on a1

    Scenario: Recency does not survive a reload
      Given A acted last on a1
      And the client is reloaded
      And movable arrows a5 and a7 in baseline order
      When A's turn begins
      Then the cursor is on a5

  Rule: Camera behaviour is unchanged

    Scenario: An on-screen selection does not move the camera
      Given the cursor advances to an arrow already within the viewport margin
      Then the viewport is unchanged

    Scenario: An off-screen selection pans into view
      Given the cursor advances to an arrow outside the viewport margin
      Then the viewport pans until that arrow is within the margin
