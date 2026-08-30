Feature: A won match is over
  As a player who has just won
  I want the match to end on the move that won it
  So that the board stops accepting moves and the win is the last thing that happens

  Background:
    Given a GameState with players A, B and C, a GeometryPort and a RulesPort
    And each player owns territory, a spawner share and heads

  Rule: A won state offers nothing

    Scenario: No move is offered once a winner is set
      Given a state in which A is the winner
      When legal moves are asked for
      Then none are offered

    Scenario: Not even the pass is offered
      Given a state in which A is the winner
      When legal moves are asked for
      Then no end of turn is among them
      # Unlike a *lost* seat, which is offered the pass and nothing else (P37
      # invariant 4) because the round still has to advance through its slot. A won
      # match has no next turn, so a pass would mean nothing.

    Scenario: The winner is offered nothing either
      Given a state in which A is the winner
      And it is A's turn with allowance remaining
      When legal moves are asked for
      Then none are offered

  Rule: A won state refuses every move

    Scenario Outline: Each move kind is refused
      Given a state in which A is the winner
      When <move> is applied
      Then it is refused with a ContractViolation
      And the input state is unchanged

      Examples:
        | move          |
        | a step        |
        | an end of turn |

    Scenario: The refusal happens before the board is read
      Given a state in which A is the winner
      And a step whose source holds no group at all
      When that step is applied
      Then it is refused for the match being over, not for the empty source
      # The gate is at the top of `apply`. A caller who mistakes a finished match
      # for a live one should be told that, not handed a movement diagnostic.

  Rule: The deciding move is not truncated

    Scenario: A closure that wins still claims its ground
      Given C's last territory lies inside a loop A can close in one step
      When A takes that step
      Then the winner is A
      And the enclosed arrows belong to A in the state that step returns

    Scenario: A closure that wins still converts the stack it encircled
      Given C's last territory lies inside a loop A can close in one step
      And a C stack stands on an arrow that loop encloses
      When A takes that step
      Then the winner is A
      And that stack belongs to A in the state that step returns

    Scenario: A move is never refused for the win it causes
      Given A is one step from taking C's last territory
      When A takes that step
      Then it is not refused
      And the winner is A
