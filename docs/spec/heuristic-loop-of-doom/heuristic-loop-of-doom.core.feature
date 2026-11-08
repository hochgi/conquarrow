# language: en
# Overview: docs/spec/heuristic-loop-of-doom/heuristic-loop-of-doom.md
# Adapter only — the live heuristic seat's sortie credit, not a game rule

Feature: The live heuristic seat stops walking a ring of its own trail
  As the local heuristic seat
  I want credit for an open sortie only when this turn grew it
  So that a close in reach is taken instead of walking my own trail forever

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And chooseTurnBeam from botSearch, the live seat's search
    And the loop fixtures of heuristic-loop-of-doom.support.ts, every other seat passing

  Rule: The playtest loops end in a claim

    Scenario Outline: Fixture <id> claims land within three of its turns from the <position> position
      Given fixture <id>'s <position> position at move <index>, seat <seat> to move
      And from the ring, the close home is legal, within one turn, and claims land
      When chooseTurnBeam plays seat <seat>'s next three turns, the other seats passing between them
      Then seat <seat>'s land after one of those turns is greater than at move <index>

      Examples:
        | id | position | index | seat |
        | L1 | replayed | 208   | A    |
        | L1 | minimal  | 208   | A    |
        | L2 | replayed | 101   | B    |
        | L2 | minimal  | 101   | B    |

  Rule: A turn that does not grow the sortie earns no sortie credit

    Scenario: A ring walk earns no credit
      Given fixture L1's minimal position after its logged turn into the ring, seat A to move, its ×4 on 3,0,0, trail size 12
      And the terminal T after the ring turn "4,0,2 ×4, 4,-1,1 ×4, 3,0,0 ×4, endTurn" from there, trail size 12
      And sortieCredit of T is greater than 0
      When liveSortieCredit is asked of that origin and T
      Then sortieGrew of that origin and T is false
      And liveSortieCredit returns 0

  Rule: A turn that grows the sortie is credited as before

    Scenario: The turn into the ring is credited as P85 decided
      Given fixture L1's minimal position at move 208, seat A to move, trail size 9
      And the terminal T after the logged turn into the ring, trail size 12
      When liveSortieCredit is asked of that origin and T
      Then sortieGrew of that origin and T is true
      And liveSortieCredit returns sortieCredit of T, greater than 0
