# language: en
# Overview: docs/spec/heuristic-loop-of-doom/heuristic-loop-of-doom.md
# Adapter only — the live heuristic seat's sortie credit, not a game rule

Feature: Edges of the grew-this-turn gate on the sortie credit
  As the local heuristic seat
  I want the gate to read only how many arrows my trail holds
  So that it is cheap, deterministic, and changes nothing outside the live seat

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort

  Rule: sortieGrew compares trail sizes, nothing else

    Scenario Outline: sortieGrew with origin trail size <origin> and terminal trail size <terminal>
      Given an origin where me's trail holds <origin> arrows
      And a terminal where me's trail holds <terminal> arrows
      When sortieGrew is asked of the origin and the terminal
      Then it answers <grew>

      Examples:
        | origin | terminal | grew  | note                                   |
        | 0      | 0        | false | no trail at either end                 |
        | 0      | 3        | true  | an opening sortie                      |
        | 9      | 12       | true  | the sortie was extended                |
        | 12     | 12       | false | a ring walk or a pass                  |
        | 12     | 4        | false | part closed, a smaller trail left open |
        | 12     | 0        | false | the sortie closed                      |

    Scenario: A trail absent from the map counts as size 0
      Given an origin whose trails map has no entry for me
      And a terminal where me's trail holds 2 arrows
      When sortieGrew is asked of the origin and the terminal
      Then it answers true

    Scenario: sortieGrew does not read the other seats' trails
      Given an origin and a terminal where me's trail holds 5 arrows at both
      And another seat's trail grows from 0 to 7 arrows between them
      When sortieGrew is asked of the origin and the terminal for me
      Then it answers false

  Rule: The nested search is unchanged

    Scenario: The nested search plans as it did before P91
      Given fixture L1's minimal position after its logged turn into the ring, seat A to move
      When chooseTurnBeamWithBudget plans seat A's turn with withReplies false
      Then the plan is "4,0,0 ×2, 4,0,2 ×2, 5,0,0 ×2, endTurn", the plan main 229892d returns there

  Rule: sortieCredit keeps its P85 contract

    Scenario: sortieCredit still prices an open sortie without an origin
      Given the terminal T of the core scenario "A ring walk earns no credit"
      When sortieCredit is asked of T alone
      Then it returns a value greater than 0, by P85's decision 3a unchanged

  Rule: The gate is deterministic

    Scenario: The same position gives the same plan twice
      Given fixture L1's minimal position after its logged turn into the ring
      When chooseTurnBeam plans seat A's turn twice from that same state
      Then both plans are the same moves in the same order
