# language: en
# Overview: ./delete-skip-move.md — P51, deletion. No behavioural delta.

Feature: Skip is not a move
  As a player whose declining was never a decision the engine recorded
  I want no move kind that means "I did nothing"
  So that a match log records only what actually happened on the board

  Background:
    Given a GameState and a RulesPort
    And it is player A's turn

  Rule: The move vocabulary has no skip

    Scenario: The move kinds are step and end turn
      When the move kinds are listed
      Then they are exactly step and endTurn

    Scenario: No state offers a skip
      Given any live state with movable stacks of A
      When the legal moves are listed
      Then no offered move has kind skip

  Rule: Declining is still legal

    Scenario: No step is ever compelled
      Given A has a movable stack on a1
      When the legal moves are listed
      Then end turn is offered

    Scenario: A stack may be left where it is
      Given A has movable stacks on a1 and a2
      When A steps the stack on a1 and ends the turn
      Then the stack on a2 is where it was
      And no move naming a2 was recorded

  Rule: The offer is never empty

    Scenario: A stack with allowance and no landable exit offers nothing
      Given A has a stack on a4 with allowance remaining
      And every exit from a4 is unlandable
      When the legal moves are listed
      Then no offered move names a4
      And end turn is offered

  Rule: A match log records no skip

    Scenario: A turn of steps logs only steps and the end turn
      Given a match log recording A's turn
      When A steps twice and ends the turn
      Then the log holds two steps and one end turn
      And the log holds no record of kind skip
