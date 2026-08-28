# language: en
# Overview: docs/spec/movement/movement.md
# SPEC §3 (speed, merge, allowance), §4 (turn structure), §2 (grain), §11 items 19–22

Feature: Movement, stacks and the turn loop
  As the active player
  I want to spend an ordered list of steps against an occupancy map
  So that stacking, splitting and turn order are real tactics before trails or
  combat enter the game

  Background:
    Given a fixture board behind GeometryPort
    And a game state of occupancy, spent counters and merge overrides
    And it is player A's turn

  Rule: A step follows the grain and relocates a portion of a group

    Scenario: A legal step moves heads onto an empty out-arrow
      Given arrow a1 holds 1 head belonging to player A
      And exit e1 is an out-arrow of the target of a1
      And e1 is empty
      When player A applies a step of count 1 from a1 to e1
      Then a1 is empty
      And e1 holds 1 head belonging to player A
      And the group on e1 has spent 1

    Scenario: A partial step leaves the remainder on the source
      Given arrow a1 holds 3 heads belonging to player A
      And exit e1 is an out-arrow of the target of a1
      And e1 is empty
      When player A applies a step of count 1 from a1 to e1
      Then a1 holds 2 heads belonging to player A
      And e1 holds 1 head belonging to player A

    Scenario: A whole-stack step vacates the source
      Given arrow a1 holds 2 heads belonging to player A
      And exit e1 is an out-arrow of the target of a1
      And e1 is empty
      When player A applies a step of count 2 from a1 to e1
      Then a1 is empty
      And e1 holds 2 heads belonging to player A

  Rule: Allowance is speed(N), spent, and nothing banks

    Scenario Outline: A fresh group gets exactly speed(N) steps
      Given arrow a1 holds <n> heads belonging to player A
      And the group on a1 has spent 0
      When I ask for the group's effective speed
      Then it is <speed>
      # speed(N) = 1 + floor(log2 N). Nothing carries between turns.

      Examples:
        | n  | speed |
        | 1  | 1     |
        | 2  | 2     |
        | 3  | 2     |
        | 4  | 3     |
        | 8  | 4     |
        | 16 | 5     |

    Scenario: A stack may take several steps in one turn while allowance remains
      Given arrow a1 holds 4 heads belonging to player A
      And a path of three successive out-arrows e1, e2, e3 each empty
      When player A steps the whole stack a1 → e1 → e2 → e3
      Then each step succeeds
      And the group on e3 has spent 3
      And no further step from e3 is legal for player A

    Scenario: Two stacks may interleave their steps
      Given arrow a1 holds 2 heads belonging to player A
      And arrow a2 holds 2 heads belonging to player A
      And each has a legal empty exit
      When player A steps once from a1
      And player A steps once from a2
      And player A steps again from a1
      Then both groups have spent according to their own steps
      And neither group's spent was charged to the other

    Scenario: Ending the turn discards unused allowance
      Given arrow a1 holds 4 heads belonging to player A
      And the group has spent 1 of its speed 3
      When player A ends the turn
      Then it is player B's turn
      And every spent counter is 0
      And every merge override is cleared

  Rule: Splitting inherits spent; only the moving part pays

    Scenario: After one step, a split leaves a remainder that may still act
      Given arrow a1 holds 4 heads belonging to player A
      And the group has spent 1
      And exits e1 and e2 are distinct legal empty out-arrows from a1's target
      When player A applies a step of count 2 from a1 to e1
      Then a1 holds 2 heads with spent 1
      And e1 holds 2 heads with spent 2
      And a further step from a1 is still legal
      # Both parts inherited spent 1; only the movers paid +1.

    Scenario: A fresh 3-stack that sends its pair still lets the leftover singleton move
      Given arrow a1 holds 3 heads belonging to player A
      And the group has spent 0
      And exits e1 and e2 are distinct legal empty out-arrows from a1's target
      When player A applies a step of count 2 from a1 to e1
      Then a1 holds 1 head with spent 0
      And e1 holds 2 heads with spent 1
      And a further step from a1 is still legal
      # Remainder inherited spent 0; speed(1)=1, so split order does not trap the singleton.

    Scenario: A stack that has spent its allowance cannot split into fresh scouts
      Given arrow a1 holds 4 heads belonging to player A
      And the group has spent 3
      When player A tries to step count 1 from a1 to a legal empty exit
      Then the step is refused
      # Inheriting spent closes the double dip; splitting needs no penalty of its own.

  Rule: Merging is automatic and costs the turn

    Scenario: Stepping onto own heads merges without a separate move
      Given arrow a1 holds 1 head belonging to player A
      And arrow e1 holds 2 heads belonging to player A with spent 0
      And e1 is an out-arrow of the target of a1
      When player A applies a step of count 1 from a1 to e1
      Then e1 holds 3 heads belonging to player A
      And a1 is empty
      And there is a single group on e1

    Scenario: A minority arrival leaves the merged stack at speed 1
      Given arrow dest holds 3 heads belonging to player A with spent 0
      And arrow src holds 1 head belonging to player A with spent 0
      And dest is a legal exit from src
      When player A steps the 1 from src onto dest
      Then the merged group of 4 has effective speed 1
      And it may take one more step this turn

    Scenario: An equal arrival leaves the merged stack at speed 1
      Given arrow dest holds 2 heads belonging to player A with spent 0
      And arrow src holds 2 heads belonging to player A with spent 0
      And dest is a legal exit from src
      When player A steps the 2 from src onto dest
      Then the merged group of 4 has effective speed 1

    Scenario: A majority arrival bars the merged stack for the turn
      Given arrow dest holds 1 head belonging to player A with spent 0
      And arrow src holds 2 heads belonging to player A with spent 0
      And dest is a legal exit from src
      When player A steps the 2 from src onto dest
      Then the merged group of 3 has effective speed 0
      And no further step from dest is legal this turn

  Rule: The turn ends explicitly; exhaustion offers only end-turn

    Scenario: End-turn advances the active player
      Given it is player A's turn
      When player A ends the turn
      Then it is player B's turn

    Scenario: When no group has a whole step left, only end-turn is legal
      Given every group of player A has spent equal to its effective speed
      When I ask for player A's legal moves
      Then the only legal move is end-turn

    Scenario: Ending with leftover allowance is legal
      Given arrow a1 holds 4 heads belonging to player A with spent 0
      When player A ends the turn
      Then the end-turn is accepted
      And it is player B's turn
