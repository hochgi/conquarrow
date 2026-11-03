# language: en
# Overview: docs/spec/heuristic-never-idle/heuristic-never-idle.md
# Adapter only — the live heuristic seat's return seam, not a game rule

Feature: The live heuristic seat never passes while a step is legal
  As the local heuristic seat
  I want my turn to take a step whenever one is legal
  So that I never sit out turns that I could have used, as chooseMove already guarantees

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And chooseTurnBeam from botSearch, the live seat's search, reached through playBotTurn

  Rule: The playtest positions where the seat passed now take a step

    Scenario Outline: Seat <seat> steps at the start of its round-<round> turn
      Given the committed fixture "playtest-2026-11-02" replayed from makeMatch of its config through move <index>
      And it is seat <seat>'s turn and seat <seat> has a legal step
      And the fixture's logged turn for seat <seat> at move <index> is a lone endTurn
      When playBotTurn plays seat <seat>'s turn
      Then the played moves contain at least one step
      And every played move is legal in sequence from that position
      And the played moves end seat <seat>'s turn or the match

      Examples:
        | round | seat | index |
        | 6     | A    | 53    |
        | 7     | A    | 60    |
        | 8     | A    | 68    |
        | 9     | A    | 77    |
        | 10    | A    | 86    |
        | 11    | A    | 95    |
        | 12    | A    | 103   |
        | 13    | A    | 111   |
        | 14    | A    | 120   |
        | 15    | A    | 129   |
        | 16    | A    | 138   |
        | 26    | B    | 264   |
        | 35    | A    | 404   |

  Rule: Stepping worse than passing still steps

    Scenario: A lone home 1-stack whose every one-step terminal evaluates worse than passing takes a step
      Given the P53 board "passIsBest": seat Bot holds one 1-stack on a one-arrow home in a 3-seat match
      And every legal one-step terminal evaluates strictly worse than passing
      And the best stepped complete evaluates worse than passing by more than IDLE_SLACK
      When chooseTurnBeam plans Bot's turn
      Then the plan contains at least one step
      And the plan is a legal sequence that ends Bot's turn

  Rule: A seat with no legal step still passes

    Scenario: No legal step returns only endTurn
      Given it is seat Bot's turn and rules.legalMoves offers no step
      When chooseTurnBeam plans Bot's turn
      Then the plan is exactly [endTurn]

  Rule: A plan that already steps is untouched

    Scenario: Turns that stepped in the playtest are reproduced move for move
      Given the committed fixture "playtest-2026-11-02" replayed from makeMatch of its config
      And the turns of seats A and B that start in rounds 1 to 20 and whose logged moves contain a step
      When playBotTurn plays each of those turns from its start position
      Then the played moves equal the logged moves of that turn

  Rule: chooseMove keeps its own rule

    Scenario: chooseMove still never passes while a step exists
      Given the P53 board "passIsBest" with at least one legal step for Bot
      When chooseMove picks Bot's move
      Then the move is a step
