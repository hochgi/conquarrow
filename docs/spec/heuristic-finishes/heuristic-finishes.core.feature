# language: en
# Overview: docs/spec/heuristic-finishes/heuristic-finishes.md
# Adapter only — the heuristic seat's search and finisher, not a game rule

Feature: The heuristic seat finishes a won match
  As the local heuristic seat holding a large head surplus
  I want my turn search to see past the first step, to score idling honestly, and to take the losing seat's ground
  So that a mirror match ends with a winner instead of hoarding to the round cap

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And chooseTurnBeam from botSearch, the live seat's search

  Rule: The seed-1 hoarding position no longer stalls

    Scenario Outline: The archived seed-1 mirror position at round <round> takes a step
      Given the committed replay fixture "mirror-s1" replayed from makeMatch of the P79 seed-1 config to the start of seat A's turn in round <round>
      And seat A holds <heads> heads and seat B holds at most 5
      When chooseTurnBeam plans seat A's turn
      Then the returned plan contains at least one step
      And every move of the plan is legal in sequence and the plan ends seat A's turn

      Examples:
        | round | heads |
        | 60    | 91    |
        | 160   | 403   |

  Rule: A dominant seat takes enemy ground it can reach this turn

    Scenario: A carve through the enemy's territory is played
      Given seat A is dominant: A's heads are at least twice B's
      And a stack S1 of A stands on A's territory with speed for a loop of 3 or more steps
      And a loop from S1 leaves A's territory, crosses at least one arrow of B's territory, and lands back on A's territory within that speed
      When chooseTurnBeam plans seat A's turn
      Then after the plan A's territory is larger than before
      And after the plan B's territory is smaller than before

  Rule: A dominant seat with nothing in reach walks toward the enemy

    Scenario: An interior stack walks toward the arrow that borders the enemy
      Given seat A is dominant
      And no loop from any of A's stacks reaches B's territory this turn
      And a stack S1 of A with 4 or more heads stands on A's territory, some arrows from A's entry arrows
      And every other plan A could play is quiet
      When chooseTurnBeam plans seat A's turn
      Then the plan moves S1 over A's own territory only
      And after the plan S1's grain distance to the nearest entry arrow is smaller than before
      And A's trail is unchanged

  Rule: A won position is converted, not hoarded

    Scenario: Self-play from a dominant position takes the loser's ground and ends the match
      Given the committed replay fixture "mirror-s1" replayed to the start of round 160
      When both seats are played by playBotTurn for at most 30 rounds
      Then the match has a winner
      And the winner is the seat that held more heads at round 160

  Rule: Determinism

    Scenario: The same position planned twice gives the same plan
      Given the committed replay fixture "mirror-s1" replayed to the start of seat A's turn in round 160
      When chooseTurnBeam plans seat A's turn twice from that state
      Then the two move lists are identical
